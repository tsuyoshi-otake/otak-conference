import { 
  GoogleGenAI, 
  LiveServerMessage, 
  MediaResolution, 
  Modality, 
  Session 
} from '@google/genai';
import { VoiceSettings } from './types';

// Language code mapping for Gemini API
const languageCodeMap: Record<string, string> = {
  english: 'en',
  french: 'fr',
  german: 'de',
  italian: 'it',
  spanish: 'es',
  portuguese: 'pt',
  czech: 'cs',
  hungarian: 'hu',
  bulgarian: 'bg',
  turkish: 'tr',
  polish: 'pl',
  russian: 'ru',
  japanese: 'ja',
  chinese: 'zh',
  traditionalChinese: 'zh-TW',
  korean: 'ko',
  vietnamese: 'vi',
  thai: 'th',
  hindi: 'hi',
  bengali: 'bn',
  javanese: 'jv',
  tamil: 'ta',
  burmese: 'my',
  arabic: 'ar',
  hebrew: 'he'
};

export class GeminiTranslationService {
  private ai: GoogleGenAI;
  private model: string = 'gemini-2.5-flash-001';

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  // Convert audio blob to base64
  private async audioToBase64(audioBlob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        // Remove data URL prefix
        const base64Data = base64.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(audioBlob);
    });
  }

  // Transcribe audio and translate to target language
  async transcribeAndTranslate(
    audioBlob: Blob,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<{ original: string; translation: string }> {
    try {
      const base64Audio = await this.audioToBase64(audioBlob);
      const sourceLangCode = languageCodeMap[sourceLanguage] || 'en';
      const targetLangCode = languageCodeMap[targetLanguage] || 'en';

      // Create prompt for transcription and translation
      const prompt = `You are a real-time conference translator. 
      
      1. First, transcribe the audio in ${sourceLanguage} (${sourceLangCode}).
      2. Then translate it to ${targetLanguage} (${targetLangCode}).
      
      Return the response in this exact JSON format:
      {
        "original": "transcribed text in original language",
        "translation": "translated text in target language"
      }
      
      Only return the JSON, no other text.`;

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'audio/webm',
                  data: base64Audio
                }
              }
            ]
          }
        ],
        config: {
          temperature: 0.1,
          topP: 0.95,
          topK: 20,
          maxOutputTokens: 500
        }
      });

      const responseText = response.text || '';
      
      // Parse JSON response
      try {
        const result = JSON.parse(responseText);
        return {
          original: result.original || '',
          translation: result.translation || ''
        };
      } catch (parseError) {
        console.error('Failed to parse Gemini response:', responseText);
        // Fallback: try to extract text even if not proper JSON
        return {
          original: responseText,
          translation: responseText
        };
      }
    } catch (error) {
      console.error('Gemini API error:', error);
      throw error;
    }
  }

  // Simple text translation (for testing or fallback)
  async translateText(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string> {
    try {
      const sourceLangCode = languageCodeMap[sourceLanguage] || 'en';
      const targetLangCode = languageCodeMap[targetLanguage] || 'en';

      const prompt = `Translate the following text from ${sourceLanguage} (${sourceLangCode}) to ${targetLanguage} (${targetLangCode}). Only return the translated text, nothing else:

"${text}"`;

      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          temperature: 0.1,
          topP: 0.95,
          topK: 20,
          maxOutputTokens: 500
        }
      });

      return (response.text || '').trim();
    } catch (error) {
      console.error('Gemini translation error:', error);
      throw error;
    }
  }
}

// Audio recording utilities
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingInterval: NodeJS.Timeout | null = null;
  private onAudioCallback: ((audioBlob: Blob) => void) | null = null;

  constructor() {}

  // Start recording audio in chunks
  startRecording(
    stream: MediaStream,
    onAudioChunk: (audioBlob: Blob) => void,
    chunkDurationMs: number = 3000 // 3 seconds chunks
  ) {
    if (this.mediaRecorder) {
      this.stopRecording();
    }

    this.onAudioCallback = onAudioChunk;
    this.audioChunks = [];

    // Create MediaRecorder with webm format
    const options = {
      mimeType: 'audio/webm;codecs=opus'
    };

    try {
      this.mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
      // Fallback to default if webm is not supported
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      if (this.audioChunks.length > 0) {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        if (this.onAudioCallback) {
          this.onAudioCallback(audioBlob);
        }
        this.audioChunks = [];
      }
    };

    // Start recording
    this.mediaRecorder.start();

    // Set up interval to stop and restart recording
    this.recordingInterval = setInterval(() => {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.mediaRecorder.stop();
        // Restart recording after a brief pause
        setTimeout(() => {
          if (this.mediaRecorder && stream.active) {
            this.audioChunks = [];
            this.mediaRecorder.start();
          }
        }, 100);
      }
    }, chunkDurationMs);
  }

  stopRecording() {
    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }

    this.audioChunks = [];
    this.onAudioCallback = null;
  }

  isRecording(): boolean {
    return this.mediaRecorder !== null && this.mediaRecorder.state === 'recording';
  }
}

