import { useEffect } from 'react';
import { useApiUsage } from './useApiUsage';
import { useConferenceLifecycle } from './useConferenceLifecycle';
import { useConferenceControls } from './useConferenceControls';
import { buildConferenceReturn } from './conferenceReturn';
import { useConferencePersistence } from './useConferencePersistence';
import { useConferenceState } from './useConferenceState';
import { useTranslationControls } from './useTranslationControls';
import { useAudioDevices } from './audio/useAudioDevices';
import { useAudioInput } from './audio/useAudioInput';
import { useAudioLevelMonitor } from './audio/useAudioLevelMonitor';
import { useNoiseFilter } from './audio/useNoiseFilter';
import { useTestAudio } from './audio/useTestAudio';
import { useTestAudioDebug } from './audio/useTestAudioDebug';
import { useGeminiSession } from './gemini/useGeminiSession';
import { useMediaControls } from './media/useMediaControls';
import { buildGeminiSessionParams, buildSignalingParams } from './setupParams';
import { usePeerConnections } from './signaling/usePeerConnections';
import { useSignaling } from './signaling/useSignaling';

export const useConferenceApp = () => {
  const { state, refs } = useConferenceState();

  useConferencePersistence({ state, refs });

  const { toggleAudioTranslation, updateVoiceSettings, updateTranslationSpeedMode } = useTranslationControls({
    state: {
      isAudioTranslationEnabled: state.isAudioTranslationEnabled,
      setIsAudioTranslationEnabled: state.setIsAudioTranslationEnabled,
      voiceSettings: state.voiceSettings,
      setVoiceSettings: state.setVoiceSettings,
      translationSpeedMode: state.translationSpeedMode,
      setTranslationSpeedMode: state.setTranslationSpeedMode,
      translationSpeedSettings: state.translationSpeedSettings,
      setTranslationSpeedSettings: state.setTranslationSpeedSettings
    },
    refs: {
      isAudioTranslationEnabledRef: refs.isAudioTranslationEnabledRef,
      liveAudioStreamRef: refs.liveAudioStreamRef
    }
  });

  const { updateApiUsage, resetSessionUsage } = useApiUsage({
    setApiUsageStats: state.setApiUsageStats
  });

  const { setupNoiseFilterChain, cleanupNoiseFilterChain } = useNoiseFilter({
    state: { noiseFilterSettings: state.noiseFilterSettings },
    refs: {
      audioContextRef: refs.audioContextRef,
      sourceNodeRef: refs.sourceNodeRef,
      highPassFilterRef: refs.highPassFilterRef,
      lowPassFilterRef: refs.lowPassFilterRef,
      compressorRef: refs.compressorRef,
      gainNodeRef: refs.gainNodeRef,
      destinationRef: refs.destinationRef,
      filteredStreamRef: refs.filteredStreamRef
    }
  });

  const { setupAudioLevelDetection } = useAudioLevelMonitor({
    state: {
      participants: state.participants,
      setParticipants: state.setParticipants,
      noiseFilterSettings: state.noiseFilterSettings,
      username: state.username
    },
    refs: {
      audioAnalyzerRef: refs.audioAnalyzerRef,
      audioDataRef: refs.audioDataRef,
      lastSpeakingStatusRef: refs.lastSpeakingStatusRef,
      lastSpeakingUpdateRef: refs.lastSpeakingUpdateRef,
      localStreamRef: refs.localStreamRef,
      filteredStreamRef: refs.filteredStreamRef,
      audioContextRef: refs.audioContextRef,
      wsRef: refs.wsRef,
      clientIdRef: refs.clientIdRef
    }
  });

  const { replaceLocalAudioInputStream, toggleMute } = useAudioInput({
    state: {
      isMuted: state.isMuted,
      setIsMuted: state.setIsMuted
    },
    refs: {
      localStreamRef: refs.localStreamRef,
      peerConnectionsRef: refs.peerConnectionsRef,
      testAudioRef: refs.testAudioRef
    },
    setupNoiseFilterChain,
    cleanupNoiseFilterChain,
    setupAudioLevelDetection
  });

  const { setTestAudioUrl, stopTestAudio, getAudioInputStream } = useTestAudio({
    state: { isInConference: state.isInConference },
    refs: {
      testAudioRef: refs.testAudioRef,
      audioContextRef: refs.audioContextRef,
      liveAudioStreamRef: refs.liveAudioStreamRef
    },
    onTestAudioReady: (stream) => {
      if (state.isInConference) {
        replaceLocalAudioInputStream(stream);
      }
    }
  });

  const { getAudioDevices, changeMicrophone, changeSpeaker } = useAudioDevices({
    state: {
      selectedMicrophone: state.selectedMicrophone,
      setSelectedMicrophone: state.setSelectedMicrophone,
      selectedSpeaker: state.selectedSpeaker,
      setSelectedSpeaker: state.setSelectedSpeaker,
      setAudioInputDevices: state.setAudioInputDevices,
      setAudioOutputDevices: state.setAudioOutputDevices,
      isInConference: state.isInConference
    },
    refs: {
      audioContextRef: refs.audioContextRef,
      localStreamRef: refs.localStreamRef
    },
    getAudioInputStream,
    replaceLocalAudioInputStream
  });

  const { toggleScreenShare, toggleCamera, applyVideoEffects } = useMediaControls({
    state: {
      isScreenSharing: state.isScreenSharing,
      setIsScreenSharing: state.setIsScreenSharing,
      isCameraOn: state.isCameraOn,
      setIsCameraOn: state.setIsCameraOn,
      isBackgroundBlur: state.isBackgroundBlur,
      isBeautyMode: state.isBeautyMode,
      brightness: state.brightness,
      remoteScreenSharer: state.remoteScreenSharer
    },
    refs: {
      screenStreamRef: refs.screenStreamRef,
      cameraStreamRef: refs.cameraStreamRef,
      screenPreviewRef: refs.screenPreviewRef,
      videoRef: refs.videoRef,
      canvasRef: refs.canvasRef,
      peerConnectionsRef: refs.peerConnectionsRef
    }
  });

  const peerConnections = usePeerConnections({
    state: {
      sendRawAudio: state.sendRawAudio,
      selectedSpeaker: state.selectedSpeaker,
      setRemoteScreenSharer: state.setRemoteScreenSharer,
      remoteScreenSharer: state.remoteScreenSharer,
      isScreenSharing: state.isScreenSharing
    },
    refs: {
      localStreamRef: refs.localStreamRef,
      peerConnectionsRef: refs.peerConnectionsRef,
      wsRef: refs.wsRef,
      screenPreviewRef: refs.screenPreviewRef
    }
  });

  const { updateGeminiTargetLanguage } = useGeminiSession(buildGeminiSessionParams(state, refs));

  const { connectToSignaling, toggleHandRaise, sendReaction, sendChatMessage, toggleChat, toggleSendRawAudio } = useSignaling(
    buildSignalingParams(
      state,
      refs,
      {
        createPeerConnection: peerConnections.createPeerConnection,
        closePeerConnection: peerConnections.closePeerConnection,
        handleOffer: peerConnections.handleOffer,
        handleAnswer: peerConnections.handleAnswer,
        handleIceCandidate: peerConnections.handleIceCandidate
      },
      updateGeminiTargetLanguage
    )
  );

  const {
    useMicrophoneInput,
    toggleLocalPlayback,
    updateNoiseFilterSettings,
    toggleNoiseFilter,
    generateTranslationAudio
  } = useConferenceControls({
    state: {
      isInConference: state.isInConference,
      selectedMicrophone: state.selectedMicrophone,
      noiseFilterSettings: state.noiseFilterSettings,
      setNoiseFilterSettings: state.setNoiseFilterSettings,
      isAudioTranslationEnabled: state.isAudioTranslationEnabled,
      isLocalPlaybackEnabled: state.isLocalPlaybackEnabled,
      setIsLocalPlaybackEnabled: state.setIsLocalPlaybackEnabled
    },
    refs: {
      isLocalPlaybackEnabledRef: refs.isLocalPlaybackEnabledRef,
      liveAudioStreamRef: refs.liveAudioStreamRef,
      localStreamRef: refs.localStreamRef
    },
    actions: {
      stopTestAudio,
      getAudioInputStream,
      replaceLocalAudioInputStream,
      changeMicrophone
    }
  });

  useTestAudioDebug({
    setTestAudioUrl,
    stopTestAudio,
    useMicrophoneInput,
    testAudioRef: refs.testAudioRef
  });

  useEffect(() => {
    return () => {
      state.audioTranslations.forEach(translation => {
        if (translation.audioUrl) {
          URL.revokeObjectURL(translation.audioUrl);
        }
      });
    };
  }, [state.audioTranslations]);

  const { startConference, endConference, shareRoomUrl } = useConferenceLifecycle({
    state: {
      apiKey: state.apiKey,
      username: state.username,
      selectedMicrophone: state.selectedMicrophone,
      myLanguage: state.myLanguage,
      roomId: state.roomId,
      setParticipants: state.setParticipants,
      setIsConnected: state.setIsConnected,
      setIsInConference: state.setIsInConference,
      setShowSettings: state.setShowSettings,
      setIsScreenSharing: state.setIsScreenSharing,
      setIsMuted: state.setIsMuted,
      setTranslations: state.setTranslations,
      setShowCopyModal: state.setShowCopyModal
    },
    refs: {
      clientIdRef: refs.clientIdRef,
      localStreamRef: refs.localStreamRef,
      peerConnectionsRef: refs.peerConnectionsRef,
      screenStreamRef: refs.screenStreamRef,
      wsRef: refs.wsRef,
      liveAudioStreamRef: refs.liveAudioStreamRef
    },
    actions: {
      getAudioInputStream,
      replaceLocalAudioInputStream,
      connectToSignaling,
      updateGeminiTargetLanguage,
      cleanupNoiseFilterChain,
      closePeerConnection: peerConnections.closePeerConnection
    }
  });

  return buildConferenceReturn({
    state,
    refs: {
      videoRef: refs.videoRef,
      canvasRef: refs.canvasRef,
      screenPreviewRef: refs.screenPreviewRef
    },
    actions: {
      startConference,
      endConference,
      shareRoomUrl,
      toggleMute,
      toggleScreenShare,
      toggleCamera,
      applyVideoEffects,
      toggleHandRaise,
      sendReaction,
      sendChatMessage,
      toggleChat,
      getAudioDevices,
      changeMicrophone,
      changeSpeaker,
      toggleSendRawAudio,
      toggleLocalPlayback,
      updateNoiseFilterSettings,
      toggleNoiseFilter,
      generateTranslationAudio,
      toggleAudioTranslation,
      updateVoiceSettings,
      updateApiUsage,
      resetSessionUsage,
      updateTranslationSpeedMode
    }
  });
};
