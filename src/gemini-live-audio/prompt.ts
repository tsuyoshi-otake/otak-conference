import {
  createPeerTranslationSystemPrompt,
  getLanguageSpecificPrompt
} from '../translation-prompts';
import { debugLog } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';

export const resolveInputLanguageCode = (state: GeminiLiveAudioState): string | undefined => {
  const source = state.config.sourceLanguage?.toLowerCase();
  if (!source) {
    return undefined;
  }
  if (source === 'japanese' || source.startsWith('ja')) {
    return 'ja-JP';
  }
  if (source === 'english' || source.startsWith('en')) {
    return 'en-US';
  }
  if (source === 'vietnamese' || source.startsWith('vi')) {
    return 'vi-VN';
  }
  return undefined;
};

export const resolveOutputLanguageCode = (state: GeminiLiveAudioState): string | undefined => {
  const target = state.config.targetLanguage?.toLowerCase();
  if (!target) {
    return undefined;
  }
  if (target === 'japanese' || target.startsWith('ja')) {
    return 'ja-JP';
  }
  if (target === 'english' || target.startsWith('en')) {
    return 'en-US';
  }
  if (target === 'vietnamese' || target.startsWith('vi')) {
    return 'vi-VN';
  }
  return undefined;
};

export const getSystemInstruction = (state: GeminiLiveAudioState): string => {
  // Check if this is a system assistant mode (no other participants)
  const isSystemAssistantMode = state.config.targetLanguage === 'System Assistant';

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
• リアクション機能（ハート、拍手、いいね）
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
• Reaction features (heart, applause, like)
• Hand raise function
• Camera effects (background blur, beauty mode, brightness adjustment)
• Audio device selection

How to Use:
1. Enter your name and Gemini API key in settings
2. Select your language (Japanese, English, Vietnamese available)
3. Click "Start Conference" to begin
4. Share the URL to invite other participants

Please answer user questions politely in English.`,

        'vietnamese': `B?n la tr? ly h? th?ng otak-conference. otak-conference la h? th?ng h?i ngh? d?ch ?a ngon ng? th?i gian th?c.

Tinh n?ng chinh:
• D?ch gi?ng noi th?i gian th?c: H? tr? 3 ngon ng? (ti?ng Nh?t, ti?ng Anh, ti?ng Vi?t) v?i d?ch thu?t t?c thi
• Cu?c g?i am thanh/video ch?t l??ng cao s? d?ng WebRTC
• Kh? n?ng chia s? man hinh
• Ch?c n?ng tro chuy?n v?i xac nh?n ?a ??c
• Tinh n?ng ph?n ?ng (trai tim, v? tay, thich)
• Ch?c n?ng gi? tay
• Hi?u ?ng camera (lam m? n?n, ch? ?? lam ??p, ?i?u ch?nh ?? sang)
• L?a ch?n thi?t b? am thanh

Cach s? d?ng:
1. Nh?p ten va khoa API Gemini trong cai ??t
2. Ch?n ngon ng? c?a b?n (ti?ng Nh?t, ti?ng Anh, ti?ng Vi?t co s?n)
3. Nh?p "Start Conference" ?? b?t ??u
4. Chia s? URL ?? m?i ng??i tham gia khac

Vui long tr? l?i cau h?i c?a ng??i dung m?t cach l?ch s? b?ng ti?ng Vi?t.`,

        'chinese': `?是otak-conference系?助手。otak-conference是一个??多?言翻?会?系?。

主要功能：
• ???音翻?：支持25??言的即?翻?
• 使用WebRTC的高?量音?/??通?
• 屏幕共享功能
• ?已?回?的聊天功能
• 反?功能（点?、鼓掌、喜?）
• ?手功能
• 相机效果（背景模糊、美?模式、亮度?整）
• 音?????

使用方法：
1. 在?置中?入?的姓名和Gemini API密?
2. ???的?言（25??言可?）
3. 点?"Start Conference"?始会?
4. 分享URL邀?其他参与者

?用中文礼貌地回答用?的??。`,

        'korean': `??? otak-conference ??? ????????. otak-conference? ??? ??? ?? ?? ??????.

?? ??:
• ??? ?? ??: 25? ??? ???? ?? ??
• WebRTC? ??? ??? ??/??? ??
• ?? ?? ??
• ?? ??? ?? ??
• ?? ?? (???, ??, ??)
• ??? ??
• ??? ?? (?? ??, ?? ??, ?? ??)
• ??? ?? ??

?? ??:
1. ???? ??? Gemini API ?? ??
2. ?? ?? (25? ?? ?? ??)
3. "Start Conference"? ???? ?? ??
4. URL? ???? ?? ??? ??

???? ??? ???? ???? ??????.`,

        'spanish': `Eres el asistente del sistema otak-conference. otak-conference es un sistema de conferencias con traduccion multilingue en tiempo real.

Caracteristicas principales:
• Traduccion de voz en tiempo real: Soporta 25 idiomas con traduccion instantanea
• Llamadas de audio/video de alta calidad usando WebRTC
• Capacidad de compartir pantalla
• Funcion de chat con confirmacion de lectura
• Funciones de reaccion (corazon, aplausos, me gusta)
• Funcion de levantar la mano
• Efectos de camara (desenfoque de fondo, modo belleza, ajuste de brillo)
• Seleccion de dispositivo de audio

Como usar:
1. Ingrese su nombre y clave API de Gemini en configuracion
2. Seleccione su idioma (25 idiomas disponibles)
3. Haga clic en "Start Conference" para comenzar
4. Comparta la URL para invitar a otros participantes

Por favor responda las preguntas del usuario cortesmente en espanol.`,

        'french': `Vous etes l'assistant du systeme otak-conference. otak-conference est un systeme de conference avec traduction multilingue en temps reel.

Fonctionnalites principales :
• Traduction vocale en temps reel : Prend en charge 25 langues avec traduction instantanee
• Appels audio/video de haute qualite utilisant WebRTC
• Capacite de partage d'ecran
• Fonction de chat avec accuses de lecture
• Fonctions de reaction (c?ur, applaudissements, j'aime)
• Fonction lever la main
• Effets de camera (flou d'arriere-plan, mode beaute, reglage de la luminosite)
• Selection du peripherique audio

Comment utiliser :
1. Entrez votre nom et la cle API Gemini dans les parametres
2. Selectionnez votre langue (25 langues disponibles)
3. Cliquez sur "Start Conference" pour commencer
4. Partagez l'URL pour inviter d'autres participants

Veuillez repondre poliment aux questions de l'utilisateur en francais.`
      };

      // Default to English if language not found
      return languageMap[userLanguage.toLowerCase()] || languageMap['english'];
    };

    return appendNoSpeechRule(getSystemAssistantPrompt(state.config.sourceLanguage.toLowerCase()));
  }

  // Check if peer translation mode is enabled
  if (state.config.usePeerTranslation && state.config.otherParticipantLanguages && state.config.otherParticipantLanguages.length > 0) {
    // Peer-to-peer translation mode: translate my language to peer's language
    const targetLanguage = state.config.otherParticipantLanguages[0]; // Use first peer's language as primary target

    debugLog(`[Gemini Live Audio] Using peer translation mode: ${state.config.sourceLanguage} → ${targetLanguage}`);

    const prompt = appendDomainContext(
      createPeerTranslationSystemPrompt(state.config.sourceLanguage, targetLanguage)
    );
    return appendNoSpeechRule(prompt);
  }

  // Traditional translation mode (fallback)
  const prompt = appendDomainContext(
    getLanguageSpecificPrompt(state.config.sourceLanguage, state.config.targetLanguage)
  );
  return appendNoSpeechRule(prompt);
};

const appendDomainContext = (prompt: string): string => {
  const domainContext = [
    'ROLE: You are a professional translator working at a Japanese SIer.',
    'DOMAIN HINT: The conversation domain likely includes keywords about Java, TypeScript, AWS, OCI, GitHub Actions, Issues, Labels, Milestones, Assignees, CI/CD, CI, E2E, audit logs, idempotency, deduplication, unit tests, mock, technical debt, escalation, cache, masking, encryption, migration, state, Step Functions, UnitTest, OpenAI, Anthropic, unit tests, and E2E. Preserve product names and acronyms in English.'
  ].join(' ');
  return `${domainContext}\n\n${prompt}`;
};

const appendNoSpeechRule = (prompt: string): string => {
  return `${prompt}\n\nOUTPUT RULES: Output only the translation. Do not emit thoughts, analysis, commentary, labels, or metadata. Do not describe or evaluate the input.\nNON-SPEECH RULE: If the input audio is silence, background noise, or non-speech sounds, respond with nothing (no text, no audio).`;
};

export const sendInitialPrompt = (): void => {
  // System instruction is now set during session initialization
  // No need to send additional prompts as they are handled by system_instruction
  debugLog('[Gemini Live Audio] System instruction already set during session initialization');
};
