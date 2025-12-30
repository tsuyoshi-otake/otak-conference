import type React from 'react';
import type {
  ApiUsageStats,
  AudioTranslation,
  ChatMessage,
  NoiseFilterSettings,
  Participant,
  Translation,
  TranslationSpeedMode,
  TranslationSpeedSettings,
  VoiceSettings
} from '../types';

export interface ConferenceAppProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  roomId: string;
  isConnected: boolean;
  isInConference: boolean;
  isMuted: boolean;
  isScreenSharing: boolean;
  isCameraOn: boolean;
  isBackgroundBlur: boolean;
  setIsBackgroundBlur: (value: boolean) => void;
  isBeautyMode: boolean;
  setIsBeautyMode: (value: boolean) => void;
  brightness: number;
  setBrightness: (value: number) => void;
  showCameraSettings: boolean;
  setShowCameraSettings: (value: boolean) => void;
  myLanguage: string;
  setMyLanguage: (value: string) => void;
  translations: Translation[];
  participants: Participant[];
  showSettings: boolean;
  setShowSettings: (value: boolean) => void;
  showCopyModal: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  screenPreviewRef: React.RefObject<HTMLVideoElement | null>;
  remoteScreenSharer: string | null;
  isHandRaised: boolean;
  showChat: boolean;
  toggleChat: (value: boolean) => void;
  unreadMessageCount: number;
  showAudioSettings: boolean;
  setShowAudioSettings: (value: boolean) => void;
  audioInputDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedMicrophone: string;
  selectedSpeaker: string;
  getAudioDevices: () => Promise<void>;
  changeMicrophone: (deviceId: string) => Promise<void>;
  changeSpeaker: (deviceId: string) => Promise<void>;
  sendRawAudio: boolean;
  toggleSendRawAudio: () => void;
  noiseFilterSettings: NoiseFilterSettings;
  updateNoiseFilterSettings: (settings: Partial<NoiseFilterSettings>) => void;
  toggleNoiseFilter: () => void;
  showReactions: boolean;
  showErrorModal: boolean;
  setShowErrorModal: (value: boolean) => void;
  errorMessage: string;
  setShowReactions: (value: boolean) => void;
  chatMessages: ChatMessage[];
  chatInput: string;
  setChatInput: (value: string) => void;
  startConference: () => void;
  endConference: () => void;
  shareRoomUrl: () => void;
  toggleMute: () => void;
  toggleScreenShare: () => void;
  toggleCamera: () => void;
  toggleHandRaise: () => void;
  sendReaction: (reaction: string) => void;
  sendChatMessage: () => void;

  audioTranslations: AudioTranslation[];
  isAudioTranslationEnabled: boolean;
  voiceSettings: VoiceSettings;
  generateTranslationAudio: (translatedText: string, targetLanguage: string, originalText: string, fromLanguage: string) => Promise<void>;
  toggleAudioTranslation: () => void;
  updateVoiceSettings: (settings: Partial<VoiceSettings>) => void;

  apiUsageStats: ApiUsageStats;
  updateApiUsage: (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => void;
  resetSessionUsage: () => void;

  isLocalPlaybackEnabled: boolean;
  toggleLocalPlayback: () => void;

  isGeminiSpeaking: boolean;

  translationSpeedMode: TranslationSpeedMode;
  translationSpeedSettings: TranslationSpeedSettings;
  updateTranslationSpeedMode: (mode: TranslationSpeedMode) => void;
}
