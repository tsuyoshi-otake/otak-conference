import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
} from '@google/genai';
import {
  getLanguageSpecificPrompt,
  createPeerTranslationSystemPrompt
} from './translation-prompts';
import { createBlob, decode, decodeAudioData, float32ToBase64PCM } from './gemini-utils';
import { debugLog, debugWarn, debugError, isDebugEnabled } from './debug-utils';

export interface GeminiLiveAudioConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onInputTranscription?: (text: string) => void;
  onError?: (error: Error) => void;
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
  localPlaybackEnabled?: boolean; // Control whether to play audio locally
  
  // Peer-to-peer translation support
  otherParticipantLanguages?: string[]; // Languages of other participants
  usePeerTranslation?: boolean; // Whether to use peer translation mode
  
  // Speed optimization settings
  sendInterval?: number; // Custom audio send interval (ms)
  textBufferDelay?: number; // Custom text buffer delay (ms)
}

export class GeminiLiveAudioStream {
  private session: Session | null = null;
  private ai: GoogleGenAI;
  private config: GeminiLiveAudioConfig;
  
  // Audio contexts for input and output (following Google's sample)
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSampleRate = 16000;
  private readonly targetSampleRate = 16000;
  private readonly silenceGateThreshold = 0.0015;
  private readonly silenceGateHoldMs = 1000;
  private lastNonSilentTime = 0;
  
  // Audio processing nodes
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  
  // Audio playback management (following Google's sample)
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  
  // Processing state
  private isProcessing = false;
  private sessionConnected = false;
  
  // Audio buffering for rate limiting (CPU最適化)
  private audioBuffer: Float32Array[] = [];
  private lastSendTime = 0;
  private sendInterval = 80; // Tuned default: aligns with best live-audio test pattern
  private maxBufferSize = 10; // バッファサイズ制限でメモリ使用量削減
  
  // Advanced VAD and adaptive timing
  private speechDetected = false;
  private silenceThreshold = 0.01;
  private lastSpeechTime = 0;
  private vadHistory: boolean[] = [];
  private energyHistory: number[] = [];
  private adaptiveInterval = 80; // Dynamic interval based on speech detection
  
  // Predictive audio transmission
  private speechPredicted = false;
  private energyTrend = 0;
  private predictiveBuffer: Float32Array[] = [];
  private isPreemptiveSendEnabled = true;
  
  // CPU最適化：VAD処理頻度削減
  private vadSkipCounter = 0;
  private vadSkipThreshold = 3; // 3回に1回だけ詳細VAD処理
  
  // Multi-threaded processing
  private audioWorker: Worker | null = null;
  private workerRequestId = 0;
  private pendingRequests = new Map<number, (result: any) => void>();
  
  // Token usage tracking
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionCost = 0;
  
  // CPU最適化：ログ出力頻度制限
  private logCounter = 0;
  private logInterval = 30; // 30回に1回だけログ出力

  // Local playback control
  private localPlaybackEnabled = true;

