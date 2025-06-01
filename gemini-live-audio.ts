import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
} from '@google/genai';
import {
  languagePromptManager,
  getLanguageSpecificPrompt,
  generatePeerTranslationPrompt,
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
  onError?: (error: Error) => void;
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
  localPlaybackEnabled?: boolean; // Control whether to play audio locally
  
  // Peer-to-peer translation support
  otherParticipantLanguages?: string[]; // Languages of other participants
  usePeerTranslation?: boolean; // Whether to use peer translation mode
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

  // Local playback control
  private localPlaybackEnabled = true;

  constructor(config: GeminiLiveAudioConfig) {
    this.config = config;
    this.localPlaybackEnabled = config.localPlaybackEnabled ?? true;
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
    });
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
      debugLog('[Gemini Live Audio] Starting stream...');
      debugLog(`[Gemini Live Audio] Source Language: ${this.config.sourceLanguage}`);
      debugLog(`[Gemini Live Audio] Target Language: ${this.config.targetLanguage}`);
      
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
    const model = 'models/gemini-2.5-flash-preview-native-audio-dialog';
    debugLog(`[Gemini Live Audio] Initializing session with model: ${model}`);

    // Get initial system instruction based on current mode
    const systemInstruction = this.getSystemInstruction();
    
    // Always log the system prompt being used (not debug-only)
    console.log(`🤖 [Gemini Prompt] System Instruction Set:`);
    console.log(`📝 Prompt Preview: ${systemInstruction.substring(0, 200)}...`);
    
    debugLog(`[Gemini Live Audio] Setting system instruction for mode: ${this.config.targetLanguage}`);

    const config = {
      system_instruction: systemInstruction,
      responseModalities: [Modality.AUDIO], // Only one modality at a time
      // Removed mediaResolution as it's not needed for audio-only mode
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr',
          }
        }
      },
    };

    debugLog('[Gemini Live Audio] Connecting to API...');
    this.session = await this.ai.live.connect({
      model,
      callbacks: {
        onopen: () => {
          debugLog('[Gemini Live Audio] Session opened successfully');
          this.sessionConnected = true;
        },
        onmessage: (message: LiveServerMessage) => {
          debugLog('[Gemini Live Audio] Received message:', {
            hasModelTurn: !!message.serverContent?.modelTurn,
            hasParts: !!message.serverContent?.modelTurn?.parts,
            turnComplete: message.serverContent?.turnComplete,
            setupComplete: !!message.setupComplete
          });
          
          // Check if this is a setup complete message
          if (message.setupComplete) {
            debugLog('[Gemini Live Audio] Setup completed, session is ready');
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
          debugLog('[Gemini Live Audio] Session closed:', e.reason);
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
    debugLog('[Gemini Live Audio] Audio processing pipeline ready');
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
    
    debugLog(`[Gemini Live Audio] Token usage - Input: ${inputTokens}, Output: ${totalOutputTokens}, Cost: $${totalCost.toFixed(6)}`);
    debugLog(`[Gemini Live Audio] Session total - Input: ${this.sessionInputTokens}, Output: ${this.sessionOutputTokens}, Cost: $${this.sessionCost.toFixed(6)}`);
    
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
      
      // Convert to base64 PCM for Gemini
      const base64Audio = float32ToBase64PCM(combinedBuffer);
      
      const audioLengthSeconds = totalLength / 16000;
      debugLog(`[Gemini Live Audio] Sending buffered audio: ${totalLength} samples (${audioLengthSeconds.toFixed(2)}s)`);
      
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
      
      return getSystemAssistantPrompt(this.config.sourceLanguage.toLowerCase());
    } else {
      // Check if peer translation mode is enabled
      if (this.config.usePeerTranslation && this.config.otherParticipantLanguages && this.config.otherParticipantLanguages.length > 0) {
        // Peer-to-peer translation mode: translate my language to peer's language
        const targetLanguage = this.config.otherParticipantLanguages[0]; // Use first peer's language as primary target
        
        debugLog(`[Gemini Live Audio] Using peer translation mode: ${this.config.sourceLanguage} → ${targetLanguage}`);
        
        return createPeerTranslationSystemPrompt(this.config.sourceLanguage, targetLanguage);
      } else {
        // Traditional translation mode (fallback)
        const getTranslationInstruction = (sourceLanguage: string, targetLanguage: string): string => {
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
        
        return getTranslationInstruction(this.config.sourceLanguage, this.config.targetLanguage);
      }
    }
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
      debugLog('[Gemini Live Audio] Received interruption signal');
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
          debugLog('[Gemini Live Audio] Received translated text:', part.text);
          
          // Track output token usage for received text
          this.updateTokenUsage(0, 0, part.text);
          
          this.config.onTextReceived?.(part.text);
        }
      }
    }
  }

  private async playAudioResponse(base64Audio: string): Promise<void> {
    if (!this.outputAudioContext || !this.outputNode) return;

    try {
      const audioData = decode(base64Audio);
      
      // Validate audio data before processing
      if (!audioData || audioData.byteLength === 0) {
        debugWarn('[Gemini Live Audio] Received empty audio data');
        return;
      }
      
      debugLog(`[Gemini Live Audio] Processing audio response: ${audioData.byteLength} bytes`);
      debugLog(`[Gemini Live Audio] Local playback enabled: ${this.localPlaybackEnabled}`);
      
      const audioBuffer = await decodeAudioData(
        audioData,
        this.outputAudioContext,
        24000, // Gemini outputs at 24kHz
        1      // Mono
      );

      const audioDurationSeconds = audioBuffer.duration;

      // Only play locally if local playback is enabled
      if (this.localPlaybackEnabled) {
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.outputNode);
        
        source.addEventListener('ended', () => {
          this.sources.delete(source);
        });

        source.start(this.nextStartTime);
        this.nextStartTime = this.nextStartTime + audioBuffer.duration;
        this.sources.add(source);

        debugLog(`[Gemini Live Audio] Playing audio locally: ${audioDurationSeconds.toFixed(2)}s`);
      } else {
        debugLog(`[Gemini Live Audio] Skipping local playback: ${audioDurationSeconds.toFixed(2)}s`);
      }
      
      // Track output token usage for received audio
      this.updateTokenUsage(0, audioDurationSeconds);
      
      // Always call the callback for translated audio distribution to other participants
      this.config.onAudioReceived?.(audioData.slice(0));
      
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to process audio response:', error);
      debugError('[Gemini Live Audio] Error details:', error);
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
    debugLog('[Gemini Live Audio] Stopping stream...');
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
    
    // For Gemini PCM data, use PCM worklet directly (skip MediaSource)
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