// Gemini Live API Audio Generation Service
export class GeminiLiveAudioService {
  private ai: GoogleGenAI;
  private model: string = 'models/gemini-2.5-flash-preview-native-audio-dialog';
  private session: Session | undefined = undefined;
  private responseQueue: LiveServerMessage[] = [];
  private audioParts: string[] = [];
  private isStreamActive: boolean = false;
  private onAudioCallback?: (audioBuffer: ArrayBuffer) => void;
  private onTokenUsageCallback?: (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => void;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  // Convert Base64 audio parts to WAV buffer
  private convertToWav(rawData: string[], mimeType: string): ArrayBuffer {
    const options = this.parseMimeType(mimeType);
    const dataLength = rawData.reduce((a, b) => a + b.length, 0);
    const wavHeader = this.createWavHeader(dataLength, options);
    
    // Convert base64 strings to binary data
    const binaryData = rawData.map(data => {
      const binaryString = atob(data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    });
    
    const totalLength = wavHeader.byteLength + binaryData.reduce((a, b) => a + b.length, 0);
    const result = new ArrayBuffer(totalLength);
    const view = new Uint8Array(result);
    
    // Copy header
    view.set(new Uint8Array(wavHeader), 0);
    
    // Copy audio data
    let offset = wavHeader.byteLength;
    for (const data of binaryData) {
      view.set(data, offset);
      offset += data.length;
    }
    
    return result;
  }

  private parseMimeType(mimeType: string) {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options = {
      numChannels: 1,
      bitsPerSample: 16,
      sampleRate: 22050, // Default sample rate
    };

    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }

    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') {
        options.sampleRate = parseInt(value, 10);
      }
    }