  constructor(config: GeminiLiveAudioConfig) {
    this.config = config;
    this.localPlaybackEnabled = config.localPlaybackEnabled ?? true;
    
    // Apply custom speed settings if provided
    if (config.sendInterval !== undefined) {
      this.sendInterval = config.sendInterval;
    }
    if (config.textBufferDelay !== undefined) {
      this.textBufferDelay = config.textBufferDelay;
    }
    
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: {"apiVersion": "v1alpha"}
    });
    
    // Initialize Web Worker for parallel processing
    this.initializeWorker();
  }

  /**
   * Initialize Web Worker for parallel audio processing
   */
  private async initializeWorker(): Promise<void> {
    try {
      this.audioWorker = new Worker('/audio-worker.js');
      
      this.audioWorker.onmessage = (event) => {
        const { type, result, results } = event.data;
        
        if (type === 'audio-processed' && result) {
          const resolver = this.pendingRequests.get(result.requestId);
          if (resolver) {
            resolver(result);
            this.pendingRequests.delete(result.requestId);
          }
        }
      };
      
      this.audioWorker.onerror = (error) => {
        debugWarn('[Gemini Live Audio] Worker error, disabling worker for this session:', error);
        // Gracefully disable worker without affecting AudioWorklet
        if (this.audioWorker) {
          this.audioWorker.terminate();
          this.audioWorker = null;
        }
        // Clear pending requests
        this.pendingRequests.clear();
      };
      
      // Initialize worker
      this.audioWorker.postMessage({ type: 'init' });
      
    } catch (error) {
      console.warn('[Gemini Live Audio] Worker initialization failed, using main thread:', error);
      this.audioWorker = null;
    }
  }

  /**
   * Update other participants' languages for peer translation
   */
  updateOtherParticipantLanguages(languages: string[]): void {
    debugLog(`[Gemini Live Audio] Updating other participant languages:`, languages);
    this.config.otherParticipantLanguages = languages;
    this.config.usePeerTranslation = languages.length > 0;
    
    // If session is active, recreate it with new translation target
    if (this.sessionConnected && languages.length > 0) {
      debugLog(`[Gemini Live Audio] Recreating session for new translation target: ${languages[0]}`);
      this.recreateSessionWithNewTarget(languages[0]);
    }
  }

  /**
   * Recreate session with new translation target language
   */
  private async recreateSessionWithNewTarget(newTargetLanguage: string): Promise<void> {
    try {
      debugLog(`[Gemini Live Audio] Recreating session for target language: ${newTargetLanguage}`);
      
      // Stop current session
      await this.stop();
      
      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Update config for new target
      this.config.otherParticipantLanguages = [newTargetLanguage];
      this.config.usePeerTranslation = true;
      
      // Restart with media stream if available
      if (this.mediaStream) {
        await this.start(this.mediaStream);
      }
      
    } catch (error) {
      debugError('[Gemini Live Audio] Error recreating session:', error);
      this.config.onError?.(error as Error);
    }
  }

  async start(mediaStream: MediaStream): Promise<void> {
    try {
      debugLog('[Gemini Session] Session started');
      debugLog(`[Gemini Session] Source Language: ${this.config.sourceLanguage}`);
      debugLog(`[Gemini Session] Target Language: ${this.config.targetLanguage}`);
      
      debugLog('[Gemini Live Audio] Starting stream...');
      debugLog(`[Gemini Live Audio] Source Language: ${this.config.sourceLanguage}`);
      debugLog(`[Gemini Live Audio] Target Language: ${this.config.targetLanguage}`);
      
      this.mediaStream = mediaStream;
      // Initialize separate audio contexts for input and output (following Google's sample)
      this.inputAudioContext = new AudioContext({ sampleRate: 16000 });
      this.outputAudioContext = new AudioContext({ sampleRate: 24000 });
      this.inputSampleRate = this.inputAudioContext.sampleRate;
      if (this.inputSampleRate !== this.targetSampleRate) {
        debugWarn(`[Gemini Live Audio] Input sample rate ${this.inputSampleRate}Hz != ${this.targetSampleRate}Hz, will resample before send`);
      }
      
      // Create gain nodes for audio management
      this.inputNode = this.inputAudioContext.createGain();
      this.inputNode.gain.value = 0.00001;
      this.inputNode.connect(this.inputAudioContext.destination);
      this.outputNode = this.outputAudioContext.createGain();
      this.outputNode.connect(this.outputAudioContext.destination);
      
      // Initialize audio timing
      this.nextStartTime = this.outputAudioContext.currentTime;

      // Initialize the session
      debugLog('[Gemini Live Audio] About to initialize session...');
      await this.initializeSession();
      debugLog('[Gemini Live Audio] Session initialization completed');

      // Start processing audio from the media stream
      debugLog('[Gemini Live Audio] About to setup audio processing...');
      await this.setupAudioProcessing();
      debugLog('[Gemini Live Audio] Audio processing setup completed');
      
      // Send initial prompt to reinforce translation context
      setTimeout(() => {
        this.sendInitialPrompt();
      }, 1000);
      
      debugLog('[Gemini Live Audio] Stream started successfully');
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to start stream:', error);
      debugError('[Gemini Live Audio] Error details:', error);
      if (error instanceof Error) {
        debugError('[Gemini Live Audio] Error message:', error.message);
        debugError('[Gemini Live Audio] Error stack:', error.stack);
      }
      this.config.onError?.(error as Error);
      throw error; // Re-throw to ensure the test catches it
    }
  }

  private async initializeSession(): Promise<void> {
    const model = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
    debugLog(`[Gemini Live Audio] Initializing session with model: ${model}`);

    // Get initial system instruction based on current mode
    const systemInstruction = this.getSystemInstruction();
    
    // Log system prompt for visibility
    debugLog(`[Gemini Prompt] System Instruction Set`);
    debugLog(`[Gemini Prompt] Prompt Preview: ${systemInstruction.substring(0, 200)}...`);
    
    debugLog(`[Gemini Live Audio] Setting system instruction for mode: ${this.config.targetLanguage}`);

    const config = {
      systemInstruction: systemInstruction, // Fixed: Use camelCase systemInstruction
      responseModalities: [Modality.AUDIO], // Keep audio only to avoid INVALID_ARGUMENT error
      inputAudioTranscription: {}, // Enable input transcription for fallback
      outputAudioTranscription: {}, // Enable audio transcription to get text
      enableAffectiveDialog: false,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr',
          }
        }
      },
    };

    // Connecting to Gemini Live API
    debugLog('[Gemini Live Audio] Connecting to API...');
    this.session = await this.ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          debugLog('[Gemini Session] Connection established');
          debugLog('[Gemini Live Audio] Session opened successfully');
          this.sessionConnected = true;
        },
        onmessage: (message: LiveServerMessage) => {
          // Commented out verbose message logging
          // console.log('📨 [Gemini Session] MESSAGE RECEIVED:', {
          //   hasModelTurn: !!message.serverContent?.modelTurn,
          //   hasParts: !!message.serverContent?.modelTurn?.parts,
          //   turnComplete: message.serverContent?.turnComplete,
          //   setupComplete: !!message.setupComplete,
          //   hasAudio: !!message.serverContent?.modelTurn?.parts?.some(part => part.inlineData?.data),
          //   hasTranscription: !!message.serverContent?.outputTranscription,
          //   interrupted: !!message.serverContent?.interrupted
          // });
          
          debugLog('[Gemini Live Audio] Received message:', {
            hasModelTurn: !!message.serverContent?.modelTurn,
            hasParts: !!message.serverContent?.modelTurn?.parts,
            turnComplete: message.serverContent?.turnComplete,
            setupComplete: !!message.setupComplete
          });
          
          // Check if this is a setup complete message
          if (message.setupComplete) {
            debugLog('[Gemini Session] Setup completed - Session ready for audio input');
            debugLog('[Gemini Live Audio] Setup completed, session is ready');
            this.sessionConnected = true;
          }
          
          this.handleServerMessage(message);
        },
        onerror: (e: ErrorEvent) => {
          console.error('❌ [Gemini Session] ERROR:', e.message);
          console.error('[Gemini Live Audio] Error:', e.message);
          this.sessionConnected = false;
          
          // Check for quota error specifically
          if (e.message.includes('quota') || e.message.includes('exceeded')) {
            console.error('[Gemini Live Audio] API quota exceeded - translation service temporarily unavailable');
            this.config.onError?.(new Error('API quota exceeded. Please try again later or check your Gemini API billing settings.'));
          } else if (e.message.includes('API key expired') || e.message.includes('expired')) {
            console.error('[Gemini Live Audio] API key expired - please renew your API key');
            this.config.onError?.(new Error('API key expired. Please renew your Gemini API key in the settings.'));
          } else {
            this.config.onError?.(new Error(e.message));
          }
        },
        onclose: (e: CloseEvent) => {
          debugLog('[Gemini Live Audio] Session closed:', e.reason);
          this.sessionConnected = false;
          
          // Check for specific error types in close reason
          if (e.reason && (e.reason.includes('quota') || e.reason.includes('exceeded'))) {
            console.error('[Gemini Live Audio] Session closed due to quota limit');
            this.config.onError?.(new Error('API quota exceeded. Gemini API usage limit has been reached.'));
          } else if (e.reason && (e.reason.includes('API key expired') || e.reason.includes('expired'))) {
            console.error('[Gemini Live Audio] Session closed due to expired API key');
            this.config.onError?.(new Error('API key expired. Please renew your Gemini API key in the settings.'));
          } else if (e.reason && e.reason.includes('API key')) {
            console.error('[Gemini Live Audio] Session closed due to API key issue');
            this.config.onError?.(new Error('API key error. Please check your Gemini API key in the settings.'));
          }
        },
      },
      config
    });
    debugLog('[Gemini Live Audio] Session initialized, waiting for setup completion...');
    
    // Mark as connected after session creation
    // The session is ready to use even before setupComplete message
    this.sessionConnected = true;
  }

  private async setupAudioProcessing(): Promise<void> {
    if (!this.inputAudioContext || !this.mediaStream) return;

    debugLog('[Gemini Live Audio] Setting up audio processing pipeline...');
    
    // Create media stream source and connect to input node
    this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.inputNode!);
    
    // Use AudioWorkletNode instead of deprecated ScriptProcessorNode
    let audioWorkletSuccess = false;
    
    // First attempt: Try AudioWorklet (modern, preferred method)
    try {
      // Ensure AudioContext is in running state for AudioWorklet
      if (this.inputAudioContext.state === 'suspended') {
        await this.inputAudioContext.resume();
      }
      
      // Wait for context to be fully ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Add audio worklet for input capture (recommended by Google)
      await this.inputAudioContext.audioWorklet.addModule('./audio-capture-processor.js');
      
      // Create AudioWorkletNode for audio capture
      const audioWorkletNode = new AudioWorkletNode(this.inputAudioContext, 'audio-capture-processor', {
        processorOptions: { debugEnabled: isDebugEnabled() }
      });
      
      // Handle audio data from worklet
      audioWorkletNode.port.onmessage = (event) => {
        // Check session state before processing
        if (!this.isProcessing || !this.session || !this.sessionConnected) return;
        
        const pcmData = event.data; // Float32Array from worklet
        
        // CPU最適化：バッファサイズ制限でメモリ使用量削減
        if (this.audioBuffer.length >= this.maxBufferSize) {
          // 古いバッファを削除してメモリを節約
          this.audioBuffer.shift();
        }
        
        // Zero-copy buffering: Use transferred buffer directly when possible
        const isDataTransferred = pcmData.buffer.byteLength === 0;
        if (isDataTransferred) {
          // Data was transferred, need to create new buffer
          this.audioBuffer.push(new Float32Array(pcmData));
        } else {
          // Data was copied, can directly reference
          this.audioBuffer.push(pcmData);
        }
        
        // Advanced voice activity detection
        this.detectSpeechActivity(pcmData);
        
        // Adaptive interval based on speech detection
        const currentTime = Date.now();
        const effectiveInterval = this.getAdaptiveInterval();
        
        if (currentTime - this.lastSendTime >= effectiveInterval) {
          this.sendBufferedAudio();
          this.lastSendTime = currentTime;
        }
      };

      // Handle AudioWorklet errors
      audioWorkletNode.port.onerror = (error) => {
        debugError('[Gemini Live Audio] AudioWorklet error:', error);
      };

      // Connect audio processing chain (silent output to keep graph alive)
      this.sourceNode.connect(audioWorkletNode);
      if (this.inputNode) {
        audioWorkletNode.connect(this.inputNode);
      } else {
        audioWorkletNode.connect(this.inputAudioContext.destination);
      }
      
      // Store reference for cleanup
      this.scriptProcessor = audioWorkletNode as any; // For compatibility
      audioWorkletSuccess = true;
      
      debugLog('[Gemini Live Audio] AudioWorklet initialized successfully');
      
    } catch (workletError) {
      debugWarn('[Gemini Live Audio] AudioWorklet initialization failed:', workletError);
      audioWorkletSuccess = false;
    }
    
    // Fallback: Only use ScriptProcessorNode if AudioWorklet absolutely failed
    if (!audioWorkletSuccess) {
      console.warn('[Gemini Live Audio] ⚠️  Using deprecated ScriptProcessorNode as fallback. Consider updating your browser for better performance.');
      
      // Fallback to ScriptProcessorNode for compatibility
      const bufferSize = 256;
      this.scriptProcessor = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
      
      this.scriptProcessor.onaudioprocess = (event) => {
        // Check session state before processing
        if (!this.isProcessing || !this.session || !this.sessionConnected) return;
        
        const inputBuffer = event.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        
        // CPU最適化：バッファサイズ制限
        if (this.audioBuffer.length >= this.maxBufferSize) {
          this.audioBuffer.shift();
        }
        
        // Create a copy to avoid buffer reuse issues
        const pcmDataCopy = new Float32Array(pcmData.length);
        pcmDataCopy.set(pcmData);
        
        // Add to buffer for processing
        this.audioBuffer.push(pcmDataCopy);
        
        // Advanced voice activity detection
        this.detectSpeechActivity(pcmDataCopy);
        
        // Adaptive interval based on speech detection
        const currentTime = Date.now();
        const effectiveInterval = this.getAdaptiveInterval();
        
        if (currentTime - this.lastSendTime >= effectiveInterval) {
          this.sendBufferedAudio();
          this.lastSendTime = currentTime;
        }
      };

      // Connect audio processing chain (silent output to keep graph alive)
      this.sourceNode.connect(this.scriptProcessor);
      if (this.inputNode) {
        this.scriptProcessor.connect(this.inputNode);
      } else {
        this.scriptProcessor.connect(this.inputAudioContext.destination);
      }
      
      debugLog('[Gemini Live Audio] ScriptProcessorNode fallback initialized');
    }
    
    this.isProcessing = true;
    debugLog('[Gemini Live Audio] Audio processing pipeline ready');
  }

  /**
   * Advanced Voice Activity Detection with predictive speech detection
   */
  private detectSpeechActivity(audioData: Float32Array): void {
    // CPU負荷削減：3回に1回だけ詳細なVAD処理を実行
    this.vadSkipCounter++;
    if (this.vadSkipCounter < this.vadSkipThreshold) {
      // 簡易エネルギー計算のみ（CPU負荷大幅削減）
      let energy = 0;
      const step = Math.max(1, Math.floor(audioData.length / 16)); // サンプリング削減
      for (let i = 0; i < audioData.length; i += step) {
        energy += audioData[i] * audioData[i];
      }
      energy = energy / (audioData.length / step);
      
      // 簡易判定のみ
      this.speechDetected = energy > this.silenceThreshold * 4;
      if (this.speechDetected) {
        this.lastSpeechTime = Date.now();
      }
      return;
    }
    
    // 詳細VAD処理（3回に1回のみ実行）
    this.vadSkipCounter = 0;
    
    // 効率的なRMSエネルギー計算（サンプリング削減）
    let energy = 0;
    let zeroCrossings = 0;
    let previousSample = 0;
    const step = Math.max(1, Math.floor(audioData.length / 32)); // 32サンプルに削減
    
    for (let i = 0; i < audioData.length; i += step) {
      energy += audioData[i] * audioData[i];
      
      // ゼロクロッシング計算も削減
      if (i > 0 && previousSample * audioData[i] < 0) {
        zeroCrossings++;
      }
      previousSample = audioData[i];
    }
    
    energy = energy / (audioData.length / step);
    const zeroCrossingRate = zeroCrossings / (audioData.length / step);
    
    // エネルギー履歴を10サンプルに削減（30 → 10）
    this.energyHistory.push(energy);
    if (this.energyHistory.length > 10) {
      this.energyHistory.shift();
    }
    
    // 簡略化されたトレンド計算
    if (this.energyHistory.length >= 2) {
      const recent = this.energyHistory.slice(-2);
      this.energyTrend = recent[1] - recent[0]; // 計算簡素化
    }
    
    // 簡略化された適応閾値（reduce処理削減）
    let avgEnergy = 0;
    for (let i = 0; i < this.energyHistory.length; i++) {
      avgEnergy += this.energyHistory[i];
    }
    avgEnergy = avgEnergy / this.energyHistory.length;
    const adaptiveThreshold = Math.max(this.silenceThreshold, avgEnergy * 1.5);
    
    // 音声検出
    const voiceDetected = energy > adaptiveThreshold && zeroCrossingRate < 0.6;
    
    // 予測音声検出（簡略化）
    this.speechPredicted = this.energyTrend > 0.002 && energy > this.silenceThreshold;
    
    // VAD履歴を3サンプルに削減（5 → 3）
    this.vadHistory.push(voiceDetected);
    if (this.vadHistory.length > 3) {
      this.vadHistory.shift();
    }
    
    // スムージング：過半数で判定
    let trueCount = 0;
    for (let i = 0; i < this.vadHistory.length; i++) {
      if (this.vadHistory[i]) trueCount++;
    }
    this.speechDetected = trueCount >= 2;
    
    if (this.speechDetected) {
      this.lastSpeechTime = Date.now();
    }
  }

  /**
   * Get adaptive interval with predictive optimization (30ms base) - CPU最適化版
   */
  private getAdaptiveInterval(): number {
    const baseInterval = this.sendInterval;
    if (this.speechPredicted && this.isPreemptiveSendEnabled) {
      return Math.max(20, Math.round(baseInterval * 0.75));
    }
    if (this.speechDetected) {
      return baseInterval;
    }

    const timeSinceLastSpeech = Date.now() - this.lastSpeechTime;
    return timeSinceLastSpeech < 1000
      ? Math.max(baseInterval * 2, baseInterval + 20)
      : Math.max(baseInterval * 4, baseInterval + 100);
  }

  /**
   * Update speed settings dynamically
   */
  updateSpeedSettings(sendInterval: number, textBufferDelay: number): void {
    this.sendInterval = sendInterval;
    debugLog(`[Gemini Live Audio] Speed settings updated - Send: ${sendInterval}ms, Buffer: ${textBufferDelay}ms`);
  }

  // Gemini 2.5 Flash Native Audio pricing (per 1M tokens) - Updated December 2024
  private static readonly PRICING = {
    INPUT_AUDIO_PER_SECOND: 0.000003, // $3.00 per 1M tokens, ~1 token per second of audio
    OUTPUT_AUDIO_PER_SECOND: 0.000012, // $12.00 per 1M tokens, ~1 token per second of audio
    INPUT_TEXT_PER_TOKEN: 0.0000005, // $0.50 per 1M tokens (text)
    OUTPUT_TEXT_PER_TOKEN: 0.000002 // $2.00 per 1M tokens (text, including thinking tokens)
  };

  private calculateAudioTokens(audioLengthSeconds: number): number {
    // Approximate: 1 token per second of audio for Gemini Live Audio
    return Math.ceil(audioLengthSeconds);
  }

  private calculateTextTokens(text: string): number {
    // Approximate: 1 token per 4 characters for Japanese/English mixed text
    return Math.ceil(text.length / 4);
  }

  private updateTokenUsage(inputAudioSeconds: number = 0, outputAudioSeconds: number = 0, outputText: string = ''): void {
    const inputTokens = this.calculateAudioTokens(inputAudioSeconds);
    const outputAudioTokens = this.calculateAudioTokens(outputAudioSeconds);
    const outputTextTokens = this.calculateTextTokens(outputText);
    const totalOutputTokens = outputAudioTokens + outputTextTokens;
    
    // Calculate costs
    const inputCost = inputTokens * GeminiLiveAudioStream.PRICING.INPUT_AUDIO_PER_SECOND;
    const outputAudioCost = outputAudioTokens * GeminiLiveAudioStream.PRICING.OUTPUT_AUDIO_PER_SECOND;
    const outputTextCost = outputTextTokens * GeminiLiveAudioStream.PRICING.OUTPUT_TEXT_PER_TOKEN;
    const totalCost = inputCost + outputAudioCost + outputTextCost;
    
    // Update session totals
    this.sessionInputTokens += inputTokens;
    this.sessionOutputTokens += totalOutputTokens;
    this.sessionCost += totalCost;
    
    // CPU最適化：ログ出力頻度を削減
    this.logCounter++;
    if (this.logCounter >= this.logInterval) {
      this.logCounter = 0;
      debugLog(`[Gemini Live Audio] Token usage - Input: ${inputTokens}, Output: ${totalOutputTokens}, Cost: $${totalCost.toFixed(6)}`);
      debugLog(`[Gemini Live Audio] Session total - Input: ${this.sessionInputTokens}, Output: ${this.sessionOutputTokens}, Cost: $${this.sessionCost.toFixed(6)}`);
    }
    
    // Notify callback
    this.config.onTokenUsage?.({
      inputTokens: this.sessionInputTokens,
      outputTokens: this.sessionOutputTokens,
      cost: this.sessionCost
    });
  }

  private sendBufferedAudio(): void {
    if (!this.session || this.audioBuffer.length === 0 || !this.sessionConnected) return;

    // Check session state before sending
    if (!this.sessionConnected) {
      debugLog('[Gemini Live Audio] Session not connected, stopping audio send');
      this.isProcessing = false;
      this.audioBuffer = [];
      return;
    }

    try {
      // Combine all buffered audio chunks
      const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const combinedBuffer = new Float32Array(totalLength);
      let offset = 0;
      
      for (const buffer of this.audioBuffer) {
        combinedBuffer.set(buffer, offset);
        offset += buffer.length;
      }
      
      const inputSampleRate = this.inputSampleRate || this.inputAudioContext?.sampleRate || this.targetSampleRate;
      const pcmBuffer = inputSampleRate === this.targetSampleRate
        ? combinedBuffer
        : this.resampleToTargetRate(combinedBuffer, inputSampleRate, this.targetSampleRate);
      
      const now = Date.now();
      const nearSilence = this.isNearSilence(pcmBuffer);
      if (!nearSilence) {
        this.lastNonSilentTime = now;
      }

      if (pcmBuffer.length === 0 || (nearSilence && this.lastNonSilentTime > 0 &&
          now - this.lastNonSilentTime > this.silenceGateHoldMs)) {
        if (nearSilence && this.lastNonSilentTime > 0) {
          debugLog('[Gemini Live Audio] Skipping near-silence audio chunk');
        }
        this.audioBuffer = [];
        return;
      }

      // Convert to base64 PCM for Gemini
      const base64Audio = float32ToBase64PCM(pcmBuffer);
      
      const audioLengthSeconds = pcmBuffer.length / this.targetSampleRate;
      // debugLog(`[Gemini Live Audio] Sending buffered audio: ${totalLength} samples (${audioLengthSeconds.toFixed(2)}s)`);
      
      // Check session state before sending
      if (!this.session || !this.sessionConnected) {
        debugWarn('[Gemini Live Audio] Session not connected, skipping audio send');
        this.audioBuffer = [];
        return;
      }
      
      this.session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: `audio/pcm;rate=${this.targetSampleRate}`
        }
      });
      
      // Track input token usage
      this.updateTokenUsage(audioLengthSeconds);
      
      // Clear the buffer after sending
      this.audioBuffer = [];
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error('❌ [Audio Input] Error sending buffered audio:', errorMessage);
      
      if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED') ||
          errorMessage.includes('quota') || errorMessage.includes('WebSocket')) {
        // Session closed during send - stopping audio processing
        debugLog('[Gemini Live Audio] Session closed during buffered send, stopping');
        this.isProcessing = false;
        this.sessionConnected = false;
        this.audioBuffer = [];
        
        // Disconnect script processor
        if (this.scriptProcessor) {
          this.scriptProcessor.disconnect();
          this.scriptProcessor = null;
        }
      } else {
        console.error('[Gemini Live Audio] Error sending buffered audio:', error);
      }
    }
  }

  private resampleToTargetRate(
    input: Float32Array,
    inputRate: number,
    targetRate: number
  ): Float32Array {
    if (inputRate === targetRate) {
      return input;
    }

    const ratio = inputRate / targetRate;
    const outputLength = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const index = i * ratio;
      const low = Math.floor(index);
      const high = Math.min(low + 1, input.length - 1);
      const weight = index - low;
      output[i] = input[low] * (1 - weight) + input[high] * weight;
    }

    return output;
  }

  private isNearSilence(buffer: Float32Array): boolean {
    const threshold = Math.max(0.0008, this.silenceGateThreshold);
    let sumSquares = 0;
    let samples = 0;

    for (let i = 0; i < buffer.length; i += 4) {
      const sample = buffer[i];
      sumSquares += sample * sample;
      samples++;
    }

    const rms = samples > 0 ? Math.sqrt(sumSquares / samples) : 0;
    return rms < threshold;
  }

  private getSystemInstruction(): string {
    // Check if this is a system assistant mode (no other participants)
    const isSystemAssistantMode = this.config.targetLanguage === 'System Assistant';
    
    if (isSystemAssistantMode) {
      // System assistant prompt based on user's language
      const getSystemAssistantPrompt = (userLanguage: string): string => {
        const languageMap: Record<string, string> = {
          'japanese': `あなたはotak-conferenceシステムのアシスタントです。otak-conferenceは、リアルタイム多言語翻訳会議システムです。

主な機能：
• リアルタイム音声翻訳：3言語（日本語、英語、ベトナム語）に対応し、参加者の発言を即座に翻訳
• WebRTCによる高品質な音声・ビデオ通話
• 画面共有機能
• チャット機能（既読機能付き）
• リアクション機能（👍❤️😊👏🎉）
• 挙手機能
• カメラエフェクト（背景ぼかし、美肌モード、明るさ調整）
• 音声デバイス選択

使い方：
1. 設定画面で名前とGemini APIキーを入力
2. 言語を選択（日本語、英語、ベトナム語から選択可能）
3. 「Start Conference」をクリックして会議を開始
4. URLを共有して他の参加者を招待

ユーザーの質問に日本語で丁寧に答えてください。`,
          
          'english': `You are the otak-conference system assistant. otak-conference is a real-time multilingual translation conference system.

Key Features:
• Real-time voice translation: Supports 3 languages (Japanese, English, Vietnamese) with instant translation
• High-quality audio/video calls using WebRTC
• Screen sharing capability
• Chat function with read receipts
• Reaction features (👍❤️😊👏🎉)
• Hand raise function
• Camera effects (background blur, beauty mode, brightness adjustment)
• Audio device selection

How to Use:
1. Enter your name and Gemini API key in settings
2. Select your language (Japanese, English, Vietnamese available)
3. Click "Start Conference" to begin
4. Share the URL to invite other participants

Please answer user questions politely in English.`,
          
          'vietnamese': `Bạn là trợ lý hệ thống otak-conference. otak-conference là hệ thống hội nghị dịch đa ngôn ngữ thời gian thực.

Tính năng chính:
• Dịch giọng nói thời gian thực: Hỗ trợ 3 ngôn ngữ (tiếng Nhật, tiếng Anh, tiếng Việt) với dịch thuật tức thì
• Cuộc gọi âm thanh/video chất lượng cao sử dụng WebRTC
• Khả năng chia sẻ màn hình
• Chức năng trò chuyện với xác nhận đã đọc
• Tính năng phản ứng (👍❤️😊👏🎉)
• Chức năng giơ tay
• Hiệu ứng camera (làm mờ nền, chế độ làm đẹp, điều chỉnh độ sáng)
• Lựa chọn thiết bị âm thanh

Cách sử dụng:
1. Nhập tên và khóa API Gemini trong cài đặt
2. Chọn ngôn ngữ của bạn (tiếng Nhật, tiếng Anh, tiếng Việt có sẵn)
3. Nhấp "Start Conference" để bắt đầu
4. Chia sẻ URL để mời người tham gia khác

Vui lòng trả lời câu hỏi của người dùng một cách lịch sự bằng tiếng Việt.`,
          
          'chinese': `您是otak-conference系统助手。otak-conference是一个实时多语言翻译会议系统。

主要功能：
• 实时语音翻译：支持25种语言的即时翻译
• 使用WebRTC的高质量音视频通话
• 屏幕共享功能
• 带已读回执的聊天功能
• 反应功能（👍❤️😊👏🎉）
• 举手功能
• 相机效果（背景模糊、美颜模式、亮度调整）
• 音频设备选择

使用方法：
1. 在设置中输入您的姓名和Gemini API密钥
2. 选择您的语言（25种语言可选）
3. 点击"Start Conference"开始会议
4. 分享URL邀请其他参与者

请用中文礼貌地回答用户的问题。`,
          
          'korean': `당신은 otak-conference 시스템 어시스턴트입니다. otak-conference는 실시간 다국어 번역 회의 시스템입니다.

주요 기능:
• 실시간 음성 번역: 25개 언어 지원 및 즉시 번역
• WebRTC를 사용한 고품질 음성/비디오 통화
• 화면 공유 기능
• 읽음 확인 기능이 있는 채팅
• 반응 기능 (👍❤️😊👏🎉)
• 손들기 기능
• 카메라 효과 (배경 흐림, 뷰티 모드, 밝기 조정)
• 오디오 장치 선택

사용 방법:
1. 설정에서 이름과 Gemini API 키 입력
2. 언어 선택 (25개 언어 사용 가능)
3. "Start Conference"를 클릭하여 회의 시작
4. URL을 공유하여 다른 참가자 초대

한국어로 정중하게 사용자의 질문에 답변해 주세요.`,
          
          'spanish': `Eres el asistente del sistema otak-conference. otak-conference es un sistema de conferencias con traducción multilingüe en tiempo real.

Características principales:
• Traducción de voz en tiempo real: Soporta 25 idiomas con traducción instantánea
• Llamadas de audio/video de alta calidad usando WebRTC
• Capacidad de compartir pantalla
• Función de chat con confirmación de lectura
• Funciones de reacción (👍❤️😊👏🎉)
• Función de levantar la mano
• Efectos de cámara (desenfoque de fondo, modo belleza, ajuste de brillo)
• Selección de dispositivo de audio

Cómo usar:
1. Ingrese su nombre y clave API de Gemini en configuración
2. Seleccione su idioma (25 idiomas disponibles)
3. Haga clic en "Start Conference" para comenzar
4. Comparta la URL para invitar a otros participantes

Por favor responda las preguntas del usuario cortésmente en español.`,
          
          'french': `Vous êtes l'assistant du système otak-conference. otak-conference est un système de conférence avec traduction multilingue en temps réel.

Fonctionnalités principales :
• Traduction vocale en temps réel : Prend en charge 25 langues avec traduction instantanée
• Appels audio/vidéo de haute qualité utilisant WebRTC
• Capacité de partage d'écran
• Fonction de chat avec accusés de lecture
• Fonctions de réaction (👍❤️😊👏🎉)
• Fonction lever la main
• Effets de caméra (flou d'arrière-plan, mode beauté, réglage de la luminosité)
• Sélection du périphérique audio

Comment utiliser :
1. Entrez votre nom et la clé API Gemini dans les paramètres
2. Sélectionnez votre langue (25 langues disponibles)
3. Cliquez sur "Start Conference" pour commencer
4. Partagez l'URL pour inviter d'autres participants

Veuillez répondre poliment aux questions de l'utilisateur en français.`
        };
        
        // Default to English if language not found
        return languageMap[userLanguage.toLowerCase()] || languageMap['english'];
      };
      
      return this.appendNoSpeechRule(getSystemAssistantPrompt(this.config.sourceLanguage.toLowerCase()));
    } else {
      // Check if peer translation mode is enabled
      if (this.config.usePeerTranslation && this.config.otherParticipantLanguages && this.config.otherParticipantLanguages.length > 0) {
        // Peer-to-peer translation mode: translate my language to peer's language
        const targetLanguage = this.config.otherParticipantLanguages[0]; // Use first peer's language as primary target
        
        debugLog(`[Gemini Live Audio] Using peer translation mode: ${this.config.sourceLanguage} → ${targetLanguage}`);
        
        const prompt = this.appendDomainContext(
          createPeerTranslationSystemPrompt(this.config.sourceLanguage, targetLanguage)
        );
        return this.appendNoSpeechRule(prompt);
      } else {
        // Traditional translation mode (fallback)
        const prompt = this.appendDomainContext(
          getLanguageSpecificPrompt(this.config.sourceLanguage, this.config.targetLanguage)
        );
        return this.appendNoSpeechRule(prompt);
      }
    }
  }

  private appendDomainContext(prompt: string): string {
    const domainContext = [
      'ROLE: You are a professional translator working at a Japanese SIer.',
      'DOMAIN HINT: The conversation domain likely includes keywords about Java, TypeScript, AWS, OCI, GitHub Actions, CI/CD, CI, E2E, audit logs, migration, state, Step Functions, UnitTest, OpenAI, Anthropic, unit tests, and E2E. Preserve product names and acronyms in English.'
    ].join(' ');
    return `${domainContext}\n\n${prompt}`;
  }

  private appendNoSpeechRule(prompt: string): string {
    return `${prompt}\n\nNON-SPEECH RULE: If the input audio is silence, background noise, or non-speech sounds, respond with nothing (no text, no audio). Do not describe or evaluate the input.`;
  }

  private sendInitialPrompt(): void {
    // System instruction is now set during session initialization
    // No need to send additional prompts as they are handled by system_instruction
    debugLog('[Gemini Live Audio] System instruction already set during session initialization');
  }

  // Removed sendAudioChunk method - now using direct streaming in setupAudioProcessing

  private float32ToPCM16(float32Array: Float32Array): Int16Array {
    const pcm16 = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return pcm16;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Audio data accumulation for complete turn processing
  private audioChunks: string[] = [];
  private isCollectingAudio = false;
  private audioMimeType: string | undefined;
  
  // Text buffering for complete sentence processing
  private textBuffer: string[] = [];
  private lastTextTime = 0;
  private textBufferTimeout: NodeJS.Timeout | null = null;
  private textBufferDelay = 2000; // Default: 2秒間テキストが来なければ送信

  private handleServerMessage(message: LiveServerMessage): void {
    // Check if this is the start of a new turn
    if (message.serverContent?.modelTurn && !this.isCollectingAudio) {
      this.isCollectingAudio = true;
      this.audioChunks = [];
      debugLog('[Gemini Live Audio] Starting audio collection for new turn');
    }

    // Collect audio data from the turn (following Google's pattern)
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.includes('audio')) {
          // Commented out verbose audio chunk logging
          // console.log('🎵 [Audio Output] AUDIO CHUNK RECEIVED from Gemini');
          // console.log(`📊 [Audio Output] Chunk size: ${part.inlineData.data.length} characters (base64)`);
          this.audioChunks.push(part.inlineData.data);
          // Store MIME type from first chunk
          if (!this.audioMimeType && part.inlineData.mimeType) {
            this.audioMimeType = part.inlineData.mimeType;
            debugLog(`[Gemini Live Audio] Audio MIME type: ${this.audioMimeType}`);
          }
          debugLog(`[Gemini Live Audio] Collected audio chunk: ${part.inlineData.data.length} chars`);
        }
      }
    }

    // Process complete turn when turnComplete is received
    if (message.serverContent?.turnComplete && this.isCollectingAudio) {
      debugLog(`[Gemini Live Audio] Turn complete, processing ${this.audioChunks.length} audio chunks`);
      this.isCollectingAudio = false;
      
      // Flush text buffer when turn completes
      this.flushTextBuffer();
      
      if (this.audioChunks.length > 0) {
        this.processCompleteAudioTurn(this.audioChunks, this.audioMimeType);
        this.audioChunks = [];
        this.audioMimeType = undefined;
      } else {
        debugWarn('[Gemini Live Audio] Turn complete but no audio chunks received');
      }
    }

    // Handle interruption (following Google's sample)
    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
      debugLog('[Gemini Live Audio] Received interruption signal');
      this.isCollectingAudio = false;
      this.audioChunks = [];
      
      // Clear text buffer on interruption
      this.textBuffer = [];
      if (this.textBufferTimeout) {
        clearTimeout(this.textBufferTimeout);
        this.textBufferTimeout = null;
      }
      
      for (const source of this.sources.values()) {
        source.stop();
        this.sources.delete(source);
      }
      this.nextStartTime = 0;
    }

    if (message.serverContent?.inputTranscription?.text) {
      this.config.onInputTranscription?.(message.serverContent.inputTranscription.text);
    }

    // Handle audio transcription (text from audio output) - Buffer for complete sentences
    if (message.serverContent?.outputTranscription) {
      const transcriptText = message.serverContent.outputTranscription.text;
      if (transcriptText) {
        // Commented out verbose text buffer logging
        // console.log('📝 [Text Buffer] TRANSCRIPT CHUNK RECEIVED:', transcriptText);
        
        // Add to text buffer
        this.textBuffer.push(transcriptText);
        this.lastTextTime = Date.now();
        
        // Clear existing timeout
        if (this.textBufferTimeout) {
          clearTimeout(this.textBufferTimeout);
        }
        
        // Set timeout to send buffered text if no more text comes
        this.textBufferTimeout = setTimeout(() => {
          this.flushTextBuffer();
        }, this.textBufferDelay);
        
        // console.log(`📊 [Text Buffer] Buffered ${this.textBuffer.length} text chunks`);
      }
    }

    // Handle text response parts
    this.handleTextResponse(message);
  }

  /**
   * Flush accumulated text buffer and send to callback
   */
  private flushTextBuffer(): void {
    if (this.textBuffer.length === 0) return;
    
    // Combine all buffered text chunks
    const combinedText = this.textBuffer.join(' ').trim();
    
    if (combinedText) {
      // Commented out verbose text buffer flushing logs
      // console.log('📝 [Text Buffer] FLUSHING BUFFERED TEXT:', combinedText);
      // console.log(`📊 [Text Buffer] Combined ${this.textBuffer.length} chunks into single message`);
      
      // Track output token usage for received text
      this.updateTokenUsage(0, 0, combinedText);
      
      // console.log('📞 [Callback] Calling onTextReceived with buffered text...');
      this.config.onTextReceived?.(combinedText);
      // console.log('✅ [Callback] onTextReceived completed for buffered text');
    }
    
    // Clear buffer and timeout
    this.textBuffer = [];
    if (this.textBufferTimeout) {
      clearTimeout(this.textBufferTimeout);
      this.textBufferTimeout = null;
    }
  }

  /**
   * Process complete audio turn by combining chunks and creating WAV file
   * Following Google's pattern for handling complete audio responses
   */
  private async processCompleteAudioTurn(audioChunks: string[], mimeType?: string): Promise<void> {
    try {
      debugLog(`[Gemini Live Audio] Processing complete audio turn with ${audioChunks.length} chunks`);
      
      if (audioChunks.length === 0) {
        debugWarn('[Gemini Live Audio] No audio chunks to process');
        return;
      }
      
      // Calculate total size first to avoid array resizing
      let totalSamples = 0;
      const decodedChunks: Int16Array[] = [];
      
      // Decode all chunks first (parallel processing potential)
      for (let i = 0; i < audioChunks.length; i++) {
        const chunk = audioChunks[i];
        // Commented out verbose chunk processing logging
        // console.log(`📦 [Audio Processing] Processing chunk ${i + 1}/${audioChunks.length}: ${chunk.length} chars`);
        
        const buffer = decode(chunk);
        const intArray = new Int16Array(buffer);
        decodedChunks.push(intArray);
        totalSamples += intArray.length;
        
        // console.log(`🔢 [Audio Processing] Chunk ${i + 1} decoded: ${intArray.length} samples`);
      }
      
      if (totalSamples === 0) {
        debugWarn('[Gemini Live Audio] No audio data to process - empty chunks');
        return;
      }
      
      // Efficiently combine using pre-allocated buffer
      const audioBuffer = new Int16Array(totalSamples);
      let offset = 0;
      
      for (const chunk of decodedChunks) {
        audioBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Reduced verbose audio processing logs
      debugLog(`[Gemini Live Audio] Combined audio buffer: ${audioBuffer.length} samples`);
      
      // Parse audio parameters from MIME type
      const audioParams = mimeType ? this.parseMimeType(mimeType) : {
        sampleRate: 24000,
        bitsPerSample: 16,
        numChannels: 1
      };
      
      debugLog(`[Gemini Live Audio] Audio parameters: ${audioParams.sampleRate}Hz, ${audioParams.bitsPerSample}bit, ${audioParams.numChannels}ch`);
      
      // Use optimized method if we have MIME type, fallback to current method
      let wavData: ArrayBuffer;
      if (mimeType) {
        // Use Google's direct method for better compatibility
        wavData = this.createWavFromChunks(audioChunks, mimeType);
        debugLog('[Gemini Live Audio] Using direct WAV creation from chunks');
      } else {
        // Fallback to current decoded method
        wavData = this.createWavFile(audioBuffer, audioParams.sampleRate, audioParams.numChannels);
        debugLog('[Gemini Live Audio] Using decoded WAV creation method');
      }
      
      // Calculate duration for token tracking using correct sample rate
      const audioDurationSeconds = audioBuffer.length / audioParams.sampleRate;
      debugLog(`[Gemini Live Audio] Audio duration: ${audioDurationSeconds.toFixed(2)}s`);
      
      // Only play locally if local playback is enabled
      if (this.localPlaybackEnabled && this.outputAudioContext) {
        await this.playWavAudio(wavData);
        debugLog(`[Gemini Live Audio] Playing combined audio locally: ${audioDurationSeconds.toFixed(2)}s`);
      } else {
        debugLog(`[Gemini Live Audio] Skipping local playback: ${audioDurationSeconds.toFixed(2)}s`);
      }
      
      // Track output token usage
      this.updateTokenUsage(0, audioDurationSeconds);
      
      // Always call the callback for translated audio distribution to other participants
      this.config.onAudioReceived?.(wavData.slice(0));
      
    } catch (error) {
      console.error('❌ [Audio Processing] Failed to process complete audio turn:', error);
      console.error('[Gemini Live Audio] Failed to process complete audio turn:', error);
      debugError('[Gemini Live Audio] Error details:', error);
    }
  }

  /**
   * Parse MIME type to extract audio parameters
   * Based on Google's official sample
   */
  private parseMimeType(mimeType: string): { sampleRate: number; bitsPerSample: number; numChannels: number } {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options = {
      numChannels: 1,
      bitsPerSample: 16,
      sampleRate: 24000 // Default to 24kHz
    };

    // Parse format like "L16" for 16-bit linear PCM
    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }

    // Parse parameters like "rate=24000"
    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') {
        const rate = parseInt(value, 10);
        if (!isNaN(rate)) {
          options.sampleRate = rate;
        }
      }
    }

    return options;
  }

  /**
   * Create WAV file from raw audio data chunks
   * Based on Google's official sample implementation
   */
  private createWavFromChunks(audioChunks: string[], mimeType: string): ArrayBuffer {
    const audioParams = this.parseMimeType(mimeType);
    
    // Calculate total raw data length (base64 decoded length)
    const totalRawLength = audioChunks.reduce((sum, chunk) => {
      return sum + Math.floor((chunk.length * 3) / 4); // base64 to binary conversion
    }, 0);
    
    // Create WAV header based on parsed parameters
    const wavHeader = this.createWavHeaderBrowser(totalRawLength, audioParams);
    
    // Combine all base64 chunks into single buffer
    const combinedDataSize = wavHeader.byteLength + totalRawLength;
    const resultBuffer = new ArrayBuffer(combinedDataSize);
    const resultView = new Uint8Array(resultBuffer);
    
    // Copy header
    resultView.set(new Uint8Array(wavHeader), 0);
    
    // Decode and copy audio data
    let offset = wavHeader.byteLength;
    for (const chunk of audioChunks) {
      const decodedChunk = decode(chunk);
      resultView.set(new Uint8Array(decodedChunk), offset);
      offset += decodedChunk.byteLength;
    }
    
    return resultBuffer;
  }

  /**
   * Create WAV header from audio parameters (browser-compatible)
   * Following Google's official sample pattern
   */
  private createWavHeaderBrowser(dataLength: number, options: { sampleRate: number; bitsPerSample: number; numChannels: number }): ArrayBuffer {
    const { numChannels, sampleRate, bitsPerSample } = options;
    
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // Helper to write string
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');                              // ChunkID
    view.setUint32(4, 36 + dataLength, true);           // ChunkSize
    writeString(8, 'WAVE');                              // Format
    writeString(12, 'fmt ');                             // Subchunk1ID
    view.setUint32(16, 16, true);                        // Subchunk1Size (PCM)
    view.setUint16(20, 1, true);                         // AudioFormat (1 = PCM)
    view.setUint16(22, numChannels, true);               // NumChannels
    view.setUint32(24, sampleRate, true);                // SampleRate
    view.setUint32(28, byteRate, true);                  // ByteRate
    view.setUint16(32, blockAlign, true);                // BlockAlign
    view.setUint16(34, bitsPerSample, true);             // BitsPerSample
    writeString(36, 'data');                             // Subchunk2ID
    view.setUint32(40, dataLength, true);                // Subchunk2Size

    return buffer;
  }

  /**
   * Create WAV file from PCM audio data
   * Based on the pattern from Google's documentation
   */
  private createWavFile(audioData: Int16Array, sampleRate: number, channels: number): ArrayBuffer {
    const byteRate = sampleRate * channels * 2; // 16-bit audio
    const blockAlign = channels * 2;
    const dataSize = audioData.length * 2;
    const fileSize = 44 + dataSize;
    
    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    
    // WAV file header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Copy audio data
    const audioView = new Int16Array(buffer, 44);
    audioView.set(audioData);
    
    return buffer;
  }

  /**
   * Play WAV audio data using Web Audio API
   */
  private async playWavAudio(wavData: ArrayBuffer): Promise<void> {
    if (!this.outputAudioContext || !this.outputNode) return;
    
    try {
      const audioBuffer = await this.outputAudioContext.decodeAudioData(wavData.slice(0));
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      
      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      this.nextStartTime = Math.max(
        this.nextStartTime,
        this.outputAudioContext.currentTime,
      );
      
      source.start(this.nextStartTime);
      this.nextStartTime = this.nextStartTime + audioBuffer.duration;
      this.sources.add(source);
      
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to play WAV audio:', error);
    }
  }

  // Method to handle handleServerMessage text processing
  private handleTextResponse(message: LiveServerMessage): void {
    if (this.config.targetLanguage !== 'System Assistant') {
      return;
    }

    // Handle text response
    // Commented out verbose text analysis logging
    // console.log('🔍 [Text Analysis] Analyzing message for text content:', {
    //   hasServerContent: !!message.serverContent,
    //   hasModelTurn: !!message.serverContent?.modelTurn,
    //   hasParts: !!message.serverContent?.modelTurn?.parts,
    //   partsLength: message.serverContent?.modelTurn?.parts?.length || 0,
    //   hasOutputTranscription: !!message.serverContent?.outputTranscription
    // });
    
    const transcriptionText = message.serverContent?.outputTranscription?.text;
    if (transcriptionText && transcriptionText.trim().length > 0) {
      return;
    }

    if (message.serverContent?.modelTurn?.parts) {
      // Commented out verbose text parts logging
      // console.log(`📝 [Text Analysis] Processing ${message.serverContent.modelTurn.parts.length} parts`);
      
      for (let i = 0; i < message.serverContent.modelTurn.parts.length; i++) {
        const part = message.serverContent.modelTurn.parts[i];
        // console.log(`🔍 [Text Analysis] Part ${i + 1}:`, {
        //   hasText: !!part.text,
        //   hasInlineData: !!part.inlineData,
        //   textContent: part.text ? `"${part.text.substring(0, 100)}${part.text.length > 100 ? '...' : ''}"` : 'No text',
        //   textLength: part.text?.length || 0
        // });
        
        if (part.text) {
          // Keep minimal text response logging
          debugLog('[Gemini Live Audio] Received translated text:', part.text);
          
          // Track output token usage for received text
          this.updateTokenUsage(0, 0, part.text);
          
          this.config.onTextReceived?.(part.text);
        }
      }
    } else {
      // Commented out verbose no text parts logging
      // console.log('❌ [Text Analysis] No text parts found in message - no text response from Gemini');
    }
  }


  // Public methods to control local playback
  public setLocalPlaybackEnabled(enabled: boolean): void {
    this.localPlaybackEnabled = enabled;
    debugLog(`[Gemini Live Audio] Local playback ${enabled ? 'enabled' : 'disabled'}`);
  }

  public getLocalPlaybackEnabled(): boolean {
    return this.localPlaybackEnabled;
  }

  // Removed base64ToArrayBuffer - now using decode function from gemini-utils

  async stop(): Promise<void> {
    debugLog('[Gemini Session] Session ending');
    debugLog(`[Gemini Session] Session Cost: $${this.sessionCost.toFixed(4)}`);
    debugLog(`[Gemini Session] Input Tokens: ${this.sessionInputTokens}, Output Tokens: ${this.sessionOutputTokens}`);
    
    debugLog('[Gemini Live Audio] Stopping stream...');
    
    // Setting processing flags to false
    this.isProcessing = false;
    this.sessionConnected = false;
    
    // Disconnect audio processing nodes
    if (this.scriptProcessor) {
      // Disconnecting script processor
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
      // Script processor disconnected
    }
    
    if (this.sourceNode) {
      // Disconnecting source node
      this.sourceNode.disconnect();
      this.sourceNode = null;
      // Source node disconnected
    }
    
    // Stop all audio sources (following Google's sample)
    if (this.sources.size > 0) {
      // Stopping active audio sources
      for (const source of this.sources.values()) {
        source.stop();
        this.sources.delete(source);
      }
      // All audio sources stopped
    }
    
    // Close audio contexts
    if (this.inputAudioContext) {
      // Closing input audio context
      await this.inputAudioContext.close();
      this.inputAudioContext = null;
      // Input audio context closed
    }
    
    if (this.outputAudioContext) {
      // Closing output audio context
      await this.outputAudioContext.close();
      this.outputAudioContext = null;
      // Output audio context closed
    }
    
    // Close session
    if (this.session) {
      // Closing Gemini Live session
      this.session.close();
      this.session = null;
      // Gemini Live session closed
    }
    
    // Reset nodes and clear buffers
    this.inputNode = null;
    this.outputNode = null;
    this.nextStartTime = 0;
    this.audioBuffer = [];
    this.lastSendTime = 0;
    this.lastNonSilentTime = 0;
    
    // Clear text buffer and timeout
    this.textBuffer = [];
    if (this.textBufferTimeout) {
      clearTimeout(this.textBufferTimeout);
      this.textBufferTimeout = null;
    }
    
    // Reset token usage for new session
    this.sessionInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.sessionCost = 0;
    
    // Session completely stopped - All resources cleaned up
    debugLog('[Gemini Live Audio] Stream stopped');
  }

  isActive(): boolean {
    return this.session !== null && this.sessionConnected && this.isProcessing;
  }

  /**
   * Check if session is ready for operations (more lenient than isActive)
   */
  isSessionReady(): boolean {
    return this.session !== null && this.sessionConnected;
  }

  /**
   * Update target language dynamically when new participants join
   * Recreate session with new system_instruction since Live API doesn't support dynamic system instruction updates
   */
  async updateTargetLanguage(newTargetLanguage: string): Promise<void> {
    if (!this.isSessionReady()) {
      console.warn('[Gemini Live Audio] Cannot update language - session not ready');
      return;
    }

    const oldTargetLanguage = this.config.targetLanguage;
    this.config.targetLanguage = newTargetLanguage;
    
    debugLog(`[Gemini Live Audio] Updated target language: ${oldTargetLanguage} → ${newTargetLanguage}`);
    
    // If mode changed (System Assistant ↔ Translation) or translation language changed, recreate session with new system instruction
    const oldMode = oldTargetLanguage === 'System Assistant';
    const newMode = newTargetLanguage === 'System Assistant';
    
    if (oldMode !== newMode || (oldMode === false && newMode === false && oldTargetLanguage !== newTargetLanguage)) {
      debugLog('[Gemini Live Audio] Mode or language changed, recreating session with new system instruction...');
      debugLog(`[Gemini Live Audio] Old: ${oldTargetLanguage} (System Assistant: ${oldMode})`);
      debugLog(`[Gemini Live Audio] New: ${newTargetLanguage} (System Assistant: ${newMode})`);
      
      try {
        // Store current media stream
        const currentMediaStream = this.mediaStream;
        
        // Stop current session
        await this.stop();
        
        // Restart with new system instruction
        if (currentMediaStream) {
          await this.start(currentMediaStream);
          debugLog('[Gemini Live Audio] Session recreated successfully with new system instruction');
        }
      } catch (error) {
        console.error('[Gemini Live Audio] Failed to recreate session:', error);
        this.config.onError?.(error as Error);
      }
    } else {
      debugLog('[Gemini Live Audio] Same mode, no session recreation needed');
    }
  }

  /**
   * Get current target language
   */
  getCurrentTargetLanguage(): string {
    return this.config.targetLanguage;
  }
  
  /**
   * Update speed settings dynamically
   */
  updateSpeedSettings(sendInterval?: number, textBufferDelay?: number): void {
    if (sendInterval !== undefined && sendInterval > 0) {
      this.sendInterval = sendInterval;
      debugLog(`[Gemini Live Audio] Updated send interval to ${sendInterval}ms`);
    }
    if (textBufferDelay !== undefined && textBufferDelay > 0) {
      this.textBufferDelay = textBufferDelay;
      debugLog(`[Gemini Live Audio] Updated text buffer delay to ${textBufferDelay}ms`);
    }
  }
  
  /**
   * Get current speed settings
   */
  getSpeedSettings(): { sendInterval: number; textBufferDelay: number } {
    return {
      sendInterval: this.sendInterval,
      textBufferDelay: this.textBufferDelay
    };
  }
}

