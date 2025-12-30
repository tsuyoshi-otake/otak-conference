import type { Participant } from '../types';
import type { ConferenceRefs, ConferenceState } from './useConferenceState';

type PeerConnectionActions = {
  createPeerConnection: (peerId: string, isInitiator: boolean) => Promise<RTCPeerConnection>;
  closePeerConnection: (peerId: string) => void;
  handleOffer: (peerId: string, offer: RTCSessionDescriptionInit) => Promise<void>;
  handleAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => Promise<void>;
  handleIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => Promise<void>;
};

export const buildGeminiSessionParams = (state: ConferenceState, refs: ConferenceRefs) => ({
  state: {
    apiKey: state.apiKey,
    username: state.username,
    myLanguage: state.myLanguage,
    translationSpeedSettings: state.translationSpeedSettings,
    setTranslations: state.setTranslations,
    setApiUsageStats: state.setApiUsageStats,
    setErrorMessage: state.setErrorMessage,
    setShowErrorModal: state.setShowErrorModal
  },
  refs: {
    liveAudioStreamRef: refs.liveAudioStreamRef,
    localStreamRef: refs.localStreamRef,
    isStartingGeminiRef: refs.isStartingGeminiRef,
    currentSourceLanguageRef: refs.currentSourceLanguageRef,
    currentTargetLanguageRef: refs.currentTargetLanguageRef,
    isSoloModeRef: refs.isSoloModeRef,
    pendingFallbackTimerRef: refs.pendingFallbackTimerRef,
    lastOutputTimestampRef: refs.lastOutputTimestampRef,
    inputTranscriptBufferRef: refs.inputTranscriptBufferRef,
    inputTranscriptTimeoutRef: refs.inputTranscriptTimeoutRef,
    pendingFallbackInputTimestampRef: refs.pendingFallbackInputTimestampRef,
    lastInputTimestampRef: refs.lastInputTimestampRef,
    wsRef: refs.wsRef,
    isLocalPlaybackEnabledRef: refs.isLocalPlaybackEnabledRef,
    clientIdRef: refs.clientIdRef
  }
});

export const buildSignalingParams = (
  state: ConferenceState,
  refs: ConferenceRefs,
  peerActions: PeerConnectionActions,
  updateGeminiTargetLanguage: (participants: Participant[]) => Promise<void>
) => ({
  state: {
    roomId: state.roomId,
    username: state.username,
    myLanguage: state.myLanguage,
    participants: state.participants,
    showChat: state.showChat,
    chatInput: state.chatInput,
    isHandRaised: state.isHandRaised,
    setIsHandRaised: state.setIsHandRaised,
    sendRawAudio: state.sendRawAudio,
    setSendRawAudio: state.setSendRawAudio,
    isInConference: state.isInConference,
    setIsConnected: state.setIsConnected,
    setIsInConference: state.setIsInConference,
    setErrorMessage: state.setErrorMessage,
    setShowErrorModal: state.setShowErrorModal,
    setParticipants: state.setParticipants,
    setTranslations: state.setTranslations,
    setChatMessages: state.setChatMessages,
    setChatInput: state.setChatInput,
    setUnreadMessageCount: state.setUnreadMessageCount,
    setShowChat: state.setShowChat,
    setShowReactions: state.setShowReactions,
    selectedSpeaker: state.selectedSpeaker,
    remoteScreenSharer: state.remoteScreenSharer,
    setRemoteScreenSharer: state.setRemoteScreenSharer,
    isScreenSharing: state.isScreenSharing
  },
  refs: {
    wsRef: refs.wsRef,
    clientIdRef: refs.clientIdRef,
    screenPreviewRef: refs.screenPreviewRef,
    peerConnectionsRef: refs.peerConnectionsRef,
    localStreamRef: refs.localStreamRef
  },
  actions: {
    ...peerActions,
    updateGeminiTargetLanguage
  }
});
