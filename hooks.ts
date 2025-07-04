import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Participant, Translation, ChatMessage, AudioTranslation, VoiceSettings, ApiUsageStats, TokenUsage, NoiseFilterSettings, TranslationSpeedMode, TranslationSpeedSettings } from './types';
// Removed old gemini-utils imports - now using GeminiLiveAudioStream directly
import { GeminiLiveAudioStream, GEMINI_LANGUAGE_MAP, playAudioData } from './gemini-live-audio';
import { languagePromptManager } from './translation-prompts';
import { debugLog, debugWarn, debugError, infoLog } from './debug-utils';
import { getTextRetranslationService } from './text-retranslation-service';

export const useConferenceApp = () => {
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
  const [isLocalPlaybackEnabled, setIsLocalPlaybackEnabled] = useState<boolean>(true); // Control local playback of Gemini responses
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
  const [sendRawAudio, setSendRawAudio] = useState<boolean>(false); // Default: only send translated audio
  const [isGeminiSpeaking, setIsGeminiSpeaking] = useState<boolean>(false); // Track Gemini speaking state
  
  // Noise filter state
  const [noiseFilterSettings, setNoiseFilterSettings] = useState<NoiseFilterSettings>({
    enabled: true, // Default ON for better audio quality
    highPassFrequency: 100, // Remove low-frequency noise (AC, fans)
    lowPassFrequency: 8000, // Remove high-frequency noise (electronics)
    compressionRatio: 3, // Moderate compression
    gainReduction: -6 // 6dB gain reduction
  });
  
  // Error modal state
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  // Translation speed settings
  const [translationSpeedMode, setTranslationSpeedMode] = useState<TranslationSpeedMode>(TranslationSpeedMode.ULTRAFAST);
  const [translationSpeedSettings, setTranslationSpeedSettings] = useState<TranslationSpeedSettings>({
    mode: TranslationSpeedMode.ULTRAFAST,
    sendInterval: 30,        // Ultra-low latency: 30ms
    textBufferDelay: 800,    // Keep text buffer longer for better readability
    estimatedCostMultiplier: 15.0
  });

  // API usage tracking
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
  
  // Audio level detection
  const audioAnalyzerRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const lastSpeakingStatusRef = useRef<boolean>(false); // Track previous speaking status
  const lastSpeakingUpdateRef = useRef<number>(0); // Track last speaking status update time

  // Noise filter audio nodes
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
  const clientIdRef = useRef<string>(uuidv4()); // Use UUID for internal client ID
  const audioRecordersRef = useRef<Map<string, any>>(new Map()); // Store remote audio streams
  const liveAudioStreamRef = useRef<GeminiLiveAudioStream | null>(null);
  
  // ICE servers configuration with stable WebRTC settings
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ],
    bundlePolicy: 'balanced' as RTCBundlePolicy, // More compatible than max-bundle
    rtcpMuxPolicy: 'require' as RTCRtcpMuxPolicy,
    iceCandidatePoolSize: 5 // Reduced for better compatibility
  };

  // Load settings from localStorage on mount
  useEffect(() => {
    const storedApiKey = localStorage.getItem('geminiApiKey');
    const storedUsername = localStorage.getItem('username');
    const storedLanguage = localStorage.getItem('myLanguage');
    const storedMicrophone = localStorage.getItem('selectedMicrophone');
    const storedLocalPlayback = localStorage.getItem('isLocalPlaybackEnabled');
    const storedSpeaker = localStorage.getItem('selectedSpeaker');
    const storedSendRawAudio = localStorage.getItem('sendRawAudio');
    const storedNoiseFilter = localStorage.getItem('noiseFilterSettings');
    const storedUsage = localStorage.getItem('geminiApiUsage');
    const storedSpeedMode = localStorage.getItem('translationSpeedMode');
    
    if (storedApiKey) {
      setApiKey(storedApiKey);
    }
    if (storedUsername) {
      setUsername(storedUsername);
    }
    if (storedLanguage) {
      setMyLanguage(storedLanguage);
    }
    // Load session count from localStorage
    const storedSessionCount = localStorage.getItem('geminiSessionCount');
    
    if (storedUsage) {
      try {
        const parsedUsage = JSON.parse(storedUsage);
        const sessionCount = storedSessionCount ? parseInt(storedSessionCount, 10) : 0;
        setApiUsageStats(prev => ({
          ...prev,
          totalUsage: parsedUsage,
          sessionCount: sessionCount
        }));
      } catch (error) {
        debugError('Failed to parse stored API usage:', error);
      }
    } else if (storedSessionCount) {
      // If only session count is stored
      try {
        const sessionCount = parseInt(storedSessionCount, 10);
        setApiUsageStats(prev => ({
          ...prev,
          sessionCount: sessionCount
        }));
      } catch (error) {
        debugError('Failed to parse stored session count:', error);
      }
    }
    if (storedMicrophone) {
      setSelectedMicrophone(storedMicrophone);
    }
    if (storedSpeaker) {
      setSelectedSpeaker(storedSpeaker);
    }
    if (storedSendRawAudio !== null) {
      setSendRawAudio(storedSendRawAudio === 'true');
    }
    if (storedLocalPlayback !== null) {
      const localPlaybackEnabled = storedLocalPlayback === 'true';
      setIsLocalPlaybackEnabled(localPlaybackEnabled);
      isLocalPlaybackEnabledRef.current = localPlaybackEnabled;
    }
    if (storedNoiseFilter) {
      try {
        const parsedNoiseFilter = JSON.parse(storedNoiseFilter);
        setNoiseFilterSettings(parsedNoiseFilter);
      } catch (error) {
        debugError('Failed to parse stored noise filter settings:', error);
      }
    }
    if (storedSpeedMode) {
      updateTranslationSpeedMode(storedSpeedMode as TranslationSpeedMode);
    }

    // Check URL for roomId in query string
    const urlParams = new URLSearchParams(window.location.search);
    const queryRoomId = urlParams.get('roomId');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (queryRoomId && uuidRegex.test(queryRoomId)) { // Basic UUID validation
      setRoomId(queryRoomId);
      setShowSettings(false); // Hide settings if joining a room
    } else {
      setRoomId(uuidv4()); // Generate new room ID if not in URL
    }
  }, []);

  // Load settings from localStorage on mount
  useEffect(() => {
    debugLog('[otak-conference] Loading settings from localStorage...');
    const savedApiKey = localStorage.getItem('geminiApiKey');
    const savedUsername = localStorage.getItem('username');
    const savedLanguage = localStorage.getItem('myLanguage');
    
    debugLog('[otak-conference] Saved API Key:', savedApiKey ? 'Found (hidden for security)' : 'Not found');
    debugLog('[otak-conference] Saved Username:', savedUsername);
    debugLog('[otak-conference] Saved Language:', savedLanguage);
    
    if (savedApiKey) setApiKey(savedApiKey);
    if (savedUsername) setUsername(savedUsername);
    if (savedLanguage) setMyLanguage(savedLanguage);
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    debugLog('[otak-conference] Saving API Key to localStorage:', apiKey ? 'Key provided (hidden for security)' : 'Empty key');
    localStorage.setItem('geminiApiKey', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('username', username);
  }, [username]);

  useEffect(() => {
    localStorage.setItem('myLanguage', myLanguage);
  }, [myLanguage]);

  useEffect(() => {
    if (selectedMicrophone) {
      localStorage.setItem('selectedMicrophone', selectedMicrophone);
    }
  }, [selectedMicrophone]);

  useEffect(() => {
    if (selectedSpeaker) {
      localStorage.setItem('selectedSpeaker', selectedSpeaker);
    }
  }, [selectedSpeaker]);

  // Save noise filter settings to localStorage
  useEffect(() => {
    localStorage.setItem('noiseFilterSettings', JSON.stringify(noiseFilterSettings));
  }, [noiseFilterSettings]);

  // Save session count to localStorage
  useEffect(() => {
    if (apiUsageStats.sessionCount !== undefined) {
      localStorage.setItem('geminiSessionCount', apiUsageStats.sessionCount.toString());
    }
  }, [apiUsageStats.sessionCount]);

  // Save total usage to localStorage
  useEffect(() => {
    if (apiUsageStats.totalUsage) {
      localStorage.setItem('geminiApiUsage', JSON.stringify(apiUsageStats.totalUsage));
    }
  }, [apiUsageStats.totalUsage]);

  // Get available audio devices
  const getAudioDevices = async () => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        debugWarn('MediaDevices API not available');
        return;
      }
      
      // Request media permissions first to get device labels
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Stop the stream immediately as we only needed it for permissions
        stream.getTracks().forEach(track => track.stop());
      } catch (permissionError) {
        debugWarn('Media permission not granted, device labels may be limited:', permissionError);
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices) {
        debugWarn('No devices returned from enumerateDevices');
        return;
      }
      
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
      
      debugLog('Available audio inputs:', audioInputs);
      debugLog('Available audio outputs:', audioOutputs);
      
      setAudioInputDevices(audioInputs);
      setAudioOutputDevices(audioOutputs);
      
      // Validate and set microphone device
      if (selectedMicrophone) {
        // Check if the saved microphone still exists
        const micExists = audioInputs.some(device => device.deviceId === selectedMicrophone);
        if (!micExists && audioInputs.length > 0) {
          debugLog('[AUDIO] Saved microphone not found, selecting default');
          setSelectedMicrophone(audioInputs[0].deviceId);
        }
      } else if (audioInputs.length > 0) {
        setSelectedMicrophone(audioInputs[0].deviceId);
      }
      
      // Validate and set speaker device
      if (selectedSpeaker) {
        // Check if the saved speaker still exists
        const speakerExists = audioOutputs.some(device => device.deviceId === selectedSpeaker);
        if (!speakerExists && audioOutputs.length > 0) {
          debugLog('[AUDIO] Saved speaker not found, selecting default');
          setSelectedSpeaker(audioOutputs[0].deviceId);
        }
      } else if (audioOutputs.length > 0) {
        setSelectedSpeaker(audioOutputs[0].deviceId);
      }
    } catch (error) {
      console.error('Error getting audio devices:', error);
    }
  };

  // Get audio devices when component mounts
  useEffect(() => {
    getAudioDevices();
  }, []);

  // Setup noise filter audio processing chain
  const setupNoiseFilterChain = (stream: MediaStream): MediaStream => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    try {
      debugLog('[NoiseFilter] Setting up noise filter chain');
      const audioContext = audioContextRef.current;

      // Clean up existing filter chain
      cleanupNoiseFilterChain();

      // Create source node from input stream
      sourceNodeRef.current = audioContext.createMediaStreamSource(stream);

      // Create filter nodes
      highPassFilterRef.current = audioContext.createBiquadFilter();
      lowPassFilterRef.current = audioContext.createBiquadFilter();
      compressorRef.current = audioContext.createDynamicsCompressor();
      gainNodeRef.current = audioContext.createGain();
      destinationRef.current = audioContext.createMediaStreamDestination();

      // Configure high-pass filter (remove low-frequency noise)
      highPassFilterRef.current.type = 'highpass';
      highPassFilterRef.current.frequency.setValueAtTime(noiseFilterSettings.highPassFrequency, audioContext.currentTime);
      highPassFilterRef.current.Q.setValueAtTime(0.7, audioContext.currentTime);

      // Configure low-pass filter (remove high-frequency noise)
      lowPassFilterRef.current.type = 'lowpass';
      lowPassFilterRef.current.frequency.setValueAtTime(noiseFilterSettings.lowPassFrequency, audioContext.currentTime);
      lowPassFilterRef.current.Q.setValueAtTime(0.7, audioContext.currentTime);

      // Configure dynamics compressor (normalize audio levels)
      compressorRef.current.threshold.setValueAtTime(-24, audioContext.currentTime);
      compressorRef.current.knee.setValueAtTime(30, audioContext.currentTime);
      compressorRef.current.ratio.setValueAtTime(noiseFilterSettings.compressionRatio, audioContext.currentTime);
      compressorRef.current.attack.setValueAtTime(0.003, audioContext.currentTime);
      compressorRef.current.release.setValueAtTime(0.25, audioContext.currentTime);

      // Configure gain node (final volume adjustment)
      const gainValue = Math.pow(10, noiseFilterSettings.gainReduction / 20); // Convert dB to linear
      gainNodeRef.current.gain.setValueAtTime(gainValue, audioContext.currentTime);

      if (noiseFilterSettings.enabled) {
        // Connect the full filter chain when enabled
        sourceNodeRef.current
          .connect(highPassFilterRef.current)
          .connect(lowPassFilterRef.current)
          .connect(compressorRef.current)
          .connect(gainNodeRef.current)
          .connect(destinationRef.current);
        
        debugLog('[NoiseFilter] Noise filter chain enabled');
      } else {
        // Bypass filters when disabled - connect source directly to destination
        sourceNodeRef.current.connect(destinationRef.current);
        debugLog('[NoiseFilter] Noise filter chain bypassed');
      }

      // Get the filtered stream
      filteredStreamRef.current = destinationRef.current.stream;
      debugLog('[NoiseFilter] Noise filter chain setup complete');

      return filteredStreamRef.current;
    } catch (error) {
      debugError('Error setting up noise filter chain:', error);
      return stream; // Return original stream on error
    }
  };

  // Cleanup noise filter chain
  const cleanupNoiseFilterChain = () => {
    try {
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      if (highPassFilterRef.current) {
        highPassFilterRef.current.disconnect();
        highPassFilterRef.current = null;
      }
      if (lowPassFilterRef.current) {
        lowPassFilterRef.current.disconnect();
        lowPassFilterRef.current = null;
      }
      if (compressorRef.current) {
        compressorRef.current.disconnect();
        compressorRef.current = null;
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }
      if (destinationRef.current) {
        destinationRef.current.disconnect();
        destinationRef.current = null;
      }
      filteredStreamRef.current = null;
      debugLog('[NoiseFilter] Noise filter chain cleaned up');
    } catch (error) {
      debugError('Error cleaning up noise filter chain:', error);
    }
  };

  // Setup audio level detection for own microphone
  const setupAudioLevelDetection = (stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    try {
      // Use filtered stream for audio level detection if noise filter is enabled
      const streamToAnalyze = noiseFilterSettings.enabled && filteredStreamRef.current
        ? filteredStreamRef.current
        : stream;

      const source = audioContextRef.current.createMediaStreamSource(streamToAnalyze);
      audioAnalyzerRef.current = audioContextRef.current.createAnalyser();
      audioAnalyzerRef.current.fftSize = 256;
      audioAnalyzerRef.current.smoothingTimeConstant = 0.3;
      
      source.connect(audioAnalyzerRef.current);
      
      const bufferLength = audioAnalyzerRef.current.frequencyBinCount;
      audioDataRef.current = new Uint8Array(bufferLength);
      
      // Start monitoring audio levels
      monitorAudioLevel();
    } catch (error) {
      console.error('Error setting up audio level detection:', error);
    }
  };

  // Monitor audio level and update speaking status
  const monitorAudioLevel = () => {
    if (!audioAnalyzerRef.current || !audioDataRef.current) return;
    
    const checkAudioLevel = () => {
      if (!audioAnalyzerRef.current || !audioDataRef.current || !localStreamRef.current) return;
      
      audioAnalyzerRef.current.getByteFrequencyData(audioDataRef.current as any);
      
      // Calculate average audio level
      const average = audioDataRef.current.reduce((acc, value) => acc + value, 0) / audioDataRef.current.length;
      
      // Check if audio track is enabled (not muted)
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      const isAudioEnabled = audioTrack ? audioTrack.enabled : false;
      const isSpeaking = average > 5 && isAudioEnabled; // Lower threshold for better sensitivity
      
      // Update own participant speaking status
      setParticipants(prev => prev.map(p =>
        p.clientId === clientIdRef.current
          ? { ...p, isSpeaking, audioLevel: average }
          : p
      ));
      
      // Send speaking status to other participants only when status changes
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const now = Date.now();
        const statusChanged = lastSpeakingStatusRef.current !== isSpeaking;
        const timeSinceLastUpdate = now - lastSpeakingUpdateRef.current;
        
        // Send if status changed or it's been more than 100ms since last update (ultra-responsive)
        if (statusChanged || (isSpeaking && timeSinceLastUpdate > 100)) {
          lastSpeakingStatusRef.current = isSpeaking;
          lastSpeakingUpdateRef.current = now;
          wsRef.current.send(JSON.stringify({
            type: 'speaking-status',
            isSpeaking,
            audioLevel: average,
            username: username
          }));
        }
      }
      
      requestAnimationFrame(checkAudioLevel);
    };
    
    checkAudioLevel();
  };

  // Initialize WebSocket connection
  const connectToSignaling = useCallback(() => {
    // Use environment variable or fallback to actual workers.dev domain
    const workerDomain = process.env.CLOUDFLARE_WORKER_DOMAIN || 'otak-conference-worker.systemexe-research-and-development.workers.dev';
    const wsUrl = `wss://${workerDomain}/ws?room=${roomId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    if (!wsRef.current) return; // Type guard

    ws.onopen = () => {
      debugLog('Connected to signaling server');
      console.log(`[PARTICIPANT] ${username} is joining the conference (Language: ${myLanguage})`);
      // Join the room
      ws.send(JSON.stringify({
        type: 'join',
        roomId: roomId,
        clientId: clientIdRef.current,
        username: username,
        language: myLanguage
      }));
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      debugLog('Received message:', message);

      switch (message.type) {
        case 'room-full':
          debugLog('Room is full:', message);
          setIsConnected(false);
          setIsInConference(false);
          setErrorMessage(`会議室が満室です。最大参加者数は${message.maxParticipants}名です。（現在${message.currentParticipants}名が参加中）`);
          setShowErrorModal(true);
          // Close any existing connections
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
            localStreamRef.current = null;
          }
          break;
        case 'user-joined':
          debugLog(`User joined: ${message.peerId}`);
          console.log(`[PARTICIPANT] ${message.username} has joined the conference (Language: ${message.language})`);
          if (message.peerId !== clientIdRef.current) {
            await createPeerConnection(message.peerId, true);
            setParticipants(prev => {
              const newParticipants = [...prev, { clientId: message.peerId, username: message.username, language: message.language }];
              // Update Gemini Live Audio target language when new participant joins
              updateGeminiTargetLanguage(newParticipants);
              return newParticipants;
            });
          }
          break;
        case 'user-left':
          debugLog(`User left: ${message.peerId}`);
          // Find the participant name before removing
          const leavingParticipant = participants.find(p => p.clientId === message.peerId);
          if (leavingParticipant) {
            console.log(`[PARTICIPANT] ${leavingParticipant.username} has left the conference`);
          }
          closePeerConnection(message.peerId);
          setParticipants(prev => {
            const newParticipants = prev.filter(p => p.clientId !== message.peerId);
            // Update Gemini Live Audio target language when participant leaves
            updateGeminiTargetLanguage(newParticipants);
            return newParticipants;
          });
          // Clear remote screen share if this user was sharing
          if (remoteScreenSharer === message.peerId) {
            setRemoteScreenSharer(null);
            if (screenPreviewRef.current && !isScreenSharing) {
              screenPreviewRef.current.srcObject = null;
            }
          }
          break;
        case 'offer':
          debugLog(`Received offer from ${message.peerId}`);
          await handleOffer(message.peerId, message.offer);
          break;
        case 'answer':
          debugLog(`Received answer from ${message.peerId}`);
          await handleAnswer(message.peerId, message.answer);
          break;
        case 'ice-candidate':
          debugLog(`Received ICE candidate from ${message.peerId}`);
          await handleIceCandidate(message.peerId, message.candidate);
          break;
        case 'participants':
          debugLog('Received participants list:', message.participants);
          // Set all participants (including self)
          setParticipants(message.participants);
          // Update Gemini Live Audio target language based on participants
          updateGeminiTargetLanguage(message.participants);
          // Create peer connections for other participants only
          const otherParticipants = message.participants.filter((p: Participant) => p.clientId !== clientIdRef.current);
          for (const participant of otherParticipants) {
            await createPeerConnection(participant.clientId, false);
          }
          break;
        case 'hand-raise':
          debugLog(`Hand raise from ${message.username}: ${message.raised}`);
          // Update participant's hand raise status
          setParticipants(prev => prev.map(p =>
            p.username === message.username
              ? { ...p, isHandRaised: message.raised }
              : p
          ));
          break;
        case 'reaction':
          debugLog(`Reaction from ${message.username}: ${message.reaction}`);
          // Update participant's reaction
          setParticipants(prev => prev.map(p =>
            p.username === message.username
              ? { ...p, reaction: message.reaction, reactionTimestamp: Date.now() }
              : p
          ));
          // Clear reaction after 3 seconds
          setTimeout(() => {
            setParticipants(prev => prev.map(p =>
              p.username === message.username
                ? { ...p, reaction: undefined, reactionTimestamp: undefined }
                : p
            ));
          }, 3000);
          break;
        case 'chat':
          debugLog(`Chat message from ${message.username}: ${message.message}`);
          // Only add chat message if it's not from self (avoid echo)
          if (message.username !== username) {
            setChatMessages(prev => [...prev, {
              id: Date.now(),
              from: message.username,
              message: message.message,
              timestamp: new Date().toLocaleTimeString(),
              readBy: showChat ? [username] : [] // Mark as read if chat is open
            }]);
            // Increment unread count if chat panel is closed
            if (!showChat) {
              setUnreadMessageCount(prev => prev + 1);
            }
          }
          break;
        case 'message-read':
          debugLog(`Message read by ${message.readBy}: ${message.messageId}`);
          // Update message read status
          setChatMessages(prev => prev.map(msg =>
            msg.id === message.messageId
              ? { ...msg, readBy: [...(msg.readBy || []), message.readBy] }
              : msg
          ));
          break;
        case 'speaking-status':
          // Update participant speaking status (removed verbose logging)
          setParticipants(prev => prev.map(p =>
            p.username === message.username
              ? { ...p, isSpeaking: message.isSpeaking, audioLevel: message.audioLevel }
              : p
          ));
          break;
        case 'translated-audio':
          debugLog(`[Conference] Received translated audio from ${message.from}`);
          debugLog(`[Conference] Audio data size: ${message.audioData?.length || 0} characters (Base64)`);
          debugLog(`[Conference] Audio format: ${message.audioFormat}`);
          debugLog(`[Conference] From language: ${message.fromLanguage}`);
          
          // Only play translated audio from other participants (not from self)
          if (message.from !== username) {
            try {
              debugLog(`🎵 [Audio Receive] Received audio from ${message.from}`);
              debugLog(`📊 [Audio Receive] Base64 data size: ${message.audioData?.length || 0} characters`);
              debugLog(`📝 [Audio Receive] Base64 preview: ${message.audioData?.substring(0, 100) || 'None'}...`);
              
              // Validate Base64 format before decoding
              if (!message.audioData || typeof message.audioData !== 'string') {
                throw new Error('Invalid audio data: not a string');
              }
              
              // Check if it's valid Base64 (basic check)
              const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
              if (!base64Regex.test(message.audioData)) {
                throw new Error('Invalid audio data: not valid Base64 format');
              }
              
              debugLog(`✅ [Audio Receive] Base64 validation passed`);
              
              // Convert Base64 back to ArrayBuffer (handle large data safely)
              debugLog(`🔄 [Audio Receive] Decoding Base64 to binary...`);
              const binaryString = atob(message.audioData);
              debugLog(`📊 [Audio Receive] Decoded binary length: ${binaryString.length} bytes`);
              
              const audioData = new ArrayBuffer(binaryString.length);
              const uint8Array = new Uint8Array(audioData);
              
              for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
              }
              
              debugLog(`🎵 [Audio Receive] ArrayBuffer created: ${audioData.byteLength} bytes`);
              debugLog(`[Conference] Playing translated audio from ${message.from} (${audioData.byteLength} bytes)`);
              debugLog(`[Conference] Selected speaker device: ${selectedSpeaker || 'default'}`);

              debugLog(`🔊 [Audio Receive] Starting playback...`);
              await playAudioData(audioData, selectedSpeaker);
              debugLog(`✅ [Audio Receive] Successfully played translated audio from ${message.from}`);
              debugLog(`[Conference] Successfully played translated audio from ${message.from}`);
            } catch (error) {
              console.error('❌ [Audio Receive] Failed to play translated audio:', error);
              console.error('[Conference] Failed to play translated audio:', error);
              console.error('[Conference] Error details:', {
                errorMessage: error instanceof Error ? error.message : String(error),
                audioDataSize: message.audioData?.length || 0,
                audioDataType: typeof message.audioData,
                audioDataPreview: message.audioData?.substring(0, 100) || 'None',
                selectedSpeaker: selectedSpeaker || 'default',
                from: message.from
              });
            }
          } else {
            debugLog(`[Conference] Skipping translated audio from self (${message.from})`);
          }
          break;
        case 'translation':
          debugLog(`[Conference] Received translation from ${message.translation.from}`);
          // Add received translation to display (only from other participants)
          if (message.translation.from !== username) {
            setTranslations(prev => {
              const updated = [...prev, message.translation];
              debugLog('📥 [HOOKS] Received translation from participant:', message.translation);
              debugLog('📊 [HOOKS] Updated translations array length:', updated.length);
              return updated;
            });
          }
          break;
      }
    };

    ws.onclose = () => {
      debugLog('Disconnected from signaling server');
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [roomId, username, myLanguage]);

  // Create a new peer connection
  const createPeerConnection = async (peerId: string, isInitiator: boolean) => {
    const pc = new RTCPeerConnection(iceServers);
    peerConnectionsRef.current[peerId] = pc;

    // Add local stream to peer connection
    if (localStreamRef.current) {
      debugLog('Adding local stream tracks to peer connection for', peerId);
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
        if (localStreamRef.current) {
          // Only add audio track if sendRawAudio is enabled
          if (track.kind === 'audio' && !sendRawAudio) {
            debugLog(`Skipping audio track for peer ${peerId} (raw audio transmission disabled)`);
            return;
          }
          
          debugLog(`Adding ${track.kind} track (enabled: ${track.enabled}) to peer ${peerId}`);
          const sender = pc.addTrack(track, localStreamRef.current);
          debugLog('Track added successfully, sender:', sender);
        }
      });
    } else {
      console.warn('No local stream available when creating peer connection for', peerId);
    }

    // Handle remote stream
    pc.ontrack = async (event) => {
      debugLog('Received remote stream from', peerId);
      const [remoteStream] = event.streams;
      const track = event.track;
      debugLog(`Received ${track.kind} track from ${peerId}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
      
      // Check if this is a video track (screen share)
      if (track.kind === 'video') {
        debugLog('Received video track (screen share) from', peerId);
        // Display remote screen share
        if (screenPreviewRef.current) {
          screenPreviewRef.current.srcObject = remoteStream;
          screenPreviewRef.current.play().catch(e => console.error('Error playing remote screen share:', e));
          setRemoteScreenSharer(peerId); // Track who is sharing
        }
      } else if (track.kind === 'audio') {
        debugLog('Processing audio stream from', peerId);
        // Create audio element to play remote audio
        const audioElement = new Audio();
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        
        // Set audio output device if supported and selected
        if ('setSinkId' in audioElement && selectedSpeaker) {
          try {
            await (audioElement as any).setSinkId(selectedSpeaker);
            debugLog(`[Audio] Set output device for remote audio: ${selectedSpeaker}`);
          } catch (error) {
            console.warn('[Audio] Could not set output device for remote audio:', error);
          }
        }
        
        audioElement.play().catch(e => console.error('Error playing remote audio:', e));
        
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          peerId: peerId,
          candidate: event.candidate
        }));
      }
    };

    // Create offer if initiator
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          peerId: peerId,
          offer: offer
        }));
      }
    }

    return pc;
  };

  // Close peer connection
  const closePeerConnection = (peerId: string) => {
    if (peerConnectionsRef.current[peerId]) {
      peerConnectionsRef.current[peerId].close();
      delete peerConnectionsRef.current[peerId];
    }
  };

  // Handle incoming offer
  const handleOffer = async (peerId: string, offer: RTCSessionDescriptionInit) => {
    let pc = peerConnectionsRef.current[peerId];
    if (!pc) {
      pc = await createPeerConnection(peerId, false);
    }

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'answer',
        peerId: peerId,
        answer: answer
      }));
    }
  };

  // Handle incoming answer
  const handleAnswer = async (peerId: string, answer: RTCSessionDescriptionInit) => {
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      await pc.setRemoteDescription(answer);
    }
  };

  // Handle incoming ICE candidate
  const handleIceCandidate = async (peerId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      await pc.addIceCandidate(candidate);
    }
  };


  // Clean up audio recorders when peer disconnects
  const cleanupPeerAudioRecorder = (peerId: string) => {
    const recorder = audioRecordersRef.current.get(peerId);
    if (recorder) {
      recorder.stopRecording();
      audioRecordersRef.current.delete(peerId);
    }
  };

  // Convert ArrayBuffer to base64
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // Convert Float32Array to ArrayBuffer
  const float32ArrayToArrayBuffer = (float32Array: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(float32Array.length * 4);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      view.setFloat32(i * 4, float32Array[i], true);
    }

    return buffer;
  };

  // Start conference
  const startConference = async () => {
    if (!apiKey) {
      alert('Please enter your Gemini API key.');
      return;
    }
    if (!username) {
      alert('Please enter your username.');
      return;
    }
    
    try {
      // Get user media with selected microphone
      const audioConstraints = selectedMicrophone
        ? { deviceId: { exact: selectedMicrophone } }
        : true;
        
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });
      
      // Apply noise filter if enabled
      const processedStream = setupNoiseFilterChain(rawStream);
      localStreamRef.current = processedStream;
      
      // Mute microphone initially
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
      }
      
      // Setup audio level detection after stream is ready
      setupAudioLevelDetection(rawStream); // Use raw stream for level detection to maintain accuracy
      
      // Add self to participants list immediately
      setParticipants([{
        clientId: clientIdRef.current,
        username: username,
        language: myLanguage,
        isSpeaking: false,
        isHandRaised: false
      }]);
      
      // Connect to signaling server (participants list will be set when we receive the 'participants' message)
      connectToSignaling();
      
      setIsConnected(true);
      setIsInConference(true);
      setShowSettings(false);
      
      // Gemini Live Audio Stream will be started only when participants join
      debugLog('[Conference] Gemini Live Audio will be started when participants join (no assistant mode)');
      
      // Update URL to reflect room ID
      window.history.pushState({}, '', `?roomId=${roomId}`);
    } catch (error) {
      console.error('Failed to start conference:', error);
      alert('Failed to access microphone. Please check permissions.');
    }
  };

  // End conference
  const endConference = () => {
    // Close all peer connections
    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      closePeerConnection(peerId);
    });
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null; // Reset ref
    }
    
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      localStreamRef.current = null;
    }
    
    // Stop screen sharing
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      screenStreamRef.current = null;
    }
    
    // Stop Gemini Live Audio Stream
    if (liveAudioStreamRef.current) {
      debugLog('[Conference] Stopping Gemini Live Audio stream...');
      liveAudioStreamRef.current.stop();
      liveAudioStreamRef.current = null;
      debugLog('[Conference] Gemini Live Audio stream stopped');
    }
    
    // Cleanup noise filter chain
    cleanupNoiseFilterChain();
    
    setIsConnected(false);
    setIsInConference(false);
    setIsScreenSharing(false);
    setIsMuted(true); // Reset to muted state
    setTranslations([]);
    setParticipants([]);
  };

  // Share room URL
  const shareRoomUrl = async () => {
    const roomUrl = `${window.location.href.split('?')[0]}?roomId=${roomId}`;
    try {
      await navigator.clipboard.writeText(roomUrl);
      setShowCopyModal(true);
      // Hide modal after 2 seconds
      setTimeout(() => setShowCopyModal(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
      // Fallback: show modal anyway
      setShowCopyModal(true);
      setTimeout(() => setShowCopyModal(false), 2000);
    }
  };

  // Toggle mute
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        screenStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          },
          audio: false // Changed to false to avoid audio issues
        });
        
        debugLog('Screen share stream obtained:', screenStreamRef.current);
        debugLog('Video tracks:', screenStreamRef.current.getVideoTracks());
        debugLog('Stream active:', screenStreamRef.current.active);
        
        // Verify video track is active
        const videoTrack = screenStreamRef.current.getVideoTracks()[0];
        if (!videoTrack) {
          throw new Error('No video track found in screen share stream');
        }
        debugLog('Video track enabled:', videoTrack.enabled);
        debugLog('Video track readyState:', videoTrack.readyState);
        
        // Add screen share tracks to all peer connections
        Object.values(peerConnectionsRef.current).forEach(pc => {
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => {
              debugLog(`Adding ${track.kind} track to peer connection`);
              try {
                pc.addTrack(track, screenStreamRef.current!);
                debugLog('Track added successfully');
              } catch (error) {
                console.error('Error adding track:', error);
              }
            });
          }
        });
        
        // Display screen share preview - wait for next tick
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (screenPreviewRef.current && screenStreamRef.current) {
          debugLog('Setting up screen preview');
          
          // Clear any existing srcObject
          screenPreviewRef.current.srcObject = null;
          
          // Set video element properties before setting srcObject
          screenPreviewRef.current.muted = true;
          screenPreviewRef.current.playsInline = true;
          screenPreviewRef.current.autoplay = true;
          
          // Add event listeners before setting srcObject
          screenPreviewRef.current.onloadedmetadata = () => {
            debugLog('Video metadata loaded, dimensions:',
              screenPreviewRef.current?.videoWidth, 'x', screenPreviewRef.current?.videoHeight);
            // Force a re-render by toggling display
            if (screenPreviewRef.current) {
              screenPreviewRef.current.style.display = 'none';
              setTimeout(() => {
                if (screenPreviewRef.current) {
                  screenPreviewRef.current.style.display = 'block';
                }
              }, 10);
            }
          };
          
          screenPreviewRef.current.oncanplay = () => {
            debugLog('Video can play');
          };
          
          screenPreviewRef.current.onplaying = () => {
            debugLog('Video is playing');
          };
          
          screenPreviewRef.current.onerror = (error) => {
            console.error('Video element error:', error);
          };
          
          // Set srcObject
          screenPreviewRef.current.srcObject = screenStreamRef.current;
          
          // Force play after a small delay
          setTimeout(async () => {
            if (screenPreviewRef.current) {
              try {
                await screenPreviewRef.current.play();
                debugLog('Video playing successfully');
              } catch (playError) {
                console.error('Error playing video:', playError);
                // Try again with user interaction
                screenPreviewRef.current.muted = true;
                screenPreviewRef.current.play().catch(e => console.error('Second play attempt failed:', e));
              }
            }
          }, 100);
        }
        
        setIsScreenSharing(true);
        
        // Handle screen share ending
        videoTrack.onended = () => {
          debugLog('Screen share ended by user');
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
              track.stop();
            });
            screenStreamRef.current = null;
          }
          if (screenPreviewRef.current && !remoteScreenSharer) {
            screenPreviewRef.current.srcObject = null;
          }
          setIsScreenSharing(false);
        };
      } catch (error) {
        console.error('Error starting screen share:', error);
        alert('Failed to start screen sharing. Please check permissions.');
        setIsScreenSharing(false);
      }
    } else {
      // Stop screen sharing
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
          track.stop();
          debugLog('Stopped track:', track.kind);
        });
        screenStreamRef.current = null;
      }
      if (screenPreviewRef.current && !remoteScreenSharer) {
        screenPreviewRef.current.srcObject = null;
      }
      setIsScreenSharing(false);
      debugLog('Screen sharing stopped');
    }
  };

  // Toggle camera
  const toggleCamera = async () => {
    if (!isCameraOn) {
      try {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = cameraStreamRef.current;
          videoRef.current.play();
        }
        
        setIsCameraOn(true);
        
        // Apply effects if enabled
        if (isBackgroundBlur || isBeautyMode || brightness !== 100) {
          applyVideoEffects();
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        alert('Failed to access camera. Please check permissions.');
      }
    } else {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        cameraStreamRef.current = null;
      }
      setIsCameraOn(false);
    }
  };

  // Apply video effects (background blur, beauty mode, brightness)
  const applyVideoEffects = () => {
    if (!cameraStreamRef.current || !videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const applyEffects = () => {
      ctx.filter = `brightness(${brightness}%)`;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Basic blur effect (simplified)
      if (isBackgroundBlur) {
        ctx.filter += ' blur(2px)';
      }
      
      // Beauty mode (simplified smoothing)
      if (isBeautyMode) {
        ctx.filter += ' contrast(1.1) saturate(1.1)';
      }
      
      requestAnimationFrame(applyEffects);
    };
    
    applyEffects();
  };

  // Toggle hand raise
  const toggleHandRaise = () => {
    const newHandRaised = !isHandRaised;
    setIsHandRaised(newHandRaised);
    
    // Update own participant status
    setParticipants(prev => prev.map(p =>
      p.clientId === clientIdRef.current
        ? { ...p, isHandRaised: newHandRaised }
        : p
    ));
    
    // Send hand raise status to other participants
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'hand-raise',
        raised: newHandRaised,
        username: username
      }));
    }
  };

  // Send reaction
  const sendReaction = (reaction: string) => {
    // Update own participant status
    setParticipants(prev => prev.map(p =>
      p.clientId === clientIdRef.current
        ? { ...p, reaction: reaction, reactionTimestamp: Date.now() }
        : p
    ));
    
    // Clear own reaction after 3 seconds
    setTimeout(() => {
      setParticipants(prev => prev.map(p =>
        p.clientId === clientIdRef.current
          ? { ...p, reaction: undefined, reactionTimestamp: undefined }
          : p
      ));
    }, 3000);
    
    // Send reaction to other participants
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'reaction',
        reaction: reaction,
        username: username
      }));
    }
    // Hide reactions popup after sending
    setShowReactions(false);
    
    debugLog(`Sent reaction: ${reaction}`);
  };

  // Send chat message
  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    
    const message = chatInput.trim();
    
    // Add own message to chat
    setChatMessages(prev => [...prev, {
      id: Date.now(),
      from: username,
      message: message,
      timestamp: new Date().toLocaleTimeString(),
      readBy: [username] // Self-sent messages are automatically read
    }]);
    
    // Send message to other participants
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        message: message,
        username: username
      }));
    }
    
    // Clear input
    setChatInput('');
  };

  // Toggle chat with unread count reset
  const toggleChat = (value: boolean) => {
    setShowChat(value);
    // Reset unread count and mark messages as read when opening chat
    if (value) {
      setUnreadMessageCount(0);
      // Mark all unread messages as read
      setChatMessages(prev => prev.map(msg => {
        if (!msg.readBy?.includes(username)) {
          const updatedMsg = {
            ...msg,
            readBy: [...(msg.readBy || []), username]
          };
          // Send read notification to other participants
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && msg.from !== username) {
            wsRef.current.send(JSON.stringify({
              type: 'message-read',
              messageId: msg.id,
              readBy: username
            }));
          }
          return updatedMsg;
        }
        return msg;
      }));
    }
  };

  // Change microphone device
  const changeMicrophone = async (deviceId: string) => {
    setSelectedMicrophone(deviceId);
    localStorage.setItem('selectedMicrophone', deviceId);
    
    // If conference is active, restart audio stream with new device
    if (isInConference && localStreamRef.current) {
      try {
        // Stop current audio track
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.stop();
        }
        
        // Get new audio stream with selected device
        const rawNewAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } }
        });
        
        // Apply noise filter to new stream
        const processedNewAudioStream = setupNoiseFilterChain(rawNewAudioStream);
        
        // Replace audio track in local stream
        const newAudioTrack = processedNewAudioStream.getAudioTracks()[0];
        if (newAudioTrack) {
          // Set mute state to match current state
          newAudioTrack.enabled = !isMuted;
          
          // Replace track in peer connections
          Object.values(peerConnectionsRef.current).forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) {
              sender.replaceTrack(newAudioTrack);
            }
          });
          
          // Update local stream
          localStreamRef.current.removeTrack(audioTrack);
          localStreamRef.current.addTrack(newAudioTrack);
          
          // Update audio level detection with new stream
          setupAudioLevelDetection(rawNewAudioStream);
        }
      } catch (error) {
        console.error('Error changing microphone:', error);
        alert('Failed to change microphone. Please check permissions.');
      }
    }
  };

  // Update noise filter settings
  const updateNoiseFilterSettings = (newSettings: Partial<NoiseFilterSettings>) => {
    const updatedSettings = { ...noiseFilterSettings, ...newSettings };
    setNoiseFilterSettings(updatedSettings);
    
    // If conference is active and we have a local stream, update the filter chain
    if (isInConference && localStreamRef.current) {
      try {
        debugLog('[NoiseFilter] Updating filter settings during conference');
        
        // Get the original raw stream (we need to store this separately)
        // For now, we'll restart the microphone stream with new settings
        changeMicrophone(selectedMicrophone || '');
      } catch (error) {
        debugError('Error updating noise filter settings:', error);
      }
    }
  };

  // Toggle noise filter on/off
  const toggleNoiseFilter = () => {
    updateNoiseFilterSettings({ enabled: !noiseFilterSettings.enabled });
  };

  // Change speaker device
  const changeSpeaker = async (deviceId: string) => {
    setSelectedSpeaker(deviceId);
    localStorage.setItem('selectedSpeaker', deviceId);
    
    debugLog(`[Audio] Changing speaker to device: ${deviceId}`);
    
    try {
      // Apply to all existing audio elements
      const audioElements = document.querySelectorAll('audio');
      debugLog(`[Audio] Found ${audioElements.length} existing audio elements`);
      
      for (const audio of audioElements) {
        if ('setSinkId' in audio) {
          try {
            await (audio as any).setSinkId(deviceId);
            debugLog('[Audio] Successfully set output device for existing audio element');
          } catch (error) {
            console.warn('[Audio] Could not set output device for existing audio element:', error);
          }
        }
      }
      
      // Apply to audio context destination if available
      if (audioContextRef.current && 'setSinkId' in audioContextRef.current.destination) {
        try {
          await (audioContextRef.current.destination as any).setSinkId(deviceId);
          debugLog('[Audio] Successfully set output device for audio context');
        } catch (error) {
          console.warn('[Audio] Could not set output device for audio context:', error);
        }
      }
      
      debugLog(`[Audio] Speaker device change completed for device: ${deviceId}`);
    } catch (error) {
      console.warn('[Audio] Speaker change not fully supported:', error);
    }
  };

  // Toggle raw audio transmission
  const toggleSendRawAudio = async () => {
    const newValue = !sendRawAudio;
    setSendRawAudio(newValue);
    localStorage.setItem('sendRawAudio', newValue.toString());
    
    debugLog(`[Conference] Raw audio transmission ${newValue ? 'enabled' : 'disabled'}`);
    
    // If conference is active, update peer connections
    if (isInConference && localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        // Update all peer connections
        for (const [peerId, pc] of Object.entries(peerConnectionsRef.current)) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
          
          try {
            if (newValue && !sender) {
              // Add audio track if enabling raw audio and track doesn't exist
              pc.addTrack(audioTrack, localStreamRef.current!);
              debugLog(`[Conference] Added audio track to peer connection ${peerId}`);
              
              // Create new offer and send it
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'offer',
                  peerId: peerId,
                  offer: offer
                }));
              }
            } else if (!newValue && sender) {
              // Remove audio track if disabling raw audio
              pc.removeTrack(sender);
              debugLog(`[Conference] Removed audio track from peer connection ${peerId}`);
              
              // Create new offer and send it
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'offer',
                  peerId: peerId,
                  offer: offer
                }));
              }
            }
          } catch (error) {
            console.error(`[Conference] Error updating audio track for peer ${peerId}:`, error);
          }
        }
      }
    }
  };

  // Toggle local playback of Gemini responses
  const toggleLocalPlayback = () => {
    const newValue = !isLocalPlaybackEnabled;
    setIsLocalPlaybackEnabled(newValue);
    isLocalPlaybackEnabledRef.current = newValue;
    localStorage.setItem('isLocalPlaybackEnabled', newValue.toString());
    
    debugLog(`[Conference] Local playback of Gemini responses ${newValue ? 'enabled' : 'disabled'}`);
    
    // Update existing live audio stream if active
    if (liveAudioStreamRef.current) {
      liveAudioStreamRef.current.setLocalPlaybackEnabled(newValue);
    }
  };

  // Check if running in local development environment
  const isLocalDevelopment = () => {
    const hostname = window.location.hostname;
    return hostname === 'localhost' ||
           hostname === '127.0.0.1' ||
           hostname.includes('trycloudflare.com') ||
           hostname.includes('ngrok.io') ||
           process.env.NODE_ENV === 'development';
  };

  // Start solo Gemini session for local development
  const startSoloGeminiSession = async (sourceLanguage: string, targetLanguage: string) => {
    try {
      if (!apiKey || !localStreamRef.current) {
        console.warn('[Conference] Cannot start solo Gemini session - missing API key or local stream');
        return;
      }

      debugLog(`[Conference] Creating solo Gemini Live Audio session: ${sourceLanguage} → ${targetLanguage}`);

      const { GeminiLiveAudioStream } = await import('./gemini-live-audio');

      liveAudioStreamRef.current = new GeminiLiveAudioStream({
        apiKey,
        sourceLanguage,
        targetLanguage,
        localPlaybackEnabled: isLocalPlaybackEnabledRef.current,
        
        // Solo mode configuration
        otherParticipantLanguages: [],
        usePeerTranslation: false,
        
        onAudioReceived: async (audioData) => {
          try {
            debugLog('[Conference] Solo mode - Received translated audio from Gemini');
            
            // In solo mode, audio is already played locally by GeminiLiveAudioStream
            // No need to send to other participants
          } catch (error) {
            debugError('[Conference] Solo mode - Error handling audio:', error);
          }
        },
        onTextReceived: (text) => {
          try {
            debugLog('🎯 [Solo Mode] Received translated text:', text);
            debugLog('[Conference] Solo mode - Translated text received:', text);
            
            // Add translation to display
            const newTranslation: Translation = {
              id: Date.now(),
              from: 'Gemini AI',
              fromLanguage: targetLanguage,
              original: text,
              translation: text,
              timestamp: new Date().toLocaleTimeString()
            };
            
            setTranslations(prev => [...prev, newTranslation]);
          } catch (error) {
            debugError('[Conference] Solo mode - Error handling text:', error);
          }
        }
      });
      
      // Set up API usage tracking and Gemini speaking state manually
      if (liveAudioStreamRef.current) {
        // These will be handled by the existing callbacks in the actual implementation
        debugLog('[Conference] Solo session callbacks configured');
      }

      await liveAudioStreamRef.current.start(localStreamRef.current);
      debugLog('[Conference] Solo Gemini Live Audio session started successfully');
    } catch (error) {
      console.error('[Conference] Failed to start solo Gemini session:', error);
      liveAudioStreamRef.current = null;
    }
  };

  // Start or stop Gemini Live Audio based on participants (no assistant mode)
  const updateGeminiTargetLanguage = async (currentParticipants: Participant[]) => {
    // Get languages of other participants (excluding self)
    const otherParticipants = currentParticipants.filter(p => p.clientId !== clientIdRef.current);
    
    // In local development, allow solo sessions with Gemini
    if (otherParticipants.length === 0) {
      if (isLocalDevelopment()) {
        debugLog('[Conference] Local development mode: Starting solo session with Gemini');
        
        // Use default target language for solo session (opposite of user's language)
        const sourceLanguage = GEMINI_LANGUAGE_MAP[myLanguage] || 'English';
        const targetLanguage = myLanguage === 'english' ? 'Japanese' : 'English';
        
        infoLog(`🎯 [Solo Session] Local Development Mode`);
        infoLog(`📱 My Language: ${myLanguage} → ${sourceLanguage}`);
        infoLog(`🤖 Gemini Target: ${targetLanguage} (solo mode)`);
        infoLog(`🔄 Translation Direction: ${sourceLanguage} → ${targetLanguage}`);
        
        // Start solo session
        await startSoloGeminiSession(sourceLanguage, targetLanguage);
        return;
      } else {
        debugLog('[Conference] No other participants, stopping Gemini Live Audio session');
        
        // Stop existing session if any
        if (liveAudioStreamRef.current) {
          debugLog('[Conference] Stopping Gemini Live Audio stream (no participants)');
          await liveAudioStreamRef.current.stop();
          liveAudioStreamRef.current = null;
        }
        return;
      }
    }

    // Use the first other participant's language as primary target
    const primaryTarget = otherParticipants[0].language;
    const targetLanguage = GEMINI_LANGUAGE_MAP[primaryTarget] || 'English';
    const sourceLanguage = GEMINI_LANGUAGE_MAP[myLanguage] || 'English';

    // Important session startup information (always shown)
    infoLog(`🎯 [Translation Setup] Session Started`);
    infoLog(`📱 My Language: ${myLanguage} → ${sourceLanguage}`);
    infoLog(`👥 Participant Language: ${primaryTarget} → ${targetLanguage}`);
    infoLog(`🔄 Translation Direction: ${sourceLanguage} → ${targetLanguage}`);
    
    debugLog(`[Conference] Language mapping debug:`);
    debugLog(`[Conference] - My language: ${myLanguage} → ${sourceLanguage}`);
    debugLog(`[Conference] - Participant language: ${primaryTarget} → ${targetLanguage}`);

    // Check if session needs to be created or updated
    if (!liveAudioStreamRef.current) {
      // Create new session when participants join
      debugLog(`[Conference] Creating new Gemini Live Audio session: ${sourceLanguage} → ${targetLanguage}`);
      
      if (!apiKey || !localStreamRef.current) {
        console.warn('[Conference] Cannot start Gemini Live Audio - missing API key or local stream');
        return;
      }

      try {
        // Increment session count when starting a new Gemini session
        setApiUsageStats(prev => ({
          ...prev,
          sessionCount: (prev.sessionCount || 0) + 1
        }));
        
        // Extract other participants' languages for peer translation
        const otherLanguages = otherParticipants.map(p => GEMINI_LANGUAGE_MAP[p.language] || 'english');
        
        liveAudioStreamRef.current = new GeminiLiveAudioStream({
          apiKey,
          sourceLanguage,
          targetLanguage,
          localPlaybackEnabled: isLocalPlaybackEnabledRef.current,
          
          // Speed optimization settings
          sendInterval: translationSpeedSettings.sendInterval,
          textBufferDelay: translationSpeedSettings.textBufferDelay,
          
          // Peer-to-peer translation configuration
          otherParticipantLanguages: otherLanguages,
          usePeerTranslation: true,
          
          onAudioReceived: async (audioData) => {
            debugLog('[Conference] Received translated audio (handled by GeminiLiveAudioStream internally)');
            
            // Always send the translated audio to other participants
            await sendTranslatedAudioToParticipants(audioData);
          },
          onTextReceived: (text) => {
            debugLog('🎯 [HOOKS] onTextReceived called with text:', text);
            debugLog('[Conference] Translated text received:', text);
            
            // Add received text to translations display (original logic preserved)
            const newTranslation: Translation = {
              id: Date.now(),
              from: username, // Use actual username instead of 'Gemini AI'
              fromLanguage: myLanguage,
              original: text, // Show the received text as original
              translation: text, // And also as translation  
              timestamp: new Date().toLocaleTimeString()
            };
            
            debugLog('📋 [HOOKS] Adding translation to state:', newTranslation);
            setTranslations(prev => {
              const updated = [...prev, newTranslation];
              debugLog('📊 [HOOKS] Updated translations array length:', updated.length);
              return updated;
            });
            debugLog('✅ [HOOKS] Translation added to state');
            
            // Send translation to other participants via WebSocket (original logic preserved)
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const translationMessage = {
                type: 'translation',
                translation: newTranslation
              };
              debugLog('📤 [HOOKS] Sending translation to participants:', translationMessage);
              wsRef.current.send(JSON.stringify(translationMessage));
            }
            
            // SEPARATE PROCESS: Re-translate back to speaker's language for confirmation
            // This runs independently and doesn't affect the main translation flow
            (async () => {
              try {
                const retranslationService = getTextRetranslationService(apiKey);
                
                // Determine target language (language the text was translated TO)
                const targetLanguage = otherParticipants.length > 0 
                  ? otherParticipants[0].language 
                  : 'english';
                
                // Re-translate from target language back to speaker's language
                const result = await retranslationService.retranslateToSpeakerLanguage(
                  text, // The translated text we received
                  targetLanguage, // Current language of the text
                  myLanguage // Speaker's original language
                );
                
                if (result.success) {
                  debugLog('🔄 [Text Retranslation] Success:', result.retranslatedText);
                  
                  // Update the translation with the re-translated text
                  setTranslations(prev => 
                    prev.map(t => 
                      t.id === newTranslation.id 
                        ? { ...t, originalLanguageText: result.retranslatedText }
                        : t
                    )
                  );
                } else {
                  debugWarn('⚠️ [Text Retranslation] Failed:', result.error);
                }
              } catch (error) {
                debugError('❌ [Text Retranslation] Error:', error);
              }
            })();
          },
          onTokenUsage: (usage) => {
            debugLog('💰 [Token Usage] Update received:', {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cost: usage.cost
            });
            debugLog('[Conference] Token usage update:', usage);
            setApiUsageStats(prev => {
              const prevTotalUsage = prev.totalUsage || {
                inputTokens: { text: 0, audio: 0 },
                outputTokens: { text: 0, audio: 0 },
                totalCost: 0
              };
              
              const prevSessionUsage = prev.sessionUsage || {
                inputTokens: { text: 0, audio: 0 },
                outputTokens: { text: 0, audio: 0 },
                totalCost: 0
              };
              
              // Update session usage (current session cumulative)
              const newSessionUsage: TokenUsage = {
                inputTokens: {
                  text: prevSessionUsage.inputTokens.text,
                  audio: usage.inputTokens // Gemini reports cumulative session total
                },
                outputTokens: {
                  text: prevSessionUsage.outputTokens.text,
                  audio: usage.outputTokens // Gemini reports cumulative session total
                },
                totalCost: usage.cost // Gemini reports cumulative session cost
              };
              
              // Update total usage (add session delta to previous total)
              const sessionDelta = {
                inputTokens: newSessionUsage.inputTokens.audio - prevSessionUsage.inputTokens.audio,
                outputTokens: newSessionUsage.outputTokens.audio - prevSessionUsage.outputTokens.audio,
                cost: newSessionUsage.totalCost - prevSessionUsage.totalCost
              };
              
              const newTotalUsage: TokenUsage = {
                inputTokens: {
                  text: prevTotalUsage.inputTokens.text,
                  audio: prevTotalUsage.inputTokens.audio + sessionDelta.inputTokens
                },
                outputTokens: {
                  text: prevTotalUsage.outputTokens.text,
                  audio: prevTotalUsage.outputTokens.audio + sessionDelta.outputTokens
                },
                totalCost: prevTotalUsage.totalCost + sessionDelta.cost
              };
              
              debugLog('💰 [Token Usage] Updated stats:', {
                sessionCost: newSessionUsage.totalCost,
                totalCost: newTotalUsage.totalCost,
                sessionDelta: sessionDelta
              });
              
              return {
                ...prev,
                sessionUsage: newSessionUsage,
                totalUsage: newTotalUsage
              };
            });
          },
          onError: (error) => {
            console.error('[Conference] Gemini Live Audio error:', error);
            setErrorMessage(error.message);
            setShowErrorModal(true);
          }
        });
        
        await liveAudioStreamRef.current.start(localStreamRef.current);
        debugLog('[Conference] Gemini Live Audio session started successfully');
      } catch (error) {
        console.error('[Conference] Failed to start Gemini Live Audio session:', error);
        liveAudioStreamRef.current = null;
      }
    } else {
      // Update existing session with new participant languages
      const otherLanguages = otherParticipants.map(p => GEMINI_LANGUAGE_MAP[p.language] || 'english');
      
      debugLog(`[Conference] Updating Gemini session with participant languages:`, otherLanguages);
      
      // Update the session with new peer languages
      if (liveAudioStreamRef.current.updateOtherParticipantLanguages) {
        liveAudioStreamRef.current.updateOtherParticipantLanguages(otherLanguages);
      } else {
        // Fallback: check target language change (legacy mode)
        const currentTargetLanguage = liveAudioStreamRef.current.getCurrentTargetLanguage();
        
        if (targetLanguage !== currentTargetLanguage) {
          debugLog(`[Conference] Updating Gemini target language: ${currentTargetLanguage} → ${targetLanguage}`);
          await liveAudioStreamRef.current.updateTargetLanguage(targetLanguage);
        } else {
          debugLog(`[Conference] Target language already set to ${targetLanguage}, no update needed`);
        }
      }
    }
  };

  // Send translated audio to other participants
  const sendTranslatedAudioToParticipants = async (audioData: ArrayBuffer) => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('[Conference] WebSocket not available, cannot send translated audio');
        return;
      }

      // Convert ArrayBuffer to Base64 for transmission (handle large data safely)
      debugLog(`📡 [Audio Send] Converting ${audioData.byteLength} bytes to Base64...`);
      
      // Use the existing arrayBufferToBase64 function which handles large data correctly
      const base64Audio = arrayBufferToBase64(audioData);
      
      debugLog(`📡 [Audio Send] Base64 conversion completed: ${base64Audio.length} characters`);
      debugLog(`📡 [Audio Send] Base64 preview: ${base64Audio.substring(0, 100)}...`);
      
      // Important: Audio is being sent (always show this)
      infoLog(`📤 [Audio Send] Sending translated audio (${audioData.byteLength} bytes)`);

      debugLog(`[Conference] Sending translated audio to participants (${audioData.byteLength} bytes)`);

      // Send translated audio via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'translated-audio',
        audioData: base64Audio,
        audioFormat: 'pcm-24khz-16bit',
        from: username,
        fromLanguage: myLanguage,
        timestamp: Date.now()
      }));

      debugLog('[Conference] Translated audio sent to participants');
    } catch (error) {
      console.error('[Conference] Failed to send translated audio:', error);
    }
  };

  // Generate audio for translation
  const generateTranslationAudio = useCallback(async (
    translatedText: string,
    targetLanguage: string,
    originalText: string,
    fromLanguage: string
  ) => {
    if (!isAudioTranslationEnabled) {
      return;
    }

    try {
      debugLog(`[Conference] Audio translation requested: "${translatedText}"`);
      // Audio translation is now handled by Gemini Live Audio directly
      // This function is kept for compatibility but doesn't generate separate audio
    } catch (error) {
      console.error('Audio generation error:', error);
    }
  }, [isAudioTranslationEnabled, voiceSettings, username]);

  // Toggle audio translation feature
  const toggleAudioTranslation = useCallback(() => {
    setIsAudioTranslationEnabled(prev => {
      const newValue = !prev;
      isAudioTranslationEnabledRef.current = newValue;
      return newValue;
    });
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    isAudioTranslationEnabledRef.current = isAudioTranslationEnabled;
  }, [isAudioTranslationEnabled]);

  // Update voice settings
  const updateVoiceSettings = useCallback((newSettings: Partial<VoiceSettings>) => {
    setVoiceSettings(prev => ({ ...prev, ...newSettings }));
  }, []);
  
  // Update translation speed mode
  const updateTranslationSpeedMode = useCallback((mode: TranslationSpeedMode) => {
    let settings: TranslationSpeedSettings;
    
    switch (mode) {
      case TranslationSpeedMode.ULTRAFAST:
        settings = {
          mode: TranslationSpeedMode.ULTRAFAST,
          sendInterval: 15,        // Ultra-low latency: 15ms
          textBufferDelay: 800,    // Keep text buffer for readability
          estimatedCostMultiplier: 15.0
        };
        break;
      case TranslationSpeedMode.REALTIME:
        settings = {
          mode: TranslationSpeedMode.REALTIME,
          sendInterval: 300,
          textBufferDelay: 500,
          estimatedCostMultiplier: 5.0
        };
        break;
      case TranslationSpeedMode.BALANCED:
        settings = {
          mode: TranslationSpeedMode.BALANCED,
          sendInterval: 800,
          textBufferDelay: 1000,
          estimatedCostMultiplier: 2.0
        };
        break;
      case TranslationSpeedMode.ECONOMY:
        settings = {
          mode: TranslationSpeedMode.ECONOMY,
          sendInterval: 1500,
          textBufferDelay: 2000,
          estimatedCostMultiplier: 1.0
        };
        break;
      default:
        settings = {
          mode: TranslationSpeedMode.ULTRAFAST,
          sendInterval: 15,        // Ultra-low latency by default
          textBufferDelay: 800,    // Keep text buffer for readability
          estimatedCostMultiplier: 15.0
        };
        break;
    }
    
    setTranslationSpeedMode(mode);
    setTranslationSpeedSettings(settings);
    
    // Update Gemini Live Audio settings if active
    if (liveAudioStreamRef.current) {
      liveAudioStreamRef.current.updateSpeedSettings(settings.sendInterval, settings.textBufferDelay);
    }
    
    // Save to localStorage
    localStorage.setItem('translationSpeedMode', mode);
    
    debugLog(`[Translation Speed] Updated to ${mode} mode - Send: ${settings.sendInterval}ms, Buffer: ${settings.textBufferDelay}ms`);
  }, []);

  // Clean up audio URLs when component unmounts
  useEffect(() => {
    return () => {
      audioTranslations.forEach(translation => {
        if (translation.audioUrl) {
          URL.revokeObjectURL(translation.audioUrl);
        }
      });
    };
  }, [audioTranslations]);

  // Calculate token usage cost
  const calculateTokenCost = (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }): number => {
    const INPUT_COST_TEXT = 0.50 / 1000000; // $0.50 per 1M tokens
    const INPUT_COST_AUDIO = 3.00 / 1000000; // $3.00 per 1M tokens
    const OUTPUT_COST_TEXT = 2.00 / 1000000; // $2.00 per 1M tokens
    const OUTPUT_COST_AUDIO = 12.00 / 1000000; // $12.00 per 1M tokens

    return (
      inputTokens.text * INPUT_COST_TEXT +
      inputTokens.audio * INPUT_COST_AUDIO +
      outputTokens.text * OUTPUT_COST_TEXT +
      outputTokens.audio * OUTPUT_COST_AUDIO
    );
  };

  // Update API usage stats
  const updateApiUsage = (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => {
    const cost = calculateTokenCost(inputTokens, outputTokens);
    
    setApiUsageStats(prev => {
      const newSessionUsage = {
        inputTokens: {
          text: prev.sessionUsage.inputTokens.text + inputTokens.text,
          audio: prev.sessionUsage.inputTokens.audio + inputTokens.audio
        },
        outputTokens: {
          text: prev.sessionUsage.outputTokens.text + outputTokens.text,
          audio: prev.sessionUsage.outputTokens.audio + outputTokens.audio
        },
        totalCost: prev.sessionUsage.totalCost + cost
      };

      const newTotalUsage = {
        inputTokens: {
          text: prev.totalUsage.inputTokens.text + inputTokens.text,
          audio: prev.totalUsage.inputTokens.audio + inputTokens.audio
        },
        outputTokens: {
          text: prev.totalUsage.outputTokens.text + outputTokens.text,
          audio: prev.totalUsage.outputTokens.audio + outputTokens.audio
        },
        totalCost: prev.totalUsage.totalCost + cost
      };

      // Save total usage to localStorage
      localStorage.setItem('geminiApiUsage', JSON.stringify(newTotalUsage));

      return {
        sessionUsage: newSessionUsage,
        totalUsage: newTotalUsage,
        sessionCount: prev.sessionCount
      };
    });
  };

  // Reset session usage
  const resetSessionUsage = () => {
    setApiUsageStats(prev => ({
      ...prev,
      sessionUsage: {
        inputTokens: { text: 0, audio: 0 },
        outputTokens: { text: 0, audio: 0 },
        totalCost: 0
      }
    }));
  };

  return {
    // State
    apiKey, setApiKey,
    username, setUsername,
    roomId, setRoomId,
    isConnected, setIsConnected,
    isInConference, setIsInConference,
    isMuted, setIsMuted,
    isScreenSharing, setIsScreenSharing,
    isCameraOn, setIsCameraOn,
    isBackgroundBlur, setIsBackgroundBlur,
    isBeautyMode, setIsBeautyMode,
    brightness, setBrightness,
    showCameraSettings, setShowCameraSettings,
    myLanguage, setMyLanguage,
    translations, setTranslations,
    participants, setParticipants,
    showSettings, setShowSettings,
    showRoomUrl, setShowRoomUrl,
    showCopyModal, setShowCopyModal,
    remoteScreenSharer, setRemoteScreenSharer,
    isHandRaised, setIsHandRaised,
    showChat, toggleChat,
    showReactions, setShowReactions,
    chatMessages, setChatMessages,
    chatInput, setChatInput,
    unreadMessageCount, setUnreadMessageCount,
    showAudioSettings, setShowAudioSettings,
    audioInputDevices,
    audioOutputDevices,
    selectedMicrophone,
    showErrorModal, setShowErrorModal,
    errorMessage,
    selectedSpeaker,
    sendRawAudio,
    isLocalPlaybackEnabled,
    
    // Refs
    videoRef,
    canvasRef,
    screenPreviewRef,
    
    // Functions
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
    getAudioDevices,
    changeMicrophone,
    changeSpeaker,
    toggleSendRawAudio,
    toggleLocalPlayback,
    
    // Noise filter
    noiseFilterSettings,
    updateNoiseFilterSettings,
    toggleNoiseFilter,
    
    // Audio translation
    audioTranslations,
    isAudioTranslationEnabled,
    voiceSettings,
    generateTranslationAudio,
    toggleAudioTranslation,
    updateVoiceSettings,

    // API usage tracking
    apiUsageStats,
    updateApiUsage,
    resetSessionUsage,
    
    // Gemini speaking state
    isGeminiSpeaking,
    
    // Translation speed settings
    translationSpeedMode,
    translationSpeedSettings,
    updateTranslationSpeedMode
  };
};