// Global audio context and audio element for streaming playback
let globalAudioContext: AudioContext | null = null;
let globalAudioElement: HTMLAudioElement | null = null;
let globalMediaSource: MediaSource | null = null;
let globalSourceBuffer: SourceBuffer | null = null;
let audioQueue: ArrayBuffer[] = [];
let isProcessingQueue = false;

// Initialize streaming audio playback using MediaSource
async function initializeStreamingAudio(): Promise<void> {
  // Reset existing MediaSource if present
  if (globalMediaSource) {
    try {
      if (globalMediaSource.readyState === 'open') {
        globalMediaSource.endOfStream();
      }
    } catch (e) {
      // Ignore errors during cleanup
    }
    globalMediaSource = null;
    globalSourceBuffer = null;
  }
  
  if (globalAudioElement) {
    globalAudioElement.src = '';
    globalAudioElement.load();
  } else {
    globalAudioElement = new Audio();
    globalAudioElement.autoplay = true;
    globalAudioElement.volume = 1.0;
  }
  
  // Create new MediaSource for streaming
  globalMediaSource = new MediaSource();
  globalAudioElement.src = URL.createObjectURL(globalMediaSource);
  
  return new Promise((resolve, reject) => {
    globalMediaSource!.addEventListener('sourceopen', () => {
      debugLog('[Gemini Live Audio] MediaSource opened');
      
      try {
        // Try to add source buffer for Opus audio
        // Gemini typically sends audio/opus or audio/webm
        const mimeType = 'audio/webm; codecs="opus"';
        if (MediaSource.isTypeSupported(mimeType)) {
          globalSourceBuffer = globalMediaSource!.addSourceBuffer(mimeType);
          debugLog('[Gemini Live Audio] Created source buffer for:', mimeType);
          
          globalSourceBuffer.addEventListener('updateend', processAudioQueue);
          resolve();
        } else {
          debugWarn('[Gemini Live Audio] Opus codec not supported, falling back to PCM worklet');
          // Fall back to PCM worklet approach
          initializePCMWorklet().then(resolve).catch(reject);
        }
      } catch (error) {
        console.error('[Gemini Live Audio] Failed to create source buffer:', error);
        initializePCMWorklet().then(resolve).catch(reject);
      }
    });
    
    globalMediaSource!.addEventListener('sourceended', () => {
      debugLog('[Gemini Live Audio] MediaSource ended');
    });
    
    globalMediaSource!.addEventListener('sourceclose', () => {
      debugLog('[Gemini Live Audio] MediaSource closed');
    });
    
    globalMediaSource!.addEventListener('error', (e) => {
      console.error('[Gemini Live Audio] MediaSource error:', e);
      reject(e);
    });
    
    // Set timeout for initialization
    setTimeout(() => {
      if (!globalSourceBuffer) {
        reject(new Error('MediaSource initialization timeout'));
      }
    }, 5000);
  });
}

