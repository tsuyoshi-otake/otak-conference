import { GoogleGenAI } from '@google/genai';
import { logWithTimestamp } from './log-utils';

export interface AudioProcessorConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  speakerName?: string; // Optional speaker name for gender detection
  onTextReceived?: (text: string) => void;
  onTranslationReceived?: (translation: string) => void;
  onError?: (error: Error) => void;
}

export class GeminiAudioProcessor {
  private genAI: GoogleGenAI;
  private config: AudioProcessorConfig;
  private isProcessing = false;
  private audioChunks: Blob[] = [];
  private processInterval: NodeJS.Timeout | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private detectedGender: 'male' | 'female' | 'unknown' = 'unknown';
  private selectedVoice: string = 'Rasalgethi';

  constructor(config: AudioProcessorConfig) {
    this.config = config;
    this.genAI = new GoogleGenAI({
      apiKey: config.apiKey,
    });
  }

  async start(mediaStream: MediaStream): Promise<void> {
    try {
      logWithTimestamp('[Gemini Audio Processor] Starting audio processing...');
      
      // Create MediaRecorder to capture audio chunks
      // Use Gemini-supported audio formats as per documentation
      // Gemini GenerateContent API supported formats (per documentation)
      const supportedFormats = [
        'audio/wav',           // WAV - audio/wav (preferred, contains PCM data)
        'audio/webm;codecs=opus', // OGG Vorbis equivalent
        'audio/mp4',           // AAC - audio/aac
        'audio/webm'           // Fallback
      ];
      
      let selectedMimeType = 'audio/wav'; // Default to WAV (contains PCM data internally)
      
      // Find the first supported format, prioritizing WAV for PCM compatibility
      for (const format of supportedFormats) {
        if (MediaRecorder.isTypeSupported(format)) {
          selectedMimeType = format;
          break;
        }
      }
      
      // Note: WAV files typically contain PCM data, which is what Gemini processes internally
      
      const options = {
        mimeType: selectedMimeType
      };
      
      logWithTimestamp(`[Gemini Audio Processor] Using audio format: ${selectedMimeType}`);
      
      this.mediaRecorder = new MediaRecorder(mediaStream, options);
      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
      
      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length > 0) {
          await this.processAudioChunks();
        }
      };
      
      // Start recording in chunks
      this.isProcessing = true;
      this.mediaRecorder.start();
      
