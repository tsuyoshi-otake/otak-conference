import type { ConferenceRefs, ConferenceState } from './useConferenceState';

type ReturnParams = {
  state: ConferenceState;
  refs: Pick<ConferenceRefs, 'videoRef' | 'canvasRef' | 'screenPreviewRef'>;
  actions: {
    startConference: () => Promise<void>;
    endConference: () => void;
    shareRoomUrl: () => Promise<void>;
    toggleMute: () => void;
    toggleScreenShare: () => Promise<void>;
    toggleCamera: () => Promise<void>;
    applyVideoEffects: () => void;
    toggleHandRaise: () => void;
    sendReaction: (reaction: string) => void;
    sendChatMessage: () => void;
    toggleChat: (value: boolean) => void;
    getAudioDevices: () => Promise<void>;
    changeMicrophone: (deviceId: string) => Promise<void>;
    changeSpeaker: (deviceId: string) => Promise<void>;
    toggleSendRawAudio: () => Promise<void>;
    toggleLocalPlayback: () => void;
    updateNoiseFilterSettings: (settings: Partial<ConferenceState['noiseFilterSettings']>) => void;
    toggleNoiseFilter: () => void;
    generateTranslationAudio: () => Promise<void>;
    toggleAudioTranslation: () => void;
    updateVoiceSettings: (settings: Partial<ConferenceState['voiceSettings']>) => void;
    updateApiUsage: (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => void;
    resetSessionUsage: () => void;
    updateTranslationSpeedMode: (mode: ConferenceState['translationSpeedMode']) => void;
  };
};

export const buildConferenceReturn = ({ state, refs, actions }: ReturnParams) => ({
  apiKey: state.apiKey,
  setApiKey: state.setApiKey,
  username: state.username,
  setUsername: state.setUsername,
  roomId: state.roomId,
  setRoomId: state.setRoomId,
  isConnected: state.isConnected,
  setIsConnected: state.setIsConnected,
  isInConference: state.isInConference,
  setIsInConference: state.setIsInConference,
  isMuted: state.isMuted,
  setIsMuted: state.setIsMuted,
  isScreenSharing: state.isScreenSharing,
  setIsScreenSharing: state.setIsScreenSharing,
  isCameraOn: state.isCameraOn,
  setIsCameraOn: state.setIsCameraOn,
  isBackgroundBlur: state.isBackgroundBlur,
  setIsBackgroundBlur: state.setIsBackgroundBlur,
  isBeautyMode: state.isBeautyMode,
  setIsBeautyMode: state.setIsBeautyMode,
  brightness: state.brightness,
  setBrightness: state.setBrightness,
  showCameraSettings: state.showCameraSettings,
  setShowCameraSettings: state.setShowCameraSettings,
  myLanguage: state.myLanguage,
  setMyLanguage: state.setMyLanguage,
  translations: state.translations,
  setTranslations: state.setTranslations,
  participants: state.participants,
  setParticipants: state.setParticipants,
  showSettings: state.showSettings,
  setShowSettings: state.setShowSettings,
  showRoomUrl: state.showRoomUrl,
  setShowRoomUrl: state.setShowRoomUrl,
  showCopyModal: state.showCopyModal,
  setShowCopyModal: state.setShowCopyModal,
  remoteScreenSharer: state.remoteScreenSharer,
  setRemoteScreenSharer: state.setRemoteScreenSharer,
  isHandRaised: state.isHandRaised,
  setIsHandRaised: state.setIsHandRaised,
  showChat: state.showChat,
  toggleChat: actions.toggleChat,
  showReactions: state.showReactions,
  setShowReactions: state.setShowReactions,
  chatMessages: state.chatMessages,
  setChatMessages: state.setChatMessages,
  chatInput: state.chatInput,
  setChatInput: state.setChatInput,
  unreadMessageCount: state.unreadMessageCount,
  setUnreadMessageCount: state.setUnreadMessageCount,
  showAudioSettings: state.showAudioSettings,
  setShowAudioSettings: state.setShowAudioSettings,
  audioInputDevices: state.audioInputDevices,
  audioOutputDevices: state.audioOutputDevices,
  selectedMicrophone: state.selectedMicrophone,
  showErrorModal: state.showErrorModal,
  setShowErrorModal: state.setShowErrorModal,
  errorMessage: state.errorMessage,
  selectedSpeaker: state.selectedSpeaker,
  sendRawAudio: state.sendRawAudio,
  isLocalPlaybackEnabled: state.isLocalPlaybackEnabled,
  videoRef: refs.videoRef,
  canvasRef: refs.canvasRef,
  screenPreviewRef: refs.screenPreviewRef,
  startConference: actions.startConference,
  endConference: actions.endConference,
  shareRoomUrl: actions.shareRoomUrl,
  toggleMute: actions.toggleMute,
  toggleScreenShare: actions.toggleScreenShare,
  toggleCamera: actions.toggleCamera,
  applyVideoEffects: actions.applyVideoEffects,
  toggleHandRaise: actions.toggleHandRaise,
  sendReaction: actions.sendReaction,
  sendChatMessage: actions.sendChatMessage,
  getAudioDevices: actions.getAudioDevices,
  changeMicrophone: actions.changeMicrophone,
  changeSpeaker: actions.changeSpeaker,
  toggleSendRawAudio: actions.toggleSendRawAudio,
  toggleLocalPlayback: actions.toggleLocalPlayback,
  noiseFilterSettings: state.noiseFilterSettings,
  updateNoiseFilterSettings: actions.updateNoiseFilterSettings,
  toggleNoiseFilter: actions.toggleNoiseFilter,
  audioTranslations: state.audioTranslations,
  isAudioTranslationEnabled: state.isAudioTranslationEnabled,
  voiceSettings: state.voiceSettings,
  generateTranslationAudio: actions.generateTranslationAudio,
  toggleAudioTranslation: actions.toggleAudioTranslation,
  updateVoiceSettings: actions.updateVoiceSettings,
  apiUsageStats: state.apiUsageStats,
  updateApiUsage: actions.updateApiUsage,
  resetSessionUsage: actions.resetSessionUsage,
  isGeminiSpeaking: state.isGeminiSpeaking,
  translationSpeedMode: state.translationSpeedMode,
  translationSpeedSettings: state.translationSpeedSettings,
  updateTranslationSpeedMode: actions.updateTranslationSpeedMode
});
