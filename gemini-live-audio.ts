import {
  GoogleGenAI,
  LiveServerMessage,
  MediaResolution,
  Modality,
  Session,
} from '@google/genai';
import { languagePromptManager, getLanguageSpecificPrompt } from './translation-prompts';

export interface GeminiLiveAudioConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onError?: (error: Error) => void;
}

export class GeminiLiveAudioStream {
  private session: Session | null = null;
  private ai: GoogleGenAI;
  private config: GeminiLiveAudioConfig;
  private responseQueue: LiveServerMessage[] = [];
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private isProcessing = false;
  private audioBuffer: Float32Array[] = [];
  private sessionConnected = false;

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
      this.audioContext = new AudioContext({ sampleRate: 16000 });

      // Initialize the session
      console.log('[Gemini Live Audio] About to initialize session...');
      await this.initializeSession();
      console.log('[Gemini Live Audio] Session initialization completed');

      // Start processing audio from the media stream
      console.log('[Gemini Live Audio] About to setup audio processing...');
      await this.setupAudioProcessing();
      console.log('[Gemini Live Audio] Audio processing setup completed');
      
      // Delay initial prompt to avoid immediate audio response
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
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr',
          }
        }
      },
      systemInstruction: {
        parts: [{
          text: getLanguageSpecificPrompt(this.config.sourceLanguage, this.config.targetLanguage),
        }]
      },
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
          this.config.onError?.(new Error(e.message));
        },
        onclose: (e: CloseEvent) => {
          console.log('[Gemini Live Audio] Session closed:', e.reason);
          this.sessionConnected = false;
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
    if (!this.audioContext || !this.mediaStream) return;

    console.log('[Gemini Live Audio] Setting up audio processing pipeline...');
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    
    // Create a script processor to capture audio data
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.isProcessing || !this.session) return;
      
      const inputData = event.inputBuffer.getChannelData(0);
      this.audioBuffer.push(new Float32Array(inputData));
      
      // Send audio chunks periodically using sendRealtimeInput
      if (this.audioBuffer.length >= 8) { // ~0.3 seconds of audio at 16kHz
        this.sendAudioChunk();
      }
    };

    source.connect(this.scriptProcessor);
    // IMPORTANT: Do NOT connect to destination to avoid audio feedback
    // this.scriptProcessor.connect(this.audioContext.destination);
    
    // Create a silent node to keep the script processor running
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    this.scriptProcessor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
    
    this.isProcessing = true;
    console.log('[Gemini Live Audio] Audio processing pipeline ready (no audio feedback)');
  }

  private sendInitialPrompt(): void {
    if (!this.session || !this.isProcessing) return;
    
    try {
      console.log('[Gemini Live Audio] Sending translation context reinforcement...');
      
      // Send language-specific reinforcement message
      const reinforcementPrompt = languagePromptManager.getReinforcementPrompt(this.config.targetLanguage);
      this.session.sendRealtimeInput({
        text: reinforcementPrompt
      });
      
      console.log('[Gemini Live Audio] Translation context reinforcement sent');
    } catch (error) {
      console.error('[Gemini Live Audio] Error in initial setup:', error);
    }
  }

  private sendAudioChunk(): void {
    if (!this.session || this.audioBuffer.length === 0 || !this.isProcessing) return;

    // Check if session is still open before sending
    // The session object should have a way to check its state
    try {
      // First check if we can safely send data
      if (!this.session || !this.isProcessing) {
        console.log('[Gemini Live Audio] Session not ready, skipping audio chunk');
        return;
      }
      
      // Combine audio buffers
      const totalLength = this.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
      const combinedBuffer = new Float32Array(totalLength);
      let offset = 0;
      
      for (const buffer of this.audioBuffer) {
        combinedBuffer.set(buffer, offset);
        offset += buffer.length;
      }
      
      // Convert to 16-bit PCM
      const pcmData = this.float32ToPCM16(combinedBuffer);
      const base64Audio = this.arrayBufferToBase64(pcmData.buffer as ArrayBuffer);

      console.log(`[Gemini Live Audio] Sending audio chunk: ${totalLength} samples, ${(base64Audio.length / 1024).toFixed(2)}KB`);
      
      // Send audio to Gemini using sendRealtimeInput for real-time processing
      // Include translation instruction with every few audio chunks to reinforce behavior
      const shouldReinforce = Math.random() < 0.1; // 10% chance to reinforce
      
      if (shouldReinforce) {
        const reinforcementPrompt = languagePromptManager.getReinforcementPrompt(this.config.targetLanguage);
        this.session.sendRealtimeInput({
          text: reinforcementPrompt
        });
      }
      
      this.session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: 'audio/pcm;rate=16000'
        }
      });
      
      this.audioBuffer = []; // Clear the buffer
    } catch (error) {
      // Handle various error cases
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED')) {
        console.log('[Gemini Live Audio] Session is closing/closed, stopping audio processing');
        this.isProcessing = false;
        this.audioBuffer = []; // Clear any pending audio
        
        // Try to clean up the session
        if (this.session) {
          try {
            this.session.close();
          } catch (closeError) {
            // Ignore close errors
          }
          this.session = null;
        }
      } else if (errorMessage.includes('WebSocket')) {
        console.error('[Gemini Live Audio] WebSocket error, stopping processing:', errorMessage);
        this.isProcessing = false;
        this.audioBuffer = [];
      } else {
        console.error('[Gemini Live Audio] Error sending audio chunk:', error);
      }
    }
  }

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
    if (message.serverContent?.modelTurn?.parts) {
      const parts = message.serverContent.modelTurn.parts;
      console.log(`[Gemini Live Audio] Processing ${parts.length} parts from response`);
      
      for (const part of parts) {
        // Handle text response
        if (part.text) {
          console.log('[Gemini Live Audio] Received translated text:', part.text);
          this.config.onTextReceived?.(part.text);
        }
        
        // Handle audio response
        if (part.inlineData && part.inlineData.data) {
          const audioData = this.base64ToArrayBuffer(part.inlineData.data);
          const mimeType = part.inlineData.mimeType || 'audio/pcm';
          
          console.log(`[Gemini Live Audio] Received audio data: ${(audioData.byteLength / 1024).toFixed(2)}KB`);
          console.log(`[Gemini Live Audio] Audio MIME type: ${mimeType}`);
          
          // Log first few bytes to help identify format
          const firstBytes = new Uint8Array(audioData.slice(0, 8));
          console.log(`[Gemini Live Audio] First 8 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
          
          // Check audio format signatures
          if (firstBytes[0] === 0x1a && firstBytes[1] === 0x45 && firstBytes[2] === 0xdf && firstBytes[3] === 0xa3) {
            console.log('[Gemini Live Audio] Detected WebM/Matroska format');
          } else if (firstBytes[0] === 0x4f && firstBytes[1] === 0x67 && firstBytes[2] === 0x67 && firstBytes[3] === 0x53) {
            console.log('[Gemini Live Audio] Detected Ogg format');
          } else if (mimeType.includes('pcm')) {
            console.log('[Gemini Live Audio] Detected PCM audio format');
          } else {
            console.log('[Gemini Live Audio] Unknown audio format, will attempt to play');
          }
          
          // Pass the audio data with MIME type info
          this.config.onAudioReceived?.(audioData);
        }
      }
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async stop(): Promise<void> {
    console.log('[Gemini Live Audio] Stopping stream...');
    this.isProcessing = false;
    this.sessionConnected = false;
    
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    
    if (this.audioWorkletNode) {
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    
    this.audioBuffer = [];
    this.responseQueue = [];
    console.log('[Gemini Live Audio] Stream stopped');
  }

  isActive(): boolean {
    return this.session !== null && this.sessionConnected && this.isProcessing;
  }

  /**
   * Update target language dynamically when new participants join
   */
  updateTargetLanguage(newTargetLanguage: string): void {
    if (!this.isActive()) {
      console.warn('[Gemini Live Audio] Cannot update language - stream not active');
      return;
    }

    const oldTargetLanguage = this.config.targetLanguage;
    this.config.targetLanguage = newTargetLanguage;
    
    console.log(`[Gemini Live Audio] Updated target language: ${oldTargetLanguage} → ${newTargetLanguage}`);
    
    // Send reinforcement prompt with new language context
    if (this.session && this.isProcessing) {
      try {
        const reinforcementPrompt = languagePromptManager.getReinforcementPrompt(newTargetLanguage);
        this.session.sendRealtimeInput({
          text: `LANGUAGE UPDATE: Now translating to ${newTargetLanguage}. ${reinforcementPrompt}`
        });
        console.log(`[Gemini Live Audio] Sent language update reinforcement for ${newTargetLanguage}`);
      } catch (error) {
        console.error('[Gemini Live Audio] Error sending language update:', error);
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
    console.log(`[Gemini Live Audio] Received audio data: ${(audioData.byteLength / 1024).toFixed(2)}KB`);
    
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
    
    // Set output device if specified and supported
    if (outputDeviceId && globalAudioContext && 'setSinkId' in globalAudioContext.destination) {
      try {
        await (globalAudioContext.destination as any).setSinkId(outputDeviceId);
        console.log(`[Gemini Live Audio] Set output device: ${outputDeviceId}`);
      } catch (error) {
        console.warn('[Gemini Live Audio] Could not set output device:', error);
      }
    }
    
    if (globalPcmWorkletNode && globalAudioContext) {
      try {
        // Gemini returns 24kHz 16-bit PCM audio
        const int16Array = new Int16Array(audioData);
        
        // No resampling needed if audio context is 24kHz
        // Convert directly to Float32 (-1 to 1 range)
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          // Apply slight gain reduction to prevent clipping
          float32Array[i] = (int16Array[i] / 32768.0) * 0.8;
        }
        
        // Send the audio data to the worklet
        globalPcmWorkletNode.port.postMessage(float32Array);
        
        console.log(`[Gemini Live Audio] Sent ${float32Array.length} samples to PCM worklet`);
        return;
      } catch (workletError) {
        console.error('[Gemini Live Audio] PCM worklet playback failed:', workletError);
      }
    }
    
    // Fallback: Try to play as WAV with correct format
    console.warn('[Gemini Live Audio] PCM worklet failed, attempting WAV conversion');
    try {
      const wavData = createWavFromPcm(audioData);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.8; // Reduce volume to avoid distortion
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
  
  // Copy PCM data
  const pcmView = new Uint8Array(pcmData);
  const wavView = new Uint8Array(wavBuffer);
  wavView.set(pcmView, 44);
  
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