// Process queued audio chunks
function processAudioQueue(): void {
  if (isProcessingQueue || audioQueue.length === 0) {
    return;
  }
  
  // Check if MediaSource and SourceBuffer are still valid
  if (!globalMediaSource || globalMediaSource.readyState === 'closed' ||
      !globalSourceBuffer || !globalSourceBuffer.appendBuffer) {
    debugLog('[Gemini Live Audio] MediaSource invalid, reinitializing...');
    // Clear queue and reinitialize
    audioQueue = [];
    isProcessingQueue = false;
    initializeStreamingAudio().catch(console.error);
    return;
  }
  
  if (globalSourceBuffer.updating) {
    return;
  }
  
  isProcessingQueue = true;
  
  try {
    const audioData = audioQueue.shift()!;
    globalSourceBuffer.appendBuffer(audioData);
    debugLog(`[Gemini Live Audio] Appended ${(audioData.byteLength / 1024).toFixed(2)}KB to source buffer`);
  } catch (error) {
    console.error('[Gemini Live Audio] Failed to append audio to source buffer:', error);
    // Reset MediaSource on append failure
    audioQueue = [];
    globalMediaSource = null;
    globalSourceBuffer = null;
    isProcessingQueue = false;
    initializeStreamingAudio().catch(console.error);
    return;
  }
  
  isProcessingQueue = false;
}

