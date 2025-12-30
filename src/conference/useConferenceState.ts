import { useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiUsageStats,
  AudioTranslation,
  ChatMessage,
  NoiseFilterSettings,
  Participant,
  TokenUsage,
  Translation,
  TranslationSpeedMode,
  TranslationSpeedSettings,
  VoiceSettings
} from '../types';
import type { GeminiLiveAudioStream } from '../gemini-live-audio';
import { DEFAULT_TRANSLATION_SPEED_SETTINGS } from './translationSpeed';

export type NormalizedTestAudioOptions = {
  loop: boolean;
  volume: number;
  playbackRate: number;
};

export type TestAudioState = {
  stream: MediaStream;
  audio: HTMLAudioElement;
  url: string;
  sourceNode?: MediaElementAudioSourceNode;
  destination?: MediaStreamAudioDestinationNode;
  endedHandler?: () => void;
  options?: NormalizedTestAudioOptions;
};

export const useConferenceState = () => {
  const [apiKey, setApiKey] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isInConference, setIsInConference] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isCameraOn, setIsCameraOn] = useState<boolean>(false);
  const [isBackgroundBlur, setIsBackgroundBlur] = useState<boolean>(false);
  const [isBeautyMode, setIsBeautyMode] = useState<boolean>(false);
  const [brightness, setBrightness] = useState<number>(100);
  const [showCameraSettings, setShowCameraSettings] = useState<boolean>(false);
  const [myLanguage, setMyLanguage] = useState<string>('english');
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showRoomUrl, setShowRoomUrl] = useState<boolean>(false);
  const [showCopyModal, setShowCopyModal] = useState<boolean>(false);
  const [remoteScreenSharer, setRemoteScreenSharer] = useState<string | null>(null);
  const [isHandRaised, setIsHandRaised] = useState<boolean>(false);
  const [showChat, setShowChat] = useState<boolean>(false);
  const [showReactions, setShowReactions] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [audioTranslations, setAudioTranslations] = useState<AudioTranslation[]>([]);
  const [isAudioTranslationEnabled, setIsAudioTranslationEnabled] = useState<boolean>(true);
  const isAudioTranslationEnabledRef = useRef<boolean>(true);
  const [isLocalPlaybackEnabled, setIsLocalPlaybackEnabled] = useState<boolean>(true);
  const isLocalPlaybackEnabledRef = useRef<boolean>(true);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({
    voiceName: 'Zephyr',
    speed: 1.0,
    pitch: 1.0
  });
  const [unreadMessageCount, setUnreadMessageCount] = useState<number>(0);
  const [showAudioSettings, setShowAudioSettings] = useState<boolean>(false);
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [sendRawAudio, setSendRawAudio] = useState<boolean>(false);
  const [isGeminiSpeaking, setIsGeminiSpeaking] = useState<boolean>(false);
  const [noiseFilterSettings, setNoiseFilterSettings] = useState<NoiseFilterSettings>({
    enabled: true,
    highPassFrequency: 100,
    lowPassFrequency: 8000,
    compressionRatio: 3,
    gainReduction: -6
  });
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [translationSpeedMode, setTranslationSpeedMode] = useState<TranslationSpeedMode>(
    TranslationSpeedMode.ULTRAFAST
  );
  const [translationSpeedSettings, setTranslationSpeedSettings] = useState<TranslationSpeedSettings>(
    DEFAULT_TRANSLATION_SPEED_SETTINGS
  );
  const [apiUsageStats, setApiUsageStats] = useState<ApiUsageStats>({
    sessionUsage: {
      inputTokens: { text: 0, audio: 0 },
      outputTokens: { text: 0, audio: 0 },
      totalCost: 0
    },
    totalUsage: {
      inputTokens: { text: 0, audio: 0 },
      outputTokens: { text: 0, audio: 0 },
      totalCost: 0
    },
    sessionCount: 0
  });

  const audioAnalyzerRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const lastSpeakingStatusRef = useRef<boolean>(false);
  const lastSpeakingUpdateRef = useRef<number>(0);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const highPassFilterRef = useRef<BiquadFilterNode | null>(null);
  const lowPassFilterRef = useRef<BiquadFilterNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const filteredStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenPreviewRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const clientIdRef = useRef<string>(uuidv4());
  const liveAudioStreamRef = useRef<GeminiLiveAudioStream | null>(null);
  const isStartingGeminiRef = useRef<boolean>(false);
  const inputTranscriptBufferRef = useRef<string[]>([]);
  const inputTranscriptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFallbackInputTimestampRef = useRef<number>(0);
  const lastOutputTimestampRef = useRef<number>(0);
  const lastInputTimestampRef = useRef<number>(0);
  const currentSourceLanguageRef = useRef<string>('english');
  const currentTargetLanguageRef = useRef<string>('english');
  const isSoloModeRef = useRef<boolean>(false);
  const testAudioRef = useRef<TestAudioState | null>(null);

  return {
    state: {
      apiKey,
      setApiKey,
      username,
      setUsername,
      roomId,
      setRoomId,
      isConnected,
      setIsConnected,
      isInConference,
      setIsInConference,
      isMuted,
      setIsMuted,
      isScreenSharing,
      setIsScreenSharing,
      isCameraOn,
      setIsCameraOn,
      isBackgroundBlur,
      setIsBackgroundBlur,
      isBeautyMode,
      setIsBeautyMode,
      brightness,
      setBrightness,
      showCameraSettings,
      setShowCameraSettings,
      myLanguage,
      setMyLanguage,
      translations,
      setTranslations,
      participants,
      setParticipants,
      showSettings,
      setShowSettings,
      showRoomUrl,
      setShowRoomUrl,
      showCopyModal,
      setShowCopyModal,
      remoteScreenSharer,
      setRemoteScreenSharer,
      isHandRaised,
      setIsHandRaised,
      showChat,
      setShowChat,
      showReactions,
      setShowReactions,
      chatMessages,
      setChatMessages,
      chatInput,
      setChatInput,
      audioTranslations,
      setAudioTranslations,
      isAudioTranslationEnabled,
      setIsAudioTranslationEnabled,
      isLocalPlaybackEnabled,
      setIsLocalPlaybackEnabled,
      voiceSettings,
      setVoiceSettings,
      unreadMessageCount,
      setUnreadMessageCount,
      showAudioSettings,
      setShowAudioSettings,
      audioInputDevices,
      setAudioInputDevices,
      audioOutputDevices,
      setAudioOutputDevices,
      selectedMicrophone,
      setSelectedMicrophone,
      selectedSpeaker,
      setSelectedSpeaker,
      sendRawAudio,
      setSendRawAudio,
      isGeminiSpeaking,
      setIsGeminiSpeaking,
      noiseFilterSettings,
      setNoiseFilterSettings,
      showErrorModal,
      setShowErrorModal,
      errorMessage,
      setErrorMessage,
      translationSpeedMode,
      setTranslationSpeedMode,
      translationSpeedSettings,
      setTranslationSpeedSettings,
      apiUsageStats,
      setApiUsageStats
    },
    refs: {
      isAudioTranslationEnabledRef,
      isLocalPlaybackEnabledRef,
      audioAnalyzerRef,
      audioDataRef,
      lastSpeakingStatusRef,
      lastSpeakingUpdateRef,
      sourceNodeRef,
      highPassFilterRef,
      lowPassFilterRef,
      compressorRef,
      gainNodeRef,
      destinationRef,
      filteredStreamRef,
      wsRef,
      localStreamRef,
      screenStreamRef,
      cameraStreamRef,
      videoRef,
      canvasRef,
      screenPreviewRef,
      peerConnectionsRef,
      audioContextRef,
      clientIdRef,
      liveAudioStreamRef,
      isStartingGeminiRef,
      inputTranscriptBufferRef,
      inputTranscriptTimeoutRef,
      pendingFallbackTimerRef,
      pendingFallbackInputTimestampRef,
      lastOutputTimestampRef,
      lastInputTimestampRef,
      currentSourceLanguageRef,
      currentTargetLanguageRef,
      isSoloModeRef,
      testAudioRef
    }
  };
};

export type ConferenceState = ReturnType<typeof useConferenceState>['state'];
export type ConferenceRefs = ReturnType<typeof useConferenceState>['refs'];
