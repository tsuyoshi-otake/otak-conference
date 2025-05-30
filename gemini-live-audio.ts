import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
} from '@google/genai';
import { languagePromptManager, getLanguageSpecificPrompt } from './translation-prompts';
import { createBlob, decode, decodeAudioData, float32ToBase64PCM } from './gemini-utils';

export interface GeminiLiveAudioConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onError?: (error: Error) => void;
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
}

export class GeminiLiveAudioStream {
  private session: Session | null = null;
  private ai: GoogleGenAI;
  private config: GeminiLiveAudioConfig;
  
  // Audio contexts for input and output (following Google's sample)
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  
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
  
  // Audio buffering for rate limiting
  private audioBuffer: Float32Array[] = [];
  private lastSendTime = 0;
  private sendInterval = 1500; // Send audio every 1500ms (1.5 seconds) to reduce API calls
  
  // Token usage tracking
  private sessionInputTokens = 0;
  private sessionOutputTokens = 0;
  private sessionCost = 0;

  constructor(config: GeminiLiveAudioConfig) {
    this.config = config;
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
    });
  }

  async start(mediaStream: MediaStream): Promise<void> {
    try {
      console.log('[Gemini Live Audio] Starting stream...');
      console.log(`[Gemini Live Audio] Source Language: ${this.config.sourceLanguage}`);
      console.log(`[Gemini Live Audio] Target Language: ${this.config.targetLanguage}`);
      
      this.mediaStream = mediaStream;
      // Initialize separate audio contexts for input and output (following Google's sample)
      this.inputAudioContext = new AudioContext({ sampleRate: 16000 });
      this.outputAudioContext = new AudioContext({ sampleRate: 24000 });
      
      // Create gain nodes for audio management
      this.inputNode = this.inputAudioContext.createGain();
      this.outputNode = this.outputAudioContext.createGain();
      this.outputNode.connect(this.outputAudioContext.destination);
      
      // Initialize audio timing
      this.nextStartTime = this.outputAudioContext.currentTime;

      // Initialize the session
      console.log('[Gemini Live Audio] About to initialize session...');
      await this.initializeSession();
      console.log('[Gemini Live Audio] Session initialization completed');

      // Start processing audio from the media stream
      console.log('[Gemini Live Audio] About to setup audio processing...');
      await this.setupAudioProcessing();
      console.log('[Gemini Live Audio] Audio processing setup completed');
      
      // Send initial prompt to reinforce translation context
      setTimeout(() => {
        this.sendInitialPrompt();
      }, 1000);
      
      console.log('[Gemini Live Audio] Stream started successfully');
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to start stream:', error);
      console.error('[Gemini Live Audio] Error details:', error);
      if (error instanceof Error) {
        console.error('[Gemini Live Audio] Error message:', error.message);
        console.error('[Gemini Live Audio] Error stack:', error.stack);
      }
      this.config.onError?.(error as Error);
      throw error; // Re-throw to ensure the test catches it
    }
  }

  private async initializeSession(): Promise<void> {
    const model = 'models/gemini-2.5-flash-preview-native-audio-dialog';
    console.log(`[Gemini Live Audio] Initializing session with model: ${model}`);

    const config = {
      responseModalities: [Modality.AUDIO], // Only one modality at a time
      // Removed mediaResolution as it's not needed for audio-only mode
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr',
          }
        }
      },
      // No system instruction - using initial prompt instead
    };

    console.log('[Gemini Live Audio] Connecting to API...');
    this.session = await this.ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          console.log('[Gemini Live Audio] Session opened successfully');
          this.sessionConnected = true;
        },
        onmessage: (message: LiveServerMessage) => {
          console.log('[Gemini Live Audio] Received message:', {
            hasModelTurn: !!message.serverContent?.modelTurn,
            hasParts: !!message.serverContent?.modelTurn?.parts,
            turnComplete: message.serverContent?.turnComplete,
            setupComplete: !!message.setupComplete
          });
          
          // Check if this is a setup complete message
          if (message.setupComplete) {
            console.log('[Gemini Live Audio] Setup completed, session is ready');
            this.sessionConnected = true;
          }
          
          this.handleServerMessage(message);
        },
        onerror: (e: ErrorEvent) => {
          console.error('[Gemini Live Audio] Error:', e.message);
          this.sessionConnected = false;
          
          // Check for quota error specifically
          if (e.message.includes('quota') || e.message.includes('exceeded')) {
            console.error('[Gemini Live Audio] API quota exceeded - translation service temporarily unavailable');
            this.config.onError?.(new Error('API quota exceeded. Please try again later or check your Gemini API billing settings.'));
          } else {
            this.config.onError?.(new Error(e.message));
          }
        },
        onclose: (e: CloseEvent) => {
          console.log('[Gemini Live Audio] Session closed:', e.reason);
          this.sessionConnected = false;
          
          // Check for quota error in close reason
          if (e.reason && (e.reason.includes('quota') || e.reason.includes('exceeded'))) {
            console.error('[Gemini Live Audio] Session closed due to quota limit');
            this.config.onError?.(new Error('API quota exceeded. Gemini API usage limit has been reached.'));
          }
        },
      },
      config
    });
    console.log('[Gemini Live Audio] Session initialized, waiting for setup completion...');
    
    // Mark as connected after session creation
    // The session is ready to use even before setupComplete message
    this.sessionConnected = true;
  }

  private async setupAudioProcessing(): Promise<void> {
    if (!this.inputAudioContext || !this.mediaStream) return;

    console.log('[Gemini Live Audio] Setting up audio processing pipeline...');
    
    // Create media stream source and connect to input node
    this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    this.sourceNode.connect(this.inputNode!);
    
    // Create script processor for audio capture (following Google's sample)
    const bufferSize = 256; // Smaller buffer for better responsiveness
    this.scriptProcessor = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (event) => {
      // Check session state before processing
      if (!this.isProcessing || !this.session || !this.sessionConnected) return;
      
      const inputBuffer = event.inputBuffer;
      const pcmData = inputBuffer.getChannelData(0);
      
      // Buffer audio data instead of sending immediately
      this.audioBuffer.push(new Float32Array(pcmData));
      
      // Send buffered audio at controlled intervals (1500ms)
      const currentTime = Date.now();
      if (currentTime - this.lastSendTime >= this.sendInterval) {
        this.sendBufferedAudio();
        this.lastSendTime = currentTime;
      }
    };

    // Connect audio processing chain
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.inputAudioContext.destination);
    
    this.isProcessing = true;
    console.log('[Gemini Live Audio] Audio processing pipeline ready');
  }

  // Gemini 2.5 Flash pricing (per 1M tokens)
  private static readonly PRICING = {
    INPUT_AUDIO_PER_SECOND: 0.000125, // $0.125 per 1M tokens, ~1 token per second of audio
    OUTPUT_AUDIO_PER_SECOND: 0.000375, // $0.375 per 1M tokens, ~1 token per second of audio
    INPUT_TEXT_PER_TOKEN: 0.000125 / 1000000, // $0.125 per 1M tokens
    OUTPUT_TEXT_PER_TOKEN: 0.000375 / 1000000 // $0.375 per 1M tokens
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
    
    console.log(`[Gemini Live Audio] Token usage - Input: ${inputTokens}, Output: ${totalOutputTokens}, Cost: $${totalCost.toFixed(6)}`);
    console.log(`[Gemini Live Audio] Session total - Input: ${this.sessionInputTokens}, Output: ${this.sessionOutputTokens}, Cost: $${this.sessionCost.toFixed(6)}`);
    
    // Notify callback
    this.config.onTokenUsage?.({
      inputTokens: this.sessionInputTokens,
      outputTokens: this.sessionOutputTokens,
      cost: this.sessionCost
    });
  }

  private sendBufferedAudio(): void {
    if (!this.session || this.audioBuffer.length === 0 || !this.sessionConnected) return;

    try {
      // Combine all buffered audio chunks
      const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const combinedBuffer = new Float32Array(totalLength);
      let offset = 0;
      
      for (const buffer of this.audioBuffer) {
        combinedBuffer.set(buffer, offset);
        offset += buffer.length;
      }
      
      // Convert to base64 PCM for Gemini
      const base64Audio = float32ToBase64PCM(combinedBuffer);
      
      const audioLengthSeconds = totalLength / 16000;
      console.log(`[Gemini Live Audio] Sending buffered audio: ${totalLength} samples (${audioLengthSeconds.toFixed(2)}s)`);
      
      this.session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
      
      // Track input token usage
      this.updateTokenUsage(audioLengthSeconds);
      
      // Clear the buffer after sending
      this.audioBuffer = [];
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED') ||
          errorMessage.includes('quota') || errorMessage.includes('WebSocket')) {
        console.log('[Gemini Live Audio] Session closed during buffered send, stopping');
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

  private sendInitialPrompt(): void {
    if (!this.session || !this.isProcessing || !this.sessionConnected) return;
    
    try {
      console.log('[Gemini Live Audio] Sending language-specific translation context...');
      
      // Send language-specific reinforcement message
      const getReinforcementPrompt = (sourceLanguage: string, targetLanguage: string): string => {
        if (sourceLanguage === 'japanese' && targetLanguage === 'vietnamese') {
          return '貴方はプロの通訳です。日本語からベトナム語に通訳してください。翻訳後の内容だけ出力してください。';
        } else if (sourceLanguage === 'vietnamese' && targetLanguage === 'japanese') {
          return 'Bạn là phiên dịch viên chuyên nghiệp. Hãy dịch từ tiếng Việt sang tiếng Nhật. Chỉ xuất nội dung sau khi dịch.';
        } else if (sourceLanguage === 'japanese' && targetLanguage === 'english') {
          return '貴方はプロの通訳です。日本語から英語に通訳してください。翻訳後の内容だけ出力してください。';
        } else if (sourceLanguage === 'english' && targetLanguage === 'japanese') {
          return 'You are a professional interpreter. Please translate from English to Japanese. Output only the translated content.';
        } else if (sourceLanguage === 'vietnamese' && targetLanguage === 'english') {
          return 'Bạn là phiên dịch viên chuyên nghiệp. Hãy dịch từ tiếng Việt sang tiếng Anh. Chỉ xuất nội dung sau khi dịch.';
        } else if (sourceLanguage === 'english' && targetLanguage === 'vietnamese') {
          return 'You are a professional interpreter. Please translate from English to Vietnamese. Output only the translated content.';
        } else {
          return `You are a professional interpreter. Please translate from ${sourceLanguage} to ${targetLanguage}. Output only the translated content.`;
        }
      };
      
      const reinforcementPrompt = getReinforcementPrompt(this.config.sourceLanguage, this.config.targetLanguage);
      this.session.sendRealtimeInput({
        text: reinforcementPrompt
      });
      
      console.log('[Gemini Live Audio] Language-specific translation context sent');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED') ||
          errorMessage.includes('quota') || errorMessage.includes('WebSocket')) {
        console.log('[Gemini Live Audio] Session closed during initial prompt, stopping');
        this.isProcessing = false;
        this.sessionConnected = false;
      } else {
        console.error('[Gemini Live Audio] Error in initial setup:', error);
      }
    }
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

  private handleServerMessage(message: LiveServerMessage): void {
    // Handle audio response (following Google's sample pattern)
    const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData;
    
    if (audio && audio.data && this.outputAudioContext) {
      this.nextStartTime = Math.max(
        this.nextStartTime,
        this.outputAudioContext.currentTime,
      );

      // Decode and play audio using the improved method
      this.playAudioResponse(audio.data);
    }

    // Handle interruption (following Google's sample)
    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
      console.log('[Gemini Live Audio] Received interruption signal');
      for (const source of this.sources.values()) {
        source.stop();
        this.sources.delete(source);
      }
      this.nextStartTime = 0;
    }

    // Handle text response
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part.text) {
          console.log('[Gemini Live Audio] Received translated text:', part.text);
          
          // Track output token usage for received text
          this.updateTokenUsage(0, 0, part.text);
          
          this.config.onTextReceived?.(part.text);
        }
      }
    }
  }

  private async playAudioResponse(base64Audio: string): Promise<void> {
    if (!this.outputAudioContext || !this.outputNode) return;
    
    // Set playing state to true
    this.setPlayingState(true);

    try {
      const audioData = decode(base64Audio);
      
      // Validate audio data before processing
      if (!audioData || audioData.byteLength === 0) {
        console.warn('[Gemini Live Audio] Received empty audio data');
        return;
      }
      
      console.log(`[Gemini Live Audio] Processing audio response: ${audioData.byteLength} bytes`);
      
      const audioBuffer = await decodeAudioData(
        audioData,
        this.outputAudioContext,
        24000, // Gemini outputs at 24kHz
        1      // Mono
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      
      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime = this.nextStartTime + audioBuffer.duration;
      this.sources.add(source);

      const audioDurationSeconds = audioBuffer.duration;
      console.log(`[Gemini Live Audio] Playing audio: ${audioDurationSeconds.toFixed(2)}s`);
      
      // Track output token usage for received audio
      this.updateTokenUsage(0, audioDurationSeconds);
      
      // Also call the callback for compatibility (create a copy to avoid detached buffer)
      this.config.onAudioReceived?.(audioData.slice(0));
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to play audio response:', error);
      console.error('[Gemini Live Audio] Error details:', error);
    }
  }

  // Removed base64ToArrayBuffer - now using decode function from gemini-utils

  async stop(): Promise<void> {
    console.log('[Gemini Live Audio] Stopping stream...');
    this.isProcessing = false;
    this.sessionConnected = false;
    
    // Disconnect audio processing nodes
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    // Stop all audio sources (following Google's sample)
    for (const source of this.sources.values()) {
      source.stop();
      this.sources.delete(source);
    }
    
    // Close audio contexts
    if (this.inputAudioContext) {
      await this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    
    if (this.outputAudioContext) {
      await this.outputAudioContext.close();
      this.outputAudioContext = null;
    }
    
    // Close session
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    
    // Reset nodes and clear buffers
    this.inputNode = null;
    this.outputNode = null;
    this.nextStartTime = 0;
    this.audioBuffer = [];
    this.lastSendTime = 0;
    
    // Reset token usage for new session
    this.sessionInputTokens = 0;
    this.sessionOutputTokens = 0;
    this.sessionCost = 0;
    
    console.log('[Gemini Live Audio] Stream stopped');
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
   */
  updateTargetLanguage(newTargetLanguage: string): void {
    if (!this.isSessionReady()) {
      console.warn('[Gemini Live Audio] Cannot update language - session not ready');
      return;
    }

    const oldTargetLanguage = this.config.targetLanguage;
    this.config.targetLanguage = newTargetLanguage;
    
    console.log(`[Gemini Live Audio] Updated target language: ${oldTargetLanguage} → ${newTargetLanguage}`);
    
    // Send language-specific reinforcement prompt with new language context
    if (this.session && this.isProcessing && this.sessionConnected) {
      try {
        const getLanguageUpdatePrompt = (sourceLanguage: string, targetLanguage: string): string => {
          if (sourceLanguage === 'japanese' && targetLanguage === 'vietnamese') {
            return '言語設定が更新されました。日本語からベトナム語への通訳を継続します。翻訳後の内容のみを出力してください。';
          } else if (sourceLanguage === 'vietnamese' && targetLanguage === 'japanese') {
            return 'Cài đặt ngôn ngữ đã được cập nhật. Tiếp tục phiên dịch từ tiếng Việt sang tiếng Nhật. Chỉ xuất nội dung sau khi dịch.';
          } else if (sourceLanguage === 'japanese' && targetLanguage === 'english') {
            return '言語設定が更新されました。日本語から英語への通訳を継続します。翻訳後の内容のみを出力してください。';
          } else if (sourceLanguage === 'english' && targetLanguage === 'japanese') {
            return 'Language settings updated. Continue translating from English to Japanese. Output only the translated content.';
          } else if (sourceLanguage === 'vietnamese' && targetLanguage === 'english') {
            return 'Cài đặt ngôn ngữ đã được cập nhật. Tiếp tục phiên dịch từ tiếng Việt sang tiếng Anh. Chỉ xuất nội dung sau khi dịch.';
          } else if (sourceLanguage === 'english' && targetLanguage === 'vietnamese') {
            return 'Language settings updated. Continue translating from English to Vietnamese. Output only the translated content.';
          } else {
            return `Language settings updated. Continue translating from ${sourceLanguage} to ${targetLanguage}. Output only the translated content.`;
          }
        };
        
        const updatePrompt = getLanguageUpdatePrompt(this.config.sourceLanguage, newTargetLanguage);
        this.session.sendRealtimeInput({
          text: updatePrompt
        });
        console.log(`[Gemini Live Audio] Sent language-specific update prompt for ${newTargetLanguage}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED') ||
            errorMessage.includes('quota') || errorMessage.includes('WebSocket')) {
          console.log('[Gemini Live Audio] Session closed during language update, stopping');
          this.isProcessing = false;
          this.sessionConnected = false;
        } else {
          console.error('[Gemini Live Audio] Error sending language update:', error);
        }
      }
    }
  }

  /**
   * Get current target language
   */
  getCurrentTargetLanguage(): string {
    return this.config.targetLanguage;
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
      console.log('[Gemini Live Audio] MediaSource opened');
      
      try {
        // Try to add source buffer for Opus audio
        // Gemini typically sends audio/opus or audio/webm
        const mimeType = 'audio/webm; codecs="opus"';
        if (MediaSource.isTypeSupported(mimeType)) {
          globalSourceBuffer = globalMediaSource!.addSourceBuffer(mimeType);
          console.log('[Gemini Live Audio] Created source buffer for:', mimeType);
          
          globalSourceBuffer.addEventListener('updateend', processAudioQueue);
          resolve();
        } else {
          console.warn('[Gemini Live Audio] Opus codec not supported, falling back to PCM worklet');
          // Fall back to PCM worklet approach
          initializePCMWorklet().then(resolve).catch(reject);
        }
      } catch (error) {
        console.error('[Gemini Live Audio] Failed to create source buffer:', error);
        initializePCMWorklet().then(resolve).catch(reject);
      }
    });
    
    globalMediaSource!.addEventListener('sourceended', () => {
      console.log('[Gemini Live Audio] MediaSource ended');
    });
    
    globalMediaSource!.addEventListener('sourceclose', () => {
      console.log('[Gemini Live Audio] MediaSource closed');
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
    console.log('[Gemini Live Audio] MediaSource invalid, reinitializing...');
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
    console.log(`[Gemini Live Audio] Appended ${(audioData.byteLength / 1024).toFixed(2)}KB to source buffer`);
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
      console.log(`[Gemini Live Audio] Loading audio worklet from: ${workletPath}`);
      console.log(`[Gemini Live Audio] Audio context sample rate: ${globalAudioContext.sampleRate}Hz`);
      
      // Add error handling and retry logic
      let retries = 3;
      while (retries > 0) {
        try {
          await globalAudioContext.audioWorklet.addModule(workletPath);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          console.warn(`[Gemini Live Audio] Retrying worklet load... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Create the worklet node with options
      globalPcmWorkletNode = new AudioWorkletNode(globalAudioContext, 'pcm-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1] // Mono output
      });
      
      // Connect to destination with gain control
      const gainNode = globalAudioContext.createGain();
      gainNode.gain.value = 0.7; // Reduce volume to prevent distortion
      
      globalPcmWorkletNode.connect(gainNode);
      gainNode.connect(globalAudioContext.destination);
      
      console.log('[Gemini Live Audio] PCM audio worklet initialized successfully');
      console.log(`[Gemini Live Audio] Final sample rate: ${globalAudioContext.sampleRate}Hz`);
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to initialize PCM worklet:', error);
      console.error('[Gemini Live Audio] Make sure pcm-processor.js is accessible at ./pcm-processor.js');
      globalAudioContext = null;
      globalPcmWorkletNode = null;
    }
  }
}

// Helper function to play audio data
export async function playAudioData(audioData: ArrayBuffer, outputDeviceId?: string): Promise<void> {
  try {
    console.log(`[Gemini Live Audio] Starting audio playback: ${(audioData.byteLength / 1024).toFixed(2)}KB`);
    console.log(`[Gemini Live Audio] Output device: ${outputDeviceId || 'default'}`);
    
    // Check if the audio data is valid
    if (!audioData || audioData.byteLength === 0) {
      console.warn('[Gemini Live Audio] Received empty audio data');
      return;
    }
    
    // Log first few bytes to identify format
    const firstBytes = new Uint8Array(audioData.slice(0, 4));
    console.log(`[Gemini Live Audio] First 4 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    
    // For Gemini PCM data, use PCM worklet directly (skip MediaSource)
    console.log('[Gemini Live Audio] Detected PCM audio format, using PCM worklet');
    
    // Initialize PCM worklet if not already done
    if (!globalPcmWorkletNode) {
      await initializePCMWorklet();
    }
    
    // Set output device if specified and supported (non-blocking)
    if (outputDeviceId && globalAudioContext && 'setSinkId' in globalAudioContext.destination) {
      try {
        await (globalAudioContext.destination as any).setSinkId(outputDeviceId);
        console.log(`[Gemini Live Audio] Set output device: ${outputDeviceId}`);
      } catch (error) {
        console.warn('[Gemini Live Audio] Could not set output device, continuing with default:', error);
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
        
        console.log(`[Gemini Live Audio] Successfully sent ${float32Array.length} samples to PCM worklet`);
        console.log(`[Gemini Live Audio] Audio playback initiated successfully via PCM worklet`);
        return;
      } catch (workletError) {
        console.error('[Gemini Live Audio] PCM worklet playback failed:', workletError);
      }
    }
    
    // Fallback: Try to play as WAV with correct format
    console.warn('[Gemini Live Audio] PCM worklet failed, attempting WAV conversion');
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
          console.log(`[Gemini Live Audio] Set output device for WAV fallback: ${outputDeviceId}`);
        } catch (deviceError) {
          console.warn('[Gemini Live Audio] Could not set output device for WAV fallback, continuing with default:', deviceError);
          // Continue with audio playback even if device setting fails
        }
      }
      
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      console.log('[Gemini Live Audio] Playing as WAV blob');
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
    console.warn('[Gemini Live Audio] Empty PCM data provided to createWavFromPcm');
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
    console.error('[Gemini Live Audio] Error copying PCM data to WAV buffer:', error);
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