      // Process audio every 3 seconds for optimal token usage
      // Per Gemini documentation: 1 second = 32 tokens, so 3 seconds = 96 tokens
      // This provides good balance between responsiveness and API efficiency
      this.processInterval = setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
          // Restart recording after processing
          setTimeout(() => {
            if (this.isProcessing && this.mediaRecorder) {
              this.audioChunks = [];
              this.mediaRecorder.start();
            }
          }, 100);
        }
      }, 3000); // Increased to 3 seconds for better token efficiency
      
      logWithTimestamp('[Gemini Audio Processor] Audio processing started');
    } catch (error) {
      console.error('[Gemini Audio Processor] Failed to start:', error);
      this.config.onError?.(error as Error);
    }
  }

  /**
   * Detect gender from name using Gemini
   */
  private async detectGenderFromName(name: string): Promise<'male' | 'female' | 'unknown'> {
    try {
      const prompt = `Based on the name "${name}", determine the most likely gender.
      Respond with only one word: "male", "female", or "unknown".
      If the name is clearly masculine, respond "male".
      If the name is clearly feminine, respond "female".
      If you cannot determine or the name is gender-neutral, respond "unknown".`;
      
      const response = await this.genAI.models.generateContent({
        model: 'models/gemini-1.5-flash',
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ]
      });
      
      const result = response.text?.toLowerCase().trim() || 'unknown';
      
      if (result === 'male' || result === 'female' || result === 'unknown') {
        return result as 'male' | 'female' | 'unknown';
      }
      
      return 'unknown';
    } catch (error) {
      console.error('[Gemini Audio Processor] Error detecting gender:', error);
      return 'unknown';
    }
  }

  /**
   * Get voice name based on gender
   */
  private getVoiceNameByGender(gender: 'male' | 'female' | 'unknown'): string {
    switch (gender) {
      case 'female':
        return 'Zephyr';
      case 'male':
        return 'Charon';
      case 'unknown':
      default:
        return 'Rasalgethi';
    }
  }

  private async processAudioChunks(): Promise<void> {
    if (this.audioChunks.length === 0) return;
    
    try {
      // Combine audio chunks into a single blob
      const audioBlob = new Blob(this.audioChunks, { type: this.audioChunks[0].type });
      
      // Check size limit (20MB as per Gemini documentation)
      const maxSizeBytes = 20 * 1024 * 1024; // 20MB
      if (audioBlob.size > maxSizeBytes) {
        console.warn(`[Gemini Audio Processor] Audio chunk too large (${audioBlob.size} bytes), skipping processing`);
        return;
      }
      
      logWithTimestamp(`[Gemini Audio Processor] Processing audio chunk: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
      
      // Convert to base64
      const base64Audio = await this.blobToBase64(audioBlob);
      
      // Determine if we're in System Assistant mode
      const isSystemAssistantMode = this.config.targetLanguage === 'System Assistant';
      
      let prompt: string;
      if (isSystemAssistantMode) {
        prompt = this.getSystemAssistantPrompt();
      } else {
        prompt = this.getTranscriptionPrompt();
      }
      
      // Process audio with Gemini using the models API
      // Use gemini-2.0-flash as recommended in the documentation
      const response = await this.genAI.models.generateContent({
        model: 'models/gemini-2.0-flash',
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: audioBlob.type,
                  data: base64Audio,
                },
              },
            ],
          },
        ],
      });
      
      const result = response.text || '';
      
      if (isSystemAssistantMode) {
        // In System Assistant mode, the response is the answer to the user's question
        this.config.onTextReceived?.(result);
        
        // Detect gender from speaker name for voice selection
        if (this.config.speakerName && (!this.detectedGender || this.detectedGender === 'unknown')) {
          this.detectedGender = await this.detectGenderFromName(this.config.speakerName);
          this.selectedVoice = this.getVoiceNameByGender(this.detectedGender);
          logWithTimestamp(`[Gemini Audio Processor] Detected gender for "${this.config.speakerName}": ${this.detectedGender}, using voice: ${this.selectedVoice}`);
        }
      } else {
        // In translation mode, we need to separate transcription and translation
        const lines = result.split('\n').filter(line => line.trim());
        
        if (lines.length >= 2) {
          const transcription = lines[0].replace(/^(Transcription|転写|Phiên âm):\s*/i, '').trim();
          const translation = lines[1].replace(/^(Translation|翻訳|Dịch):\s*/i, '').trim();
          
          this.config.onTextReceived?.(transcription);
          this.config.onTranslationReceived?.(translation);
        } else if (lines.length === 1) {
          // If only one line, treat it as transcription
          this.config.onTextReceived?.(lines[0]);
        }
      }
      
      logWithTimestamp('[Gemini Audio Processor] Audio processed successfully');
    } catch (error) {
      console.error('[Gemini Audio Processor] Error processing audio:', error);
      this.config.onError?.(error as Error);
    }
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result && typeof reader.result === 'string') {
          // Remove the data URL prefix to get just the base64 string
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error('Failed to convert blob to base64'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private getSystemAssistantPrompt(): string {
    const languagePrompts: Record<string, string> = {
      'japanese': `音声の内容を理解し、otak-conferenceシステムについての質問に日本語で答えてください。

otak-conferenceは、リアルタイム多言語翻訳会議システムです。
主な機能：リアルタイム音声翻訳（25言語対応）、WebRTC音声・ビデオ通話、画面共有、チャット機能、リアクション機能、挙手機能、カメラエフェクト、音声デバイス選択

質問に対して簡潔で分かりやすい回答を提供してください。`,
      
      'english': `Understand the audio content and answer questions about the otak-conference system in English.

otak-conference is a real-time multilingual translation conference system.
Key features: Real-time voice translation (25 languages), WebRTC audio/video calls, screen sharing, chat function, reactions, hand raise, camera effects, audio device selection.

Provide clear and concise answers to questions.`,
      
      'vietnamese': `Hiểu nội dung âm thanh và trả lời câu hỏi về hệ thống otak-conference bằng tiếng Việt.

otak-conference là hệ thống hội nghị dịch đa ngôn ngữ thời gian thực.
Tính năng chính: Dịch giọng nói thời gian thực (25 ngôn ngữ), cuộc gọi âm thanh/video WebRTC, chia sẻ màn hình, chức năng trò chuyện, phản ứng, giơ tay, hiệu ứng camera, lựa chọn thiết bị âm thanh.

Cung cấp câu trả lời rõ ràng và ngắn gọn cho các câu hỏi.`,
    };
    
    return languagePrompts[this.config.sourceLanguage.toLowerCase()] || languagePrompts['english'];
  }

  private getTranscriptionPrompt(): string {
    const sourceLanguage = this.config.sourceLanguage;
    const targetLanguage = this.config.targetLanguage;
    
    const languagePrompts: Record<string, string> = {
      'japanese-vietnamese': `音声を文字起こしし、日本語からベトナム語に翻訳してください。
以下の形式で出力してください：
転写: [日本語の文字起こし]
翻訳: [ベトナム語の翻訳]`,
      
      'vietnamese-japanese': `Phiên âm âm thanh và dịch từ tiếng Việt sang tiếng Nhật.
Xuất theo định dạng sau:
Phiên âm: [Phiên âm tiếng Việt]
Dịch: [Bản dịch tiếng Nhật]`,
      
      'japanese-english': `音声を文字起こしし、日本語から英語に翻訳してください。
以下の形式で出力してください：
転写: [日本語の文字起こし]
翻訳: [英語の翻訳]`,
      
      'english-japanese': `Transcribe the audio and translate from English to Japanese.
Output in the following format:
Transcription: [English transcription]
Translation: [Japanese translation]`,
      
      'vietnamese-english': `Phiên âm âm thanh và dịch từ tiếng Việt sang tiếng Anh.
Xuất theo định dạng sau:
Phiên âm: [Phiên âm tiếng Việt]
Dịch: [Bản dịch tiếng Anh]`,
      
      'english-vietnamese': `Transcribe the audio and translate from English to Vietnamese.
Output in the following format:
Transcription: [English transcription]
Translation: [Vietnamese translation]`,
    };
    
    const key = `${sourceLanguage.toLowerCase()}-${targetLanguage.toLowerCase()}`;
    return languagePrompts[key] || `Transcribe the audio in ${sourceLanguage} and translate to ${targetLanguage}.
Output in the following format:
Transcription: [Original transcription]
Translation: [Translated text]`;
  }

  async stop(): Promise<void> {
    logWithTimestamp('[Gemini Audio Processor] Stopping audio processing...');
    
    this.isProcessing = false;
    
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }
    
    this.audioChunks = [];
    
    logWithTimestamp('[Gemini Audio Processor] Audio processing stopped');
  }

  isActive(): boolean {
    return this.isProcessing;
  }

  updateTargetLanguage(newTargetLanguage: string): void {
    this.config.targetLanguage = newTargetLanguage;
    logWithTimestamp(`[Gemini Audio Processor] Updated target language to: ${newTargetLanguage}`);
  }

  getCurrentTargetLanguage(): string {
    return this.config.targetLanguage;
  }
}