// Fallback: Initialize PCM worklet for browsers that don't support Opus streaming
let globalPcmWorkletNode: AudioWorkletNode | null = null;

async function initializePCMWorklet(): Promise<void> {
  if (!globalAudioContext) {
    // Use 24kHz to match Gemini output, or let browser choose optimal rate
    globalAudioContext = new AudioContext({ sampleRate: 24000 });
    
    // Resume context if suspended (required by some browsers)
    if (globalAudioContext.state === 'suspended') {
      await globalAudioContext.resume();
    }
    
    try {
      // Use relative path for the worklet module
      const workletPath = './pcm-processor.js';
      debugLog(`[Gemini Live Audio] Loading audio worklet from: ${workletPath}`);
      debugLog(`[Gemini Live Audio] Audio context sample rate: ${globalAudioContext.sampleRate}Hz`);
      
      // Add error handling and retry logic
      let retries = 3;
      while (retries > 0) {
        try {
          await globalAudioContext.audioWorklet.addModule(workletPath);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          debugWarn(`[Gemini Live Audio] Retrying worklet load... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Create the worklet node with debug mode option
      globalPcmWorkletNode = new AudioWorkletNode(globalAudioContext, 'pcm-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1], // Mono output
        processorOptions: {
          debugEnabled: isDebugEnabled()
        }
      });
      
      // Send debug mode to existing worklet if needed
      if (globalPcmWorkletNode.port) {
        globalPcmWorkletNode.port.postMessage({
          type: 'setDebugMode',
          enabled: isDebugEnabled()
        });
      }
      
      // Connect to destination with gain control
      const gainNode = globalAudioContext.createGain();
      gainNode.gain.value = 0.7; // Reduce volume to prevent distortion
      
      globalPcmWorkletNode.connect(gainNode);
      gainNode.connect(globalAudioContext.destination);
      
      debugLog('[Gemini Live Audio] PCM audio worklet initialized successfully');
      debugLog(`[Gemini Live Audio] Final sample rate: ${globalAudioContext.sampleRate}Hz`);
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to initialize PCM worklet:', error);
      debugError('[Gemini Live Audio] Make sure pcm-processor.js is accessible at ./pcm-processor.js');
      globalAudioContext = null;
      globalPcmWorkletNode = null;
    }
  }
}

// Helper function to play audio data
export async function playAudioData(audioData: ArrayBuffer, outputDeviceId?: string): Promise<void> {
  try {
    debugLog(`[Gemini Live Audio] Starting audio playback: ${(audioData.byteLength / 1024).toFixed(2)}KB`);
    debugLog(`[Gemini Live Audio] Output device: ${outputDeviceId || 'default'}`);
    
    // Check if the audio data is valid
    if (!audioData || audioData.byteLength === 0) {
      debugWarn('[Gemini Live Audio] Received empty audio data');
      return;
    }
    
    // Log first few bytes to identify format
    const firstBytes = new Uint8Array(audioData.slice(0, 4));
    debugLog(`[Gemini Live Audio] First 4 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // Check if this is a WAV file (starts with "RIFF")
    const isWavFile = firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46;
    
    if (isWavFile) {
      debugLog('[Gemini Live Audio] Detected WAV audio format, using Web Audio API decodeAudioData');
      
      // Initialize global audio context if not already done
      if (!globalAudioContext) {
        globalAudioContext = new AudioContext({ sampleRate: 24000 });
      }
      
      // Set output device if specified and supported (non-blocking)
      if (outputDeviceId && 'setSinkId' in globalAudioContext.destination) {
        try {
          await (globalAudioContext.destination as any).setSinkId(outputDeviceId);
          debugLog(`[Gemini Live Audio] Set output device for WAV: ${outputDeviceId}`);
        } catch (error) {
          debugWarn('[Gemini Live Audio] Could not set output device for WAV, continuing with default:', error);
        }
      }
      
      // Decode WAV file using Web Audio API
      const audioBuffer = await globalAudioContext.decodeAudioData(audioData.slice(0));
      
      // Play the decoded audio
      const source = globalAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(globalAudioContext.destination);
      source.start();
      
      debugLog(`[Gemini Live Audio] Successfully played WAV audio: ${audioBuffer.duration.toFixed(2)}s`);
      
    } else {
      debugLog('[Gemini Live Audio] Detected PCM audio format, using PCM worklet');
      
      // Initialize PCM worklet if not already done
      if (!globalPcmWorkletNode) {
        await initializePCMWorklet();
      }
      
      // Set output device if specified and supported (non-blocking)
      if (outputDeviceId && globalAudioContext && 'setSinkId' in globalAudioContext.destination) {
        try {
          await (globalAudioContext.destination as any).setSinkId(outputDeviceId);
          debugLog(`[Gemini Live Audio] Set output device: ${outputDeviceId}`);
        } catch (error) {
          debugWarn('[Gemini Live Audio] Could not set output device, continuing with default:', error);
          // Continue with audio playback even if device setting fails
        }
      }
      
      if (globalPcmWorkletNode && globalAudioContext) {
        try {
          // Create a copy of the ArrayBuffer to avoid detached buffer issues
          const audioDataCopy = audioData.slice(0);
          
          // Gemini returns 24kHz 16-bit PCM audio
          const int16Array = new Int16Array(audioDataCopy);
          
          // No resampling needed if audio context is 24kHz
          // Convert directly to Float32 (-1 to 1 range)
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            // Apply slight gain reduction to prevent clipping
            float32Array[i] = (int16Array[i] / 32768.0) * 0.8;
          }
          
          // Send the audio data to the worklet
          globalPcmWorkletNode.port.postMessage(float32Array);
        
          debugLog(`[Gemini Live Audio] Successfully sent ${float32Array.length} samples to PCM worklet`);
          debugLog(`[Gemini Live Audio] Audio playback initiated successfully via PCM worklet`);
          return;
        } catch (workletError) {
          console.error('[Gemini Live Audio] PCM worklet playback failed:', workletError);
        }
      }
    }
    
    // Fallback: Try to play as WAV with correct format
    debugWarn('[Gemini Live Audio] PCM worklet failed, attempting WAV conversion');
    try {
      // Create a copy of the ArrayBuffer to avoid detached buffer issues
      const audioDataCopy = audioData.slice(0);
      const wavData = createWavFromPcm(audioDataCopy);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.8; // Reduce volume to avoid distortion
      
      // Set output device for WAV fallback (non-blocking)
      if (outputDeviceId && 'setSinkId' in audio) {
        try {
          await (audio as any).setSinkId(outputDeviceId);
          debugLog(`[Gemini Live Audio] Set output device for WAV fallback: ${outputDeviceId}`);
        } catch (deviceError) {
          debugWarn('[Gemini Live Audio] Could not set output device for WAV fallback, continuing with default:', deviceError);
          // Continue with audio playback even if device setting fails
        }
      }
      
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      debugLog('[Gemini Live Audio] Playing as WAV blob');
    } catch (wavError) {
      console.error('[Gemini Live Audio] Failed to play as WAV:', wavError);
    }
  } catch (error) {
    console.error('[Gemini Live Audio] Failed to play audio:', error);
  }
}

// Helper function to create WAV header for PCM data
function createWavFromPcm(pcmData: ArrayBuffer): ArrayBuffer {
  // Ensure we have a valid ArrayBuffer
  if (!pcmData || pcmData.byteLength === 0) {
    debugWarn('[Gemini Live Audio] Empty PCM data provided to createWavFromPcm');
    // Return a minimal valid WAV file with silence
    const silentWav = new ArrayBuffer(44);
    const view = new DataView(silentWav);
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 24000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, 0, true);
    return silentWav;
  }
  
  const pcmLength = pcmData.byteLength;
  const wavBuffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(wavBuffer);
  
  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24000, true); // sample rate (Gemini outputs at 24kHz)
  view.setUint32(28, 24000 * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcmLength, true);
  
  try {
    // Copy PCM data safely
    const pcmView = new Uint8Array(pcmData);
    const wavView = new Uint8Array(wavBuffer);
    wavView.set(pcmView, 44);
  } catch (error) {
    debugError('[Gemini Live Audio] Error copying PCM data to WAV buffer:', error);
    // Return the header-only WAV if data copy fails
    const headerOnlyWav = wavBuffer.slice(0, 44);
    const headerView = new DataView(headerOnlyWav);
    headerView.setUint32(4, 36, true); // Update file size
    headerView.setUint32(40, 0, true); // Update data size
    return headerOnlyWav;
  }
  
  return wavBuffer;
}

// Language mapping for Gemini
export const GEMINI_LANGUAGE_MAP: Record<string, string> = {
  'english': 'English',
  'japanese': 'Japanese',
  'chinese': 'Chinese (Simplified)',
  'traditionalChinese': 'Chinese (Traditional)',
  'korean': 'Korean',
  'spanish': 'Spanish',
  'french': 'French',
  'german': 'German',
  'italian': 'Italian',
  'portuguese': 'Portuguese',
  'russian': 'Russian',
  'arabic': 'Arabic',
  'hindi': 'Hindi',
  'bengali': 'Bengali',
  'vietnamese': 'Vietnamese',
  'thai': 'Thai',
  'turkish': 'Turkish',
  'polish': 'Polish',
  'czech': 'Czech',
  'hungarian': 'Hungarian',
  'bulgarian': 'Bulgarian',
  'javanese': 'Javanese',
  'tamil': 'Tamil',
  'burmese': 'Burmese',
  'hebrew': 'Hebrew',
};
