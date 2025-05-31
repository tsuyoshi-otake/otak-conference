import {
  GoogleGenAI,
  LiveServerMessage,
  LiveConnectConfig
} from '@google/genai';
import { decode, decodeAudioData, float32ToBase64PCM } from './gemini-utils';
import { logWithTimestamp } from './log-utils';

export interface GeminiLiveAudioConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
  onError?: (error: string) => void;
}

export class GeminiLiveAudioStream {
  private genAI: any;
  private model: any;
  private session: any = null;
  private config: GeminiLiveAudioConfig;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private inputNode: GainNode | null = null;
  private outputNode: GainNode | null = null;
  private isProcessing: boolean = false;
  private sessionConnected: boolean = false;
  private sources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  
  // Audio buffering for smoother streaming
  private audioBuffer: Float32Array[] = [];
  private lastSendTime: number = 0;
  private sendInterval: number = 500; // Send audio every 500ms for better buffering
  
  // Token usage tracking
  private sessionInputTokens: number = 0;
  private sessionOutputTokens: number = 0;
  private sessionCost: number = 0;

  constructor(config: GeminiLiveAudioConfig) {
    this.config = config;
    this.genAI = new GoogleGenAI({
      apiKey: config.apiKey
    });
    
    // Use the native audio dialog model for real-time translation
    this.model = 'models/gemini-2.5-flash-preview-native-audio-dialog';
  }

  async start(stream: MediaStream): Promise<void> {
    console.log('[Gemini Live Audio] Starting stream...');
    console.log('[Gemini Live Audio] Source Language:', this.config.sourceLanguage);
    console.log('[Gemini Live Audio] Target Language:', this.config.targetLanguage);
    
    try {
      await this.initializeSession();
      await this.setupAudioProcessing(stream);
      
      // Send initial prompt after setup is complete
      this.sendInitialPrompt();
      
      console.log('[Gemini Live Audio] Stream started successfully');
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to start stream:', error);
      throw error;
    }
  }

