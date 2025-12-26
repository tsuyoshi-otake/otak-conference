import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Mic, MicOff, Monitor, MonitorOff, Phone, PhoneOff, Settings, Users, Share2, Copy, Video, VideoOff, Sparkles, Sun } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface Participant {
  clientId: string;
  username: string;
  language: string;
}

interface Translation {
  id: number;
  from: string; // This will be the username
  fromLanguage: string;
  original: string;
  translation: string;
  timestamp: string;
}

const App = () => {
  const [apiKey, setApiKey] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isInConference, setIsInConference] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
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
  
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const audioContextRef = useRef<AudioContext | null>(null);
  const clientIdRef = useRef<string>(uuidv4()); // Use UUID for internal client ID
  
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
    if (storedApiKey) {
      setApiKey(storedApiKey);
    }
    if (storedUsername) {
      setUsername(storedUsername);
    }
    if (storedLanguage) {
      setMyLanguage(storedLanguage);
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

  // Save settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem('geminiApiKey', apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem('username', username);
  }, [username]);

  useEffect(() => {
    localStorage.setItem('myLanguage', myLanguage);
  }, [myLanguage]);

  // Initialize WebSocket connection
  const connectToSignaling = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?roomId=${roomId}`;
    wsRef.current = new WebSocket(wsUrl);
    
    if (!wsRef.current) return; // Type guard

    wsRef.current.onopen = () => {
      console.log('Connected to signaling server');
      if (wsRef.current) { // Type guard
        wsRef.current.send(JSON.stringify({
          type: 'join',
          clientId: clientIdRef.current,
          username: username, // Send username
          language: myLanguage,
          roomId: roomId // Send roomId
        }));
      }
    };
    
    wsRef.current.onmessage = async (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'users-list':
          setParticipants(data.users.filter((u: Participant) => u.clientId !== clientIdRef.current));
          break;
          
        case 'user-joined':
          setParticipants(prev => [...prev, { clientId: data.clientId, username: data.username, language: data.language }]);
          // Create offer for new user
          await createPeerConnection(data.clientId, true);
          break;
          
        case 'user-left':
          setParticipants(prev => prev.filter((p: Participant) => p.clientId !== data.clientId));
          closePeerConnection(data.clientId);
          break;
          
        case 'offer':
          await handleOffer(data);
          break;
          
        case 'answer':
          await handleAnswer(data);
          break;
          
        case 'ice-candidate':
          await handleIceCandidate(data);
          break;
      }
    };
    
    wsRef.current.onclose = () => {
      console.log('Disconnected from signaling server');
      setIsConnected(false);
    };
    
    wsRef.current.onerror = (error: Event) => {
      console.error('WebSocket error:', error);
    };
  }, [myLanguage, roomId, username]); // Add roomId and username to dependencies

  // Create peer connection
  const createPeerConnection = async (peerId: string, createOffer = false) => {
    const pc = new RTCPeerConnection(iceServers);
    peerConnectionsRef.current[peerId] = pc;
    
    // Add local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }
    
    // Handle ICE candidates
    pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          targetId: peerId,
          candidate: event.candidate
        }));
      }
    };
    
    // Handle remote stream
    pc.ontrack = (event: RTCTrackEvent) => {
      const remoteAudio = document.getElementById(`audio-${peerId}`) as HTMLAudioElement;
      if (remoteAudio) {
        remoteAudio.srcObject = event.streams[0];
      } else {
        const audio = document.createElement('audio');
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        audio.srcObject = event.streams[0];
        document.body.appendChild(audio);
      }
      
    };
    
    // Create offer if needed
    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      if (wsRef.current) { // Type guard
        wsRef.current.send(JSON.stringify({
          type: 'offer',
          targetId: peerId,
          offer: offer
        }));
      }
    }
    
    return pc;
  };

  // Handle WebRTC signaling
  const handleOffer = async (data: { fromId: string; offer: RTCSessionDescriptionInit }) => {
    const pc = await createPeerConnection(data.fromId, false);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    if (wsRef.current) { // Type guard
      wsRef.current.send(JSON.stringify({
        type: 'answer',
        targetId: data.fromId,
        answer: answer
      }));
    }
  };

  const handleAnswer = async (data: { fromId: string; answer: RTCSessionDescriptionInit }) => {
    const pc = peerConnectionsRef.current[data.fromId];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  };

  const handleIceCandidate = async (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
    const pc = peerConnectionsRef.current[data.fromId];
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  };

  const closePeerConnection = (peerId: string) => {
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      pc.close();
      delete peerConnectionsRef.current[peerId];
    }
    
    const audio = document.getElementById(`audio-${peerId}`);
    if (audio) {
      audio.remove();
    }
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
      // Get user media
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      
      // Initialize audio context
      audioContextRef.current = new AudioContext();
      
      // Connect to signaling server
      connectToSignaling();
      
      setIsConnected(true);
      setIsInConference(true);
      setShowSettings(false);
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
    
    setIsConnected(false);
    setIsInConference(false);
    setIsScreenSharing(false);
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
          video: true,
          audio: false
        });
        
        const videoTrack = screenStreamRef.current.getVideoTracks()[0];
        
        // Replace video track in all peer connections
        Object.values(peerConnectionsRef.current).forEach((pc: RTCPeerConnection) => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(videoTrack);
          } else {
            pc.addTrack(videoTrack, screenStreamRef.current!);
          }
        });
        
        videoTrack.onended = () => {
          setIsScreenSharing(false);
        };
        
        setIsScreenSharing(true);
      } catch (error) {
        console.error('Failed to share screen:', error);
      }
    } else {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
    }
  };

  // Toggle camera
  const toggleCamera = async () => {
    if (!isCameraOn) {
      try {
        cameraStreamRef.current = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          },
          audio: false
        });
        
        setIsCameraOn(true);
        
        // Apply video effects if enabled
        if (isBackgroundBlur || isBeautyMode || brightness !== 100) {
          applyVideoEffects();
        }
      } catch (error) {
        console.error('Failed to access camera:', error);
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
    
    video.srcObject = cameraStreamRef.current;
    
    const processFrame = () => {
      if (!video.paused && !video.ended) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw the video frame
        ctx.drawImage(video, 0, 0);
        
        // Apply brightness
        if (brightness !== 100) {
          ctx.filter = `brightness(${brightness}%)`;
          ctx.drawImage(canvas, 0, 0);
        }
        
        // Apply beauty mode (soft focus effect)
        if (isBeautyMode) {
          ctx.filter = 'blur(0.5px)';
          ctx.globalAlpha = 0.8;
          ctx.drawImage(canvas, 0, 0);
          ctx.globalAlpha = 1.0;
        }
        
        // Note: Background blur would require more advanced processing
        // like TensorFlow.js with BodyPix or MediaPipe
        
        requestAnimationFrame(processFrame);
      }
    };
    
    video.play();
    processFrame();
  };

  // Update video effects when settings change
  useEffect(() => {
    if (isCameraOn) {
      applyVideoEffects();
    }
  }, [isBackgroundBlur, isBeautyMode, brightness, isCameraOn]);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <h1 className="text-2xl font-bold">otak-conference</h1>
              <p className="text-sm text-gray-400">Translation Conference</p>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Settings Panel */}
      {(showSettings || !username || !apiKey) && (
        <div className="bg-gray-800 border-b border-gray-700 p-4">
          <div className="container mx-auto space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                disabled={isConnected}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Gemini API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">
                Your Language
              </label>
              <select
                value={myLanguage}
                onChange={(e) => setMyLanguage(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:border-blue-500"
                disabled={isConnected}
              >
                <option value="english">English</option>
                <option value="french">Français</option>
                <option value="german">Deutsch</option>
                <option value="italian">Italiano</option>
                <option value="spanish">Español</option>
                <option value="portuguese">Português</option>
                <option value="czech">Čeština</option>
                <option value="hungarian">Magyar</option>
                <option value="bulgarian">Български</option>
                <option value="turkish">Türkçe</option>
                <option value="polish">Polski</option>
                <option value="russian">Русский</option>
                <option value="japanese">日本語</option>
                <option value="chinese">中文</option>
                <option value="traditionalChinese">繁體中文</option>
                <option value="korean">한국어</option>
                <option value="vietnamese">Tiếng Việt</option>
                <option value="thai">ไทย</option>
                <option value="hindi">हिन्दी</option>
                <option value="bengali">বাংলা</option>
                <option value="javanese">Basa Jawa</option>
                <option value="tamil">தமிழ்</option>
                <option value="burmese">မြန်မာဘာသာ</option>
                <option value="arabic">العربية</option>
                <option value="hebrew">עברית</option>
              </select>
            </div>

          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="container mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4 pb-20">
        {/* Participants */}
        <div className="lg:col-span-1 bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5" />
            Participants ({participants.length})
          </h2>
          <div className="space-y-2">
            {participants.map(participant => (
              <div
                key={participant.clientId}
                className="p-3 bg-gray-700 rounded-lg flex items-center justify-between"
              >
                <span className="text-sm">{participant.username}</span> {/* Display username */}
                <span className="text-xs bg-gray-600 px-2 py-1 rounded">
                  {participant.language === 'ja' ? 'Japanese' : 'Vietnamese'}
                </span>
              </div>
            ))}
            {participants.length === 0 && (
              <p className="text-gray-400 text-sm">No other participants yet</p>
            )}
          </div>
        </div>

        {/* Translations */}
        <div className="lg:col-span-2 bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold mb-4">Translations</h2>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {translations.map(translation => (
              <div
                key={translation.id}
                className="p-4 bg-gray-700 rounded-lg space-y-2"
              >
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>{translation.from}</span>
                  <span>{translation.timestamp}</span>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-300">
                    <span className="font-medium">Original ({translation.fromLanguage}):</span> {translation.original}
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">Translation ({myLanguage}):</span> {translation.translation}
                  </p>
                </div>
              </div>
            ))}
            {translations.length === 0 && (
              <p className="text-gray-400 text-center py-8">
                Translations will appear here...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4">
        <div className="container mx-auto grid grid-cols-3 items-center">
          {/* Left side - Start/Close Conference */}
          <div className="flex justify-start">
            {isInConference ? (
              <button
                onClick={endConference}
                className="py-2 px-4 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <PhoneOff className="w-4 h-4" />
                Close Conference
              </button>
            ) : (
              <button
                onClick={startConference}
                className="py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors flex items-center gap-2"
                disabled={!username || !apiKey}
              >
                <Phone className="w-4 h-4" />
                Start Conference
              </button>
            )}
          </div>

          {/* Center - Media controls */}
          <div className="flex justify-center gap-4">
            <button
              onClick={toggleMute}
              disabled={!isInConference}
              className={`p-3 rounded-full transition-colors ${
                !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            
            <button
              onClick={toggleScreenShare}
              disabled={!isInConference}
              className={`p-3 rounded-full transition-colors ${
                !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {isScreenSharing ? <Monitor className="w-5 h-5" /> : <MonitorOff className="w-5 h-5" />}
            </button>
            
            <button
              onClick={toggleCamera}
              disabled={!isInConference}
              className={`p-3 rounded-full transition-colors ${
                !isInConference ? 'bg-gray-700 opacity-50 cursor-not-allowed' :
                isCameraOn ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {isCameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
            </button>
            
            {isCameraOn && (
              <button
                onClick={() => setShowCameraSettings(!showCameraSettings)}
                className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                <Sparkles className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Right side - Share button */}
          <div className="flex justify-end">
            <button
              onClick={shareRoomUrl}
              className="py-2 px-4 bg-green-600 hover:bg-green-700 rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* Copy Success Modal */}
      {showCopyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 mx-4 text-center">
            <div className="flex items-center justify-center mb-3">
              <Copy className="w-8 h-8 text-green-400" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Room URL Copied!</h3>
            <p className="text-gray-300">The room URL has been copied to your clipboard.</p>
          </div>
        </div>
      )}

      {/* Camera Settings Modal */}
      {showCameraSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg p-6 mx-4 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Camera Settings</h3>
            
            {/* Background Blur */}
            <div className="mb-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isBackgroundBlur}
                  onChange={(e) => setIsBackgroundBlur(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <span>Background Blur</span>
              </label>
            </div>
            
            {/* Beauty Mode */}
            <div className="mb-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={isBeautyMode}
                  onChange={(e) => setIsBeautyMode(e.target.checked)}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <span>Beauty Mode (Soft Focus)</span>
              </label>
            </div>
            
            {/* Brightness */}
            <div className="mb-6">
              <label className="block mb-2">
                <span className="flex items-center gap-2">
                  <Sun className="w-4 h-4" />
                  Brightness: {brightness}%
                </span>
              </label>
              <input
                type="range"
                min="50"
                max="150"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>
            
            <button
              onClick={() => setShowCameraSettings(false)}
              className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Hidden video and canvas elements for video processing */}
      <video ref={videoRef} style={{ display: 'none' }} />
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};

// Mount the React application to the DOM
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}

export default App;