    return options;
  }

  private createWavHeader(dataLength: number, options: { numChannels: number; sampleRate: number; bitsPerSample: number; }): ArrayBuffer {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);

    // RIFF header
    view.setUint32(0, 0x52494646, false); // 'RIFF'
    view.setUint32(4, 36 + dataLength, true); // ChunkSize
    view.setUint32(8, 0x57415645, false); // 'WAVE'
    
    // fmt chunk
    view.setUint32(12, 0x666d7420, false); // 'fmt '
    view.setUint32(16, 16, true); // Subchunk1Size
    view.setUint16(20, 1, true); // AudioFormat (PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, byteRate, true); // ByteRate
    view.setUint16(32, blockAlign, true); // BlockAlign
    view.setUint16(34, bitsPerSample, true); // BitsPerSample
    
    // data chunk
    view.setUint32(36, 0x64617461, false); // 'data'
    view.setUint32(40, dataLength, true); // Subchunk2Size

    return buffer;
  }

  // Generate audio for translated text
  async generateAudio(
    translatedText: string,
    targetLanguage: string,
    voiceSettings?: VoiceSettings
  ): Promise<ArrayBuffer> {
    try {
      this.audioParts = [];
      this.responseQueue = [];

      const targetLangCode = languageCodeMap[targetLanguage] || 'en';
      const voiceName = voiceSettings?.voiceName || 'Zephyr';

      const config = {
        responseModalities: [Modality.AUDIO],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            }
          }
        },
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' },
        },
      };

      this.session = await this.ai.live.connect({
        model: this.model,
        callbacks: {
          onopen: () => {
            console.debug('Gemini Live session opened');
          },
          onmessage: (message: LiveServerMessage) => {
            this.responseQueue.push(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error('Gemini Live error:', e.message);
          },
          onclose: (e: CloseEvent) => {
            console.debug('Gemini Live session closed:', e.reason);
          },
        },
        config
      });

      // Send text to generate audio
      const prompt = `Please say the following text in ${targetLanguage} (${targetLangCode}): "${translatedText}"`;
      
      this.session.sendClientContent({
        turns: [prompt]
      });

      // Wait for audio response
      await this.handleTurn();

      this.session.close();

      if (this.audioParts.length === 0) {
        throw new Error('No audio data received from Gemini Live API');
      }

      // Convert audio parts to WAV
      const wavBuffer = this.convertToWav(this.audioParts, 'audio/pcm;rate=22050');
      return wavBuffer;

    } catch (error) {
      console.error('Gemini Live audio generation error:', error);
      throw error;
    }
  }

  private async handleTurn(): Promise<void> {
    let done = false;
    while (!done) {
      const message = await this.waitMessage();
      if (message.serverContent && message.serverContent.turnComplete) {
        done = true;
      }
    }
  }

  private async waitMessage(): Promise<LiveServerMessage> {
    let done = false;
    let message: LiveServerMessage | undefined = undefined;
    
    while (!done) {
      message = this.responseQueue.shift();
      if (message) {
        this.handleModelTurn(message);
        done = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return message!;
  }

  private handleModelTurn(message: LiveServerMessage) {
    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      if (part?.inlineData) {
        console.log('Received audio data from Gemini Live');
        this.audioParts.push(part.inlineData.data ?? '');
      }

      if (part?.text) {
        console.log('Gemini Live text response:', part.text);
      }
    }
  }

  // Create audio URL from ArrayBuffer
  createAudioUrl(audioBuffer: ArrayBuffer): string {
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  // Clean up audio URL
  revokeAudioUrl(url: string): void {
    URL.revokeObjectURL(url);
  }

  // Start continuous live audio stream for conference
  async startLiveStream(
    onAudioReceived: (audioBuffer: ArrayBuffer) => void,
    onTokenUsage?: (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => void,
    voiceSettings?: VoiceSettings
  ): Promise<void> {
    if (this.isStreamActive) {
      console.warn('Live stream is already active');
      return;
    }

    try {
      this.onAudioCallback = onAudioReceived;
      this.onTokenUsageCallback = onTokenUsage;
      this.audioParts = [];
      this.responseQueue = [];
      this.isStreamActive = true;

      const voiceName = voiceSettings?.voiceName || 'Zephyr';

      const config = {
        responseModalities: [Modality.AUDIO],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: voiceName,
            }
          }
        },
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' },
        },
      };

      this.session = await this.ai.live.connect({
        model: this.model,
        callbacks: {
          onopen: () => {
            console.log('Gemini Live stream started for conference');
          },
          onmessage: (message: LiveServerMessage) => {
            this.responseQueue.push(message);
            this.processStreamMessage(message);
          },
          onerror: (e: ErrorEvent) => {
            console.error('Gemini Live stream error:', e.message);
          },
          onclose: (e: CloseEvent) => {
            console.log('Gemini Live stream closed:', e.reason);
            this.isStreamActive = false;
          },
        },
        config
      });

      // Send initial greeting to start the conversation
      this.session.sendClientContent({
        turns: ['Hello! I am ready to assist with real-time translation during this conference. Please let me know when you need translation services.']
      });

    } catch (error) {
      console.error('Failed to start Gemini Live stream:', error);
      this.isStreamActive = false;
      throw error;
    }
  }

  // Process streaming messages
  private processStreamMessage(message: LiveServerMessage): void {
    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      if (part?.inlineData) {
        console.log('Received live audio data from Gemini');
        this.audioParts.push(part.inlineData.data ?? '');
        
        // Convert and send audio immediately for real-time playback
        if (this.onAudioCallback && this.audioParts.length > 0) {
          try {
            const wavBuffer = this.convertToWav(this.audioParts, 'audio/pcm;rate=22050');
            this.onAudioCallback(wavBuffer);
            this.audioParts = []; // Clear after processing
          } catch (error) {
            console.error('Error processing live audio:', error);
          }
        }
      }

      if (part?.text) {
        console.log('Gemini Live text response:', part.text);
      }
    }

    // Note: Token usage tracking for live streams would need to be implemented
    // when the API provides usage metadata in the response
  }

  // Send text to live stream for translation
  sendTextForTranslation(text: string, sourceLanguage: string, targetLanguage: string): void {
    if (!this.session || !this.isStreamActive) {
      console.warn('Live stream is not active');
      return;
    }

    const sourceLangCode = languageCodeMap[sourceLanguage] || 'en';
    const targetLangCode = languageCodeMap[targetLanguage] || 'en';

    const prompt = `Please translate the following text from ${sourceLanguage} (${sourceLangCode}) to ${targetLanguage} (${targetLangCode}) and speak it aloud: "${text}"`;
    
    this.session.sendClientContent({
      turns: [prompt]
    });
  }

  // Stop live stream
  stopLiveStream(): void {
    if (this.session) {
      this.session.close();
      this.session = undefined;
    }
    this.isStreamActive = false;
    this.onAudioCallback = undefined;
    this.onTokenUsageCallback = undefined;
    this.audioParts = [];
    this.responseQueue = [];
  }

  // Check if stream is active
  isLiveStreamActive(): boolean {
    return this.isStreamActive;
  }
}