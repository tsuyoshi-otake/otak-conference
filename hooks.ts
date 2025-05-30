import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Participant, Translation, ChatMessage, AudioTranslation, VoiceSettings, ApiUsageStats, TokenUsage } from './types';
// Removed old gemini-utils imports - now using GeminiLiveAudioStream directly
import { GeminiLiveAudioStream, GEMINI_LANGUAGE_MAP, playAudioData } from './gemini-live-audio';
import { languagePromptManager } from './translation-prompts';

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
  const [myLanguage, setMyLanguage] = useState<string>('vietnamese');
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
  
  // Error modal state
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

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
    }
  });
  
  // Audio level detection
  const audioAnalyzerRef = useRef<AnalyserNode | null>(null);
  const audioDataRef = useRef<Uint8Array | null>(null);
  const lastSpeakingStatusRef = useRef<boolean>(false); // Track previous speaking status
  const lastSpeakingUpdateRef = useRef<number>(0); // Track last speaking status update time

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
  
  // ICE servers configuration
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Load settings from localStorage on mount
  useEffect(() => {
    const storedApiKey = localStorage.getItem('geminiApiKey');
    const storedUsername = localStorage.getItem('username');
    const storedLanguage = localStorage.getItem('myLanguage');
    const storedMicrophone = localStorage.getItem('selectedMicrophone');
    const storedSpeaker = localStorage.getItem('selectedSpeaker');
    const storedSendRawAudio = localStorage.getItem('sendRawAudio');
    const storedUsage = localStorage.getItem('geminiApiUsage');
    
    if (storedApiKey) {
      setApiKey(storedApiKey);
    }
    if (storedUsername) {
      setUsername(storedUsername);
    }
    if (storedLanguage) {
      setMyLanguage(storedLanguage);
    }
    if (storedUsage) {
      try {
        const parsedUsage = JSON.parse(storedUsage);
        setApiUsageStats(prev => ({
          ...prev,
          totalUsage: parsedUsage
        }));
      } catch (error) {
        console.error('Failed to parse stored API usage:', error);
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
    console.log('[otak-conference] Loading settings from localStorage...');
    const savedApiKey = localStorage.getItem('geminiApiKey');
    const savedUsername = localStorage.getItem('username');
    const savedLanguage = localStorage.getItem('myLanguage');
    
    console.log('[otak-conference] Saved API Key:', savedApiKey ? 'Found (hidden for security)' : 'Not found');
    console.log('[otak-conference] Saved Username:', savedUsername);
    console.log('[otak-conference] Saved Language:', savedLanguage);
    
    if (savedApiKey) setApiKey(savedApiKey);
    if (savedUsername) setUsername(savedUsername);
    if (savedLanguage) setMyLanguage(savedLanguage);
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    console.log('[otak-conference] Saving API Key to localStorage:', apiKey ? 'Key provided (hidden for security)' : 'Empty key');
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

  // Get available audio devices
  const getAudioDevices = async () => {
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        console.warn('MediaDevices API not available');
        return;
      }
      
      // Request media permissions first to get device labels
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Stop the stream immediately as we only needed it for permissions
        stream.getTracks().forEach(track => track.stop());
      } catch (permissionError) {
        console.warn('Media permission not granted, device labels may be limited:', permissionError);
      }
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!devices) {
        console.warn('No devices returned from enumerateDevices');
        return;
      }
      
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      const audioOutputs = devices.filter(device => device.kind === 'audiooutput');
      
      console.log('Available audio inputs:', audioInputs);
      console.log('Available audio outputs:', audioOutputs);
      
      setAudioInputDevices(audioInputs);
      setAudioOutputDevices(audioOutputs);
      
      // Validate and set microphone device
      if (selectedMicrophone) {
        // Check if the saved microphone still exists
        const micExists = audioInputs.some(device => device.deviceId === selectedMicrophone);
        if (!micExists && audioInputs.length > 0) {
          console.log('[AUDIO] Saved microphone not found, selecting default');
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
          console.log('[AUDIO] Saved speaker not found, selecting default');
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

  // Setup audio level detection for own microphone
  const setupAudioLevelDetection = (stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    
    try {
      const source = audioContextRef.current.createMediaStreamSource(stream);
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
        
        // Send if status changed or it's been more than 500ms since last update (throttle)
        if (statusChanged || (isSpeaking && timeSinceLastUpdate > 500)) {
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
      console.log('Connected to signaling server');
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
      console.log('Received message:', message);

      switch (message.type) {
        case 'user-joined':
          console.log(`User joined: ${message.peerId}`);
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
          console.log(`User left: ${message.peerId}`);
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
          console.log(`Received offer from ${message.peerId}`);
          await handleOffer(message.peerId, message.offer);
          break;
        case 'answer':
          console.log(`Received answer from ${message.peerId}`);
          await handleAnswer(message.peerId, message.answer);
          break;
        case 'ice-candidate':
          console.log(`Received ICE candidate from ${message.peerId}`);
          await handleIceCandidate(message.peerId, message.candidate);
          break;
        case 'participants':
          console.log('Received participants list:', message.participants);
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
          console.log(`Hand raise from ${message.username}: ${message.raised}`);
          // Update participant's hand raise status
          setParticipants(prev => prev.map(p =>
            p.username === message.username
              ? { ...p, isHandRaised: message.raised }
              : p
          ));
          break;
        case 'reaction':
          console.log(`Reaction from ${message.username}: ${message.reaction}`);
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
          console.log(`Chat message from ${message.username}: ${message.message}`);
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
          console.log(`Message read by ${message.readBy}: ${message.messageId}`);
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
          console.log(`[Conference] Received translated audio from ${message.from}`);
          console.log(`[Conference] Audio data size: ${message.audioData?.length || 0} characters (Base64)`);
          console.log(`[Conference] Audio format: ${message.audioFormat}`);
          console.log(`[Conference] From language: ${message.fromLanguage}`);
          
          // Only play translated audio from other participants (not from self)
          if (message.from !== username) {
            try {
              // Convert Base64 back to ArrayBuffer (handle large data safely)
              const binaryString = atob(message.audioData);
              const audioData = new ArrayBuffer(binaryString.length);
              const uint8Array = new Uint8Array(audioData);
              
              for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
              }
              
              console.log(`[Conference] Playing translated audio from ${message.from} (${audioData.byteLength} bytes)`);
              console.log(`[Conference] Selected speaker device: ${selectedSpeaker || 'default'}`);
              
              await playAudioData(audioData, selectedSpeaker);
              console.log(`[Conference] Successfully played translated audio from ${message.from}`);
            } catch (error) {
              console.error('[Conference] Failed to play translated audio:', error);
              console.error('[Conference] Error details:', {
                errorMessage: error instanceof Error ? error.message : String(error),
                audioDataSize: message.audioData?.length || 0,
                selectedSpeaker: selectedSpeaker || 'default',
                from: message.from
              });
            }
          } else {
            console.log(`[Conference] Skipping translated audio from self (${message.from})`);
          }
          break;
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from signaling server');
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
      console.log('Adding local stream tracks to peer connection for', peerId);
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
        if (localStreamRef.current) {
          // Only add audio track if sendRawAudio is enabled
          if (track.kind === 'audio' && !sendRawAudio) {
            console.log(`Skipping audio track for peer ${peerId} (raw audio transmission disabled)`);
            return;
          }
          
          console.log(`Adding ${track.kind} track (enabled: ${track.enabled}) to peer ${peerId}`);
          const sender = pc.addTrack(track, localStreamRef.current);
          console.log('Track added successfully, sender:', sender);
        }
      });
    } else {
      console.warn('No local stream available when creating peer connection for', peerId);
    }

    // Handle remote stream
    pc.ontrack = async (event) => {
      console.log('Received remote stream from', peerId);
      const [remoteStream] = event.streams;
      const track = event.track;
      console.log(`Received ${track.kind} track from ${peerId}, enabled: ${track.enabled}, readyState: ${track.readyState}`);
      
      // Check if this is a video track (screen share)
      if (track.kind === 'video') {
        console.log('Received video track (screen share) from', peerId);
        // Display remote screen share
        if (screenPreviewRef.current) {
          screenPreviewRef.current.srcObject = remoteStream;
          screenPreviewRef.current.play().catch(e => console.error('Error playing remote screen share:', e));
          setRemoteScreenSharer(peerId); // Track who is sharing
        }
      } else if (track.kind === 'audio') {
        console.log('Processing audio stream from', peerId);
        // Create audio element to play remote audio
        const audioElement = new Audio();
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        
        // Set audio output device if supported and selected
        if ('setSinkId' in audioElement && selectedSpeaker) {
          try {
            await (audioElement as any).setSinkId(selectedSpeaker);
            console.log(`[Audio] Set output device for remote audio: ${selectedSpeaker}`);
          } catch (error) {
            console.warn('[Audio] Could not set output device for remote audio:', error);
          }
        }
        
        audioElement.play().catch(e => console.error('Error playing remote audio:', e));
        
        // Process audio stream for translation
        processAudioStream(remoteStream, peerId);
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

  // Process audio stream for translation using Gemini Live Audio
  const processAudioStream = async (stream: MediaStream, peerId: string) => {
    if (!apiKey) return;

    try {
      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) return;

      // Find participant details
      const participant = participants.find(p => p.clientId === peerId);
      const participantUsername = participant ? participant.username : 'Unknown';
      if (!participant) return;

      console.log(`[Conference] Processing audio from peer ${peerId} (${participantUsername})`);

      // Create a new Gemini Live Audio stream for this remote participant
      const remoteAudioStream = new GeminiLiveAudioStream({
        apiKey,
        sourceLanguage: participant.language,
        targetLanguage: myLanguage,
        onAudioReceived: async (audioData) => {
          // Don't play remote participant's translated audio locally
          // (to avoid feedback loops)
          console.log(`[Conference] Received translated audio from ${participantUsername} (not playing locally)`);
        },
        onTextReceived: (translatedText) => {
          console.log(`[Conference] Received translated text from ${participantUsername}:`, translatedText);
          
          // Add the translation to the translations list
          const translation: Translation = {
            id: Date.now() + Math.random(),
            from: participantUsername,
            fromLanguage: participant.language,
            original: 'Audio input', // We don't have the original text from Live Audio
            translation: translatedText.trim(),
            timestamp: new Date().toLocaleTimeString()
          };

          setTranslations(prev => {
            // Keep only last 50 translations to avoid memory issues
            const newTranslations = [...prev, translation];
            if (newTranslations.length > 50) {
              return newTranslations.slice(-50);
            }
            return newTranslations;
          });
        },
        onError: (error) => {
          console.error(`[Conference] Gemini Live Audio error for ${participantUsername}:`, error);
        }
      });

      // Start the stream with the remote audio stream
      await remoteAudioStream.start(stream);
      
      // Store the stream reference for cleanup
      audioRecordersRef.current.set(peerId, remoteAudioStream as any);

    } catch (error) {
      console.error('Error setting up remote audio stream processing:', error);
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
        
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false
      });
      
      // Mute microphone initially
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
      }
      
      // Setup audio level detection after stream is ready
      setupAudioLevelDetection(localStreamRef.current);
      
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
      
      // Start Gemini Live Audio Stream for real-time translation
      if (apiKey && localStreamRef.current) {
        try {
          console.log('[Conference] Initializing Gemini Live Audio...');
          console.log(`[Conference] User: ${username}`);
          console.log(`[Conference] Language: ${myLanguage}`);
          
          // Get the language mapping for Gemini
          const sourceLanguage = GEMINI_LANGUAGE_MAP[myLanguage] || 'English';
          console.log(`[Conference] Mapped language for Gemini: ${sourceLanguage}`);
          
          // Start with a default target language (English) but allow dynamic updates
          console.log('[Conference] Starting with default target language (English), will update when participants join');
          
          // Create a new Gemini Live Audio stream with initial settings
          liveAudioStreamRef.current = new GeminiLiveAudioStream({
            apiKey,
            sourceLanguage,
            targetLanguage: 'English', // Initial default, will be updated dynamically
            onAudioReceived: async (audioData) => {
              // Use ref to get current state values to ensure we have the latest values
              const currentAudioTranslationEnabled = isAudioTranslationEnabledRef.current;
              const currentSelectedSpeaker = selectedSpeaker;
              
              console.log(`[Conference] Received translated audio, Audio Translation enabled: ${currentAudioTranslationEnabled}`);
              
              // If Audio Translation is enabled, play locally as well
              if (currentAudioTranslationEnabled) {
                console.log('[Conference] Playing translated audio locally (Audio Translation ON)');
                try {
                  await playAudioData(audioData, currentSelectedSpeaker);
                } catch (error) {
                  console.error('[Conference] Failed to play audio locally:', error);
                }
              } else {
                console.log('[Conference] Audio Translation OFF - not playing locally, only sending to participants');
              }
              
              // Always send the translated audio to other participants
              await sendTranslatedAudioToParticipants(audioData);
            },
            onTextReceived: (text) => {
              console.log('[Conference] Translated text received:', text);
            },
            onError: (error) => {
              console.error('[Conference] Gemini Live Audio error:', error);
              setErrorMessage(error.message);
              setShowErrorModal(true);
            }
          });
          
          // Start the stream with the local audio stream
          console.log('[Conference] Starting Gemini Live Audio stream with local microphone...');
          await liveAudioStreamRef.current.start(localStreamRef.current);
          console.log('[Conference] Gemini Live Audio stream integration complete');
        } catch (error) {
          console.error('[Conference] Failed to start Gemini Live Audio stream:', error);
        }
      } else {
        if (!apiKey) {
          console.warn('[Conference] Gemini API key not provided - Live Audio translation disabled');
        }
        if (!localStreamRef.current) {
          console.warn('[Conference] No local audio stream available - Live Audio translation disabled');
        }
      }
      
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
      console.log('[Conference] Stopping Gemini Live Audio stream...');
      liveAudioStreamRef.current.stop();
      liveAudioStreamRef.current = null;
      console.log('[Conference] Gemini Live Audio stream stopped');
    }
    
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
        
        console.log('Screen share stream obtained:', screenStreamRef.current);
        console.log('Video tracks:', screenStreamRef.current.getVideoTracks());
        console.log('Stream active:', screenStreamRef.current.active);
        
        // Verify video track is active
        const videoTrack = screenStreamRef.current.getVideoTracks()[0];
        if (!videoTrack) {
          throw new Error('No video track found in screen share stream');
        }
        console.log('Video track enabled:', videoTrack.enabled);
        console.log('Video track readyState:', videoTrack.readyState);
        
        // Add screen share tracks to all peer connections
        Object.values(peerConnectionsRef.current).forEach(pc => {
          if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => {
              console.log(`Adding ${track.kind} track to peer connection`);
              try {
                pc.addTrack(track, screenStreamRef.current!);
                console.log('Track added successfully');
              } catch (error) {
                console.error('Error adding track:', error);
              }
            });
          }
        });
        
        // Display screen share preview - wait for next tick
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (screenPreviewRef.current && screenStreamRef.current) {
          console.log('Setting up screen preview');
          
          // Clear any existing srcObject
          screenPreviewRef.current.srcObject = null;
          
          // Set video element properties before setting srcObject
          screenPreviewRef.current.muted = true;
          screenPreviewRef.current.playsInline = true;
          screenPreviewRef.current.autoplay = true;
          
          // Add event listeners before setting srcObject
          screenPreviewRef.current.onloadedmetadata = () => {
            console.log('Video metadata loaded, dimensions:',
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
            console.log('Video can play');
          };
          
          screenPreviewRef.current.onplaying = () => {
            console.log('Video is playing');
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
                console.log('Video playing successfully');
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
          console.log('Screen share ended by user');
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
          console.log('Stopped track:', track.kind);
        });
        screenStreamRef.current = null;
      }
      if (screenPreviewRef.current && !remoteScreenSharer) {
        screenPreviewRef.current.srcObject = null;
      }
      setIsScreenSharing(false);
      console.log('Screen sharing stopped');
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
    
    console.log(`Sent reaction: ${reaction}`);
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
        const newAudioStream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: deviceId } }
        });
        
        // Replace audio track in local stream
        const newAudioTrack = newAudioStream.getAudioTracks()[0];
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
        }
      } catch (error) {
        console.error('Error changing microphone:', error);
        alert('Failed to change microphone. Please check permissions.');
      }
    }
  };

  // Change speaker device
  const changeSpeaker = async (deviceId: string) => {
    setSelectedSpeaker(deviceId);
    localStorage.setItem('selectedSpeaker', deviceId);
    
    console.log(`[Audio] Changing speaker to device: ${deviceId}`);
    
    try {
      // Apply to all existing audio elements
      const audioElements = document.querySelectorAll('audio');
      console.log(`[Audio] Found ${audioElements.length} existing audio elements`);
      
      for (const audio of audioElements) {
        if ('setSinkId' in audio) {
          try {
            await (audio as any).setSinkId(deviceId);
            console.log('[Audio] Successfully set output device for existing audio element');
          } catch (error) {
            console.warn('[Audio] Could not set output device for existing audio element:', error);
          }
        }
      }
      
      // Apply to audio context destination if available
      if (audioContextRef.current && 'setSinkId' in audioContextRef.current.destination) {
        try {
          await (audioContextRef.current.destination as any).setSinkId(deviceId);
          console.log('[Audio] Successfully set output device for audio context');
        } catch (error) {
          console.warn('[Audio] Could not set output device for audio context:', error);
        }
      }
      
      console.log(`[Audio] Speaker device change completed for device: ${deviceId}`);
    } catch (error) {
      console.warn('[Audio] Speaker change not fully supported:', error);
    }
  };

  // Toggle raw audio transmission
  const toggleSendRawAudio = async () => {
    const newValue = !sendRawAudio;
    setSendRawAudio(newValue);
    localStorage.setItem('sendRawAudio', newValue.toString());
    
    console.log(`[Conference] Raw audio transmission ${newValue ? 'enabled' : 'disabled'}`);
    
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
              console.log(`[Conference] Added audio track to peer connection ${peerId}`);
              
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
              console.log(`[Conference] Removed audio track from peer connection ${peerId}`);
              
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

  // Update Gemini Live Audio target language based on participants
  const updateGeminiTargetLanguage = (currentParticipants: Participant[]) => {
    if (!liveAudioStreamRef.current || !liveAudioStreamRef.current.isSessionReady()) {
      console.log('[Conference] Gemini Live Audio session not ready, skipping language update');
      return;
    }

    // Get languages of other participants (excluding self)
    const otherParticipants = currentParticipants.filter(p => p.clientId !== clientIdRef.current);
    
    if (otherParticipants.length === 0) {
      console.log('[Conference] No other participants, keeping current target language');
      return;
    }

    // Use the first other participant's language as primary target
    const primaryTarget = otherParticipants[0].language;
    const targetLanguage = GEMINI_LANGUAGE_MAP[primaryTarget] || 'English';
    const currentTargetLanguage = liveAudioStreamRef.current.getCurrentTargetLanguage();

    if (targetLanguage !== currentTargetLanguage) {
      console.log(`[Conference] Updating Gemini target language: ${currentTargetLanguage} → ${targetLanguage} (based on participant: ${primaryTarget})`);
      liveAudioStreamRef.current.updateTargetLanguage(targetLanguage);
    } else {
      console.log(`[Conference] Target language already set to ${targetLanguage}, no update needed`);
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
      const uint8Array = new Uint8Array(audioData);
      let base64Audio = '';
      
      // Process in chunks to avoid "Maximum call stack size exceeded" error
      const chunkSize = 8192;
      for (let i = 0; i < uint8Array.length; i += chunkSize) {
        const chunk = uint8Array.slice(i, i + chunkSize);
        base64Audio += btoa(String.fromCharCode(...chunk));
      }

      console.log(`[Conference] Sending translated audio to participants (${audioData.byteLength} bytes)`);

      // Send translated audio via WebSocket
      wsRef.current.send(JSON.stringify({
        type: 'translated-audio',
        audioData: base64Audio,
        audioFormat: 'pcm-24khz-16bit',
        from: username,
        fromLanguage: myLanguage,
        timestamp: Date.now()
      }));

      console.log('[Conference] Translated audio sent to participants');
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
      console.log(`[Conference] Audio translation requested: "${translatedText}"`);
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
        totalUsage: newTotalUsage
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
    resetSessionUsage
  };
};