export interface Participant {
  clientId: string;
  username: string;
  language: string;
  isHandRaised?: boolean;
  reaction?: string;
  reactionTimestamp?: number;
  isSpeaking?: boolean;
  audioLevel?: number;
}

export interface ChatMessage {
  id: number;
  from: string;
  message: string;
  timestamp: string;
  readBy?: string[]; // Array of usernames who have read this message
}

export interface Translation {
  id: number;
  from: string; // This will be the username
  fromLanguage: string;
  original: string;
  translation: string;
  originalLanguageText?: string; // Re-translated text back to speaker's language for confirmation
  timestamp: string;
}

export interface AudioTranslation {
  id: number;
  from: string;
  fromLanguage: string;
  toLanguage: string;
  originalText: string;
  translatedText: string;
  audioUrl?: string; // Generated audio URL
  timestamp: string;
}

export interface VoiceSettings {
  voiceName: string;
  speed: number;
  pitch: number;
}

export interface TokenUsage {
  inputTokens: {
    text: number;
    audio: number;
  };
  outputTokens: {
    text: number;
    audio: number;
  };
  totalCost: number;
}

export interface ApiUsageStats {
  sessionUsage: TokenUsage;
  totalUsage: TokenUsage;
  sessionCount: number; // Total number of sessions created
}

export interface LocalPlaybackSettings {
  enabled: boolean; // Whether to play Gemini responses locally
}

export interface NoiseFilterSettings {
  enabled: boolean; // Whether noise filtering is enabled
  highPassFrequency: number; // High-pass filter frequency (Hz)
  lowPassFrequency: number; // Low-pass filter frequency (Hz)
  compressionRatio: number; // Compression ratio for dynamics compressor
  gainReduction: number; // Gain reduction in dB
}

export enum TranslationSpeedMode {
  ECONOMY = 'economy',     // 1500ms - 低コスト
  BALANCED = 'balanced',   // 800ms - バランス
  REALTIME = 'realtime',   // 300ms - リアルタイム
  ULTRAFAST = 'ultrafast'  // 30ms - 超高速
}

export interface TranslationSpeedSettings {
  mode: TranslationSpeedMode;
  sendInterval: number;
  textBufferDelay: number;
  estimatedCostMultiplier: number;
}