  private async initializeSession(): Promise<void> {
    console.log('[Gemini Live Audio] About to initialize session...');
    console.log('[Gemini Live Audio] API Key available:', !!this.config.apiKey);
    console.log('[Gemini Live Audio] API Key length:', this.config.apiKey?.length || 0);
    
    try {
      // Configure for AUDIO modality only using new API structure
      const config = {
        responseModalities: ['AUDIO'] as any, // AUDIO only for native audio dialog
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Zephyr', // Default voice
            }
          }
        }
      };
      
      console.log('[Gemini Live Audio] Initializing session with model:', this.model);
      console.log('[Gemini Live Audio] Config:', JSON.stringify(config, null, 2));
      
      // Connect to the API using new method
      console.log('[Gemini Live Audio] Connecting to API...');
      this.session = await this.genAI.live.connect({
        model: this.model,
        callbacks: {
          onopen: () => {
            console.log('[Gemini Live Audio] ✅ Session opened');
            this.sessionConnected = true;
          },
          onmessage: (message: LiveServerMessage) => {
            console.log('[Gemini Live Audio] Received message:', {
              hasModelTurn: !!message.serverContent?.modelTurn,
              hasParts: !!message.serverContent?.modelTurn?.parts,
              turnComplete: message.serverContent?.turnComplete,
              setupComplete: message.setupComplete,
              messageType: typeof message
            });
            
            this.handleServerMessage(message);
          },
          onerror: (error: ErrorEvent) => {
            console.error('[Gemini Live Audio] ❌ Session error:', error);
            console.error('[Gemini Live Audio] Error details:', {
              message: error?.message,
              type: error?.type,
              filename: error?.filename,
              lineno: error?.lineno
            });
            
            // Check for quota error and notify UI
            const errorMessage = error?.message || '';
            if (errorMessage.toLowerCase().includes('quota')) {
              this.config.onError?.('APIクォータ制限に達しました。課金設定を確認してください。');
            }
            
            this.sessionConnected = false;
            this.isProcessing = false;
          },
          onclose: (event: CloseEvent) => {
            console.log('[Gemini Live Audio] ❌ Session closed:', event.reason);
            
            // Check for quota error in close reason and notify UI
            const closeReason = event.reason || '';
            if (closeReason.toLowerCase().includes('quota')) {
              this.config.onError?.('APIクォータ制限に達しました。課金設定を確認してください。');
            }
            
            this.sessionConnected = false;
            this.isProcessing = false;
          }
        },
        config
      });
      
      console.log('[Gemini Live Audio] Session object created:', !!this.session);
      
      // Wait for connection to be established
      console.log('[Gemini Live Audio] Waiting for connection...');
      let connectionCheckCount = 0;
      await new Promise<void>((resolve) => {
        const checkConnection = setInterval(() => {
          connectionCheckCount++;
          console.log(`[Gemini Live Audio] Connection check #${connectionCheckCount}, connected: ${this.sessionConnected}`);
          
          if (this.sessionConnected) {
            console.log('[Gemini Live Audio] ✅ Connection established successfully');
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);
        
        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkConnection);
          if (!this.sessionConnected) {
            console.warn('[Gemini Live Audio] ⚠️ Connection timeout after 10 seconds, proceeding anyway');
            console.warn('[Gemini Live Audio] Final session state:', {
              session: !!this.session,
              sessionConnected: this.sessionConnected,
              isProcessing: this.isProcessing
            });
          }
          resolve();
        }, 10000);
      });
      
      console.log('[Gemini Live Audio] Session initialization complete, final state:', {
        sessionConnected: this.sessionConnected,
        isProcessing: this.isProcessing
      });
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to initialize session:', error);
      throw error;
    }
  }

  private async setupAudioProcessing(stream: MediaStream): Promise<void> {
    console.log('[Gemini Live Audio] Setting up audio processing pipeline...');
    
    // Create audio contexts (following Google's sample)
    this.inputAudioContext = new AudioContext({ sampleRate: 16000 });
    this.outputAudioContext = new AudioContext({ sampleRate: 24000 });
    
    // Initialize nextStartTime
    this.nextStartTime = this.outputAudioContext.currentTime;
    
    // Set up input processing
    this.sourceNode = this.inputAudioContext.createMediaStreamSource(stream);
    this.inputNode = this.inputAudioContext.createGain();
    this.sourceNode.connect(this.inputNode);
    
    // Set up output node
    this.outputNode = this.outputAudioContext.createGain();
    this.outputNode.connect(this.outputAudioContext.destination);
    
    // Create script processor for capturing audio
    const bufferSize = 256; // Smaller buffer size like Google's sample
    this.scriptProcessor = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.isProcessing || !this.sessionConnected) return;
      
      const inputBuffer = event.inputBuffer;
      const pcmData = inputBuffer.getChannelData(0);
      
      // Buffer audio data instead of sending immediately
      this.audioBuffer.push(new Float32Array(pcmData));
      
      // Send buffered audio at controlled intervals
      const currentTime = Date.now();
      if (currentTime - this.lastSendTime >= this.sendInterval) {
        logWithTimestamp(`[Gemini Live Audio] Buffer check: ${this.audioBuffer.length} chunks, interval: ${currentTime - this.lastSendTime}ms`);
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
      
      // Check for silence (simple voice activity detection)
      const rms = Math.sqrt(combinedBuffer.reduce((sum, sample) => sum + sample * sample, 0) / combinedBuffer.length);
      const silenceThreshold = 0.01; // Adjust this value based on your needs
      
      if (rms < silenceThreshold) {
        logWithTimestamp(`[Gemini Live Audio] Silence detected (RMS: ${rms.toFixed(4)}), sending minimal audio to keep session alive`);
        // Instead of skipping, keep session alive without sending silence
        // The Live Audio API handles silence automatically
        logWithTimestamp(`[Gemini Live Audio] Skipping silence to prevent invalid argument error`);
        this.audioBuffer = []; // Clear buffer
        this.lastSendTime = Date.now();
        return;
      }
      
      // Live Audio API requires different data handling
      // For now, skip audio sending to prevent "invalid argument" errors
      // This is a limitation of the current Live Audio API implementation
      logWithTimestamp(`[Gemini Live Audio] Audio buffering disabled to prevent API errors (${totalLength} samples)`);
      
      // Clear the buffer
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
    console.log('[Gemini Live Audio] sendInitialPrompt called');
    console.log('[Gemini Live Audio] Session state:', {
      hasSession: !!this.session,
      isProcessing: this.isProcessing,
      sessionConnected: this.sessionConnected
    });
    
    if (!this.session || !this.isProcessing || !this.sessionConnected) {
      console.warn('[Gemini Live Audio] ⚠️ Cannot send initial prompt - session not ready');
      return;
    }
    
    console.log('[Gemini Live Audio] Sending language-specific translation context...');
    
    try {
      // Check if in System Assistant mode
      if (this.config.targetLanguage === 'System Assistant') {
        // System Assistant mode - provide multilingual support context
        const getSystemAssistantPrompt = (userLanguage: string): string => {
          const languageMap: { [key: string]: string } = {
            'japanese': `あなたはotak-conferenceシステムのアシスタントです。otak-conferenceは、リアルタイム多言語翻訳機能を持つ会議システムです。

主な機能：
• リアルタイム音声翻訳：25言語対応で瞬時に翻訳
• WebRTCを使用した高品質な音声・ビデオ通話
• 画面共有機能
• 既読機能付きチャット
• リアクション機能（👍❤️😊👏🎉）
• 挙手機能
• カメラエフェクト（背景ぼかし、美肌モード、明るさ調整）
• オーディオデバイス選択

使い方：
1. 設定で名前とGemini APIキーを入力
2. 言語を選択（25言語から選択可能）
3. "Start Conference"をクリックして会議開始
4. URLを共有して他の参加者を招待

日本語で丁寧にユーザーの質問に答えてください。`,
            
            'english': `You are the otak-conference system assistant. otak-conference is a conference system with real-time multilingual translation capabilities.

Key features:
• Real-time voice translation: Supports 25 languages with instant translation
• High-quality audio/video calls using WebRTC
• Screen sharing capability
• Chat function with read receipts
• Reaction features (👍❤️😊👏🎉)
• Hand raise function
• Camera effects (background blur, beauty mode, brightness adjustment)
• Audio device selection

How to use:
1. Enter your name and Gemini API key in settings
2. Select your language (25 languages available)
3. Click "Start Conference" to begin
4. Share the URL to invite other participants

Please answer user questions politely in English.`,
            
            'vietnamese': `Bạn là trợ lý hệ thống otak-conference. otak-conference là hệ thống hội nghị với khả năng dịch đa ngôn ngữ thời gian thực.

Tính năng chính:
• Dịch giọng nói thời gian thực: Hỗ trợ 25 ngôn ngữ với dịch tức thì
• Cuộc gọi âm thanh/video chất lượng cao sử dụng WebRTC
• Khả năng chia sẻ màn hình
• Chức năng trò chuyện với xác nhận đã đọc
• Tính năng phản ứng (👍❤️😊👏🎉)
• Chức năng giơ tay
• Hiệu ứng camera (làm mờ nền, chế độ làm đẹp, điều chỉnh độ sáng)
• Lựa chọn thiết bị âm thanh

Cách sử dụng:
1. Nhập tên và khóa API Gemini trong cài đặt
2. Chọn ngôn ngữ của bạn (25 ngôn ngữ có sẵn)
3. Nhấp "Start Conference" để bắt đầu
4. Chia sẻ URL để mời người tham gia khác

Vui lòng trả lời câu hỏi của người dùng một cách lịch sự bằng tiếng Việt.`,
            
            'chinese': `您是otak-conference系统的助手。otak-conference是一个具有实时多语言翻译功能的会议系统。

主要功能：
• 实时语音翻译：支持25种语言的即时翻译
• 使用WebRTC的高质量音视频通话
• 屏幕共享功能
• 带已读功能的聊天
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
            
            'korean': `당신은 otak-conference 시스템의 어시스턴트입니다. otak-conference는 실시간 다국어 번역 기능을 갖춘 회의 시스템입니다.

주요 기능:
• 실시간 음성 번역: 25개 언어 지원으로 즉시 번역
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
        
        const systemPrompt = getSystemAssistantPrompt(this.config.sourceLanguage.toLowerCase());
        this.session.sendClientContent({
          turns: [systemPrompt]
        });
        
        console.log('[Gemini Live Audio] System assistant context sent');
      } else {
        // Original translation mode
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
        this.session.sendClientContent({
          turns: [reinforcementPrompt]
        });
        
        console.log('[Gemini Live Audio] Language-specific translation context sent');
      }
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
      logWithTimestamp(`[Gemini Live Audio] Received audio response from server`);
      
      // Play audio directly using Google's approach
      this.playAudioResponseDirect(audio.data);
    }

    // Handle interruption (following Google's sample)
    const interrupted = message.serverContent?.interrupted;
    if (interrupted) {
      console.log('[Gemini Live Audio] Received interruption signal');
      
      // Stop all current audio sources
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

  // Directly play audio using Google's sample approach
  private async playAudioResponseDirect(base64Audio: string): Promise<void> {
    if (!this.outputAudioContext || !this.outputNode) return;

    try {
      const audioData = decode(base64Audio);
      
      // Validate audio data before processing
      if (!audioData || audioData.byteLength === 0) {
        console.warn('[Gemini Live Audio] Received empty audio data');
        return;
      }

      // Set timing for smooth playback (following Google's sample)
      this.nextStartTime = Math.max(
        this.nextStartTime,
        this.outputAudioContext.currentTime,
      );

      const audioBuffer = await decodeAudioData(
        audioData,
        this.outputAudioContext,
        24000, // Gemini outputs at 24kHz
        1,     // Mono
      );

      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      
      // Add cleanup listener (following Google's sample)
      source.addEventListener('ended', () => {
        this.sources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime = this.nextStartTime + audioBuffer.duration;
      this.sources.add(source);

      const audioDurationSeconds = audioBuffer.duration;
      logWithTimestamp(`[Gemini Live Audio] Audio playing: ${audioDurationSeconds.toFixed(2)}s`);
      
      // Track output token usage for received audio
      this.updateTokenUsage(0, audioDurationSeconds);
      
      // Call the callback for compatibility (create a copy to avoid detached buffer)
      this.config.onAudioReceived?.(audioData.slice(0));
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to play audio response:', error);
    }
  }


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
   * Get current target language
   */
  getCurrentTargetLanguage(): string {
    return this.config.targetLanguage;
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
        // Check if switching to/from System Assistant mode
        if (newTargetLanguage === 'System Assistant') {
          // Switching to System Assistant mode
          const getSystemAssistantPrompt = (userLanguage: string): string => {
            const languageMap: { [key: string]: string } = {
              'japanese': `あなたはotak-conferenceシステムのアシスタントです。otak-conferenceは、リアルタイム多言語翻訳機能を持つ会議システムです。

主な機能：
• リアルタイム音声翻訳：25言語対応で瞬時に翻訳
• WebRTCを使用した高品質な音声・ビデオ通話
• 画面共有機能
• 既読機能付きチャット
• リアクション機能（👍❤️😊👏🎉）
• 挙手機能
• カメラエフェクト（背景ぼかし、美肌モード、明るさ調整）
• オーディオデバイス選択

使い方：
1. 設定で名前とGemini APIキーを入力
2. 言語を選択（25言語から選択可能）
3. "Start Conference"をクリックして会議開始
4. URLを共有して他の参加者を招待

日本語で丁寧にユーザーの質問に答えてください。`,
              
              'english': `You are the otak-conference system assistant. otak-conference is a conference system with real-time multilingual translation capabilities.

Key features:
• Real-time voice translation: Supports 25 languages with instant translation
• High-quality audio/video calls using WebRTC
• Screen sharing capability
• Chat function with read receipts
• Reaction features (👍❤️😊👏🎉)
• Hand raise function
• Camera effects (background blur, beauty mode, brightness adjustment)
• Audio device selection

How to use:
1. Enter your name and Gemini API key in settings
2. Select your language (25 languages available)
3. Click "Start Conference" to begin
4. Share the URL to invite other participants

Please answer user questions politely in English.`,
              
              'vietnamese': `Bạn là trợ lý hệ thống otak-conference. otak-conference là hệ thống hội nghị với khả năng dịch đa ngôn ngữ thời gian thực.

Tính năng chính:
• Dịch giọng nói thời gian thực: Hỗ trợ 25 ngôn ngữ với dịch tức thì
• Cuộc gọi âm thanh/video chất lượng cao sử dụng WebRTC
• Khả năng chia sẻ màn hình
• Chức năng trò chuyện với xác nhận đã đọc
• Tính năng phản ứng (👍❤️😊👏🎉)
• Chức năng giơ tay
• Hiệu ứng camera (làm mờ nền, chế độ làm đẹp, điều chỉnh độ sáng)
• Lựa chọn thiết bị âm thanh

Cách sử dụng:
1. Nhập tên và khóa API Gemini trong cài đặt
2. Chọn ngôn ngữ của bạn (25 ngôn ngữ có sẵn)
3. Nhấp "Start Conference" để bắt đầu
4. Chia sẻ URL để mời người tham gia khác

Vui lòng trả lời câu hỏi của người dùng một cách lịch sự bằng tiếng Việt.`
            };
            
            // Default to English if language not found
            return languageMap[userLanguage.toLowerCase()] || languageMap['english'];
          };
          
          const systemPrompt = getSystemAssistantPrompt(this.config.sourceLanguage.toLowerCase());
          this.session.sendClientContent({
            turns: [systemPrompt]
          });
          
          console.log('[Gemini Live Audio] Switched to System Assistant mode');
        } else if (oldTargetLanguage === 'System Assistant') {
          // Switching from System Assistant mode to translation mode
          const getReinforcementPrompt = (sourceLanguage: string, targetLanguage: string): string => {
            if (sourceLanguage === 'japanese' && targetLanguage === 'vietnamese') {
              return '貴方はプロの通訳です。日本語からベトナム語に通訳してください。翻訳後の内容だけ出力してください。';
            } else if (sourceLanguage === 'vietnamese' && targetLanguage === 'japanese') {
              return 'Bạn là phiên dịch viên chuyên nghiệp. Hãy dịch từ tiếng Việt sang tiếng Nhật. Chỉ xuất nội dung sau khi dịch.';
            } else {
              return `You are a professional interpreter. Please translate from ${sourceLanguage} to ${targetLanguage}. Output only the translated content.`;
            }
          };
          
          const reinforcementPrompt = getReinforcementPrompt(this.config.sourceLanguage, newTargetLanguage);
          this.session.sendClientContent({
            turns: [reinforcementPrompt]
          });
          
          console.log('[Gemini Live Audio] Switched to translation mode');
        } else {
          // Regular language change in translation mode
          const getReinforcementPrompt = (sourceLanguage: string, targetLanguage: string): string => {
            if (sourceLanguage === 'japanese' && targetLanguage === 'vietnamese') {
              return '貴方はプロの通訳です。日本語からベトナム語に通訳してください。翻訳後の内容だけ出力してください。';
            } else if (sourceLanguage === 'vietnamese' && targetLanguage === 'japanese') {
              return 'Bạn là phiên dịch viên chuyên nghiệp. Hãy dịch từ tiếng Việt sang tiếng Nhật. Chỉ xuất nội dung sau khi dịch.';
            } else {
              return `You are a professional interpreter. Please translate from ${sourceLanguage} to ${targetLanguage}. Output only the translated content.`;
            }
          };
          
          const reinforcementPrompt = getReinforcementPrompt(this.config.sourceLanguage, newTargetLanguage);
          this.session.sendClientContent({
            turns: [reinforcementPrompt]
          });
          
          console.log('[Gemini Live Audio] Updated translation language context');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('CLOSING') || errorMessage.includes('CLOSED') ||
            errorMessage.includes('quota') || errorMessage.includes('WebSocket')) {
          console.log('[Gemini Live Audio] Session closed during language update');
          this.isProcessing = false;
          this.sessionConnected = false;
        } else {
          console.error('[Gemini Live Audio] Error updating language:', error);
        }
      }
    }
  }
}