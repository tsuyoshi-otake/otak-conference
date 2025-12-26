// src/index.js - Cloudflare Worker with Durable Objects for WebRTC Signaling

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // WebSocket upgrade for signaling
    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      // Get or create a room
      const roomId = url.searchParams.get('room') || 'default';
      const roomIdObj = env.ROOMS.idFromName(roomId);
      const room = env.ROOMS.get(roomIdObj);
      
      return room.fetch(request);
    }
    
    // Serve the main HTML page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(getIndexHTML(), {
        headers: { 
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

// Durable Object for managing WebRTC signaling rooms
export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    await this.handleSession(server);
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async handleSession(webSocket) {
    webSocket.accept();
    
    let sessionId = null;
    
    webSocket.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'join':
            sessionId = data.clientId;
            this.sessions.set(sessionId, {
              webSocket,
              language: data.language,
              clientId: data.clientId
            });
            
            // Send current participants list to new user
            const participants = Array.from(this.sessions.entries())
              .filter(([id]) => id !== sessionId)
              .map(([id, session]) => ({
                clientId: session.clientId,
                language: session.language
              }));
            
            webSocket.send(JSON.stringify({
              type: 'users-list',
              users: participants
            }));
            
            // Notify all other users about new participant
            this.broadcast({
              type: 'user-joined',
              clientId: data.clientId,
              language: data.language
            }, sessionId);
            break;
            
          case 'offer':
          case 'answer':
          case 'ice-candidate':
            // Forward WebRTC signaling messages to target
            const targetSession = Array.from(this.sessions.values())
              .find(session => session.clientId === data.targetId);
            
            if (targetSession) {
              targetSession.webSocket.send(JSON.stringify({
                ...data,
                fromId: sessionId
              }));
            }
            break;
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });
    
    webSocket.addEventListener('close', () => {
      if (sessionId) {
        this.sessions.delete(sessionId);
        this.broadcast({
          type: 'user-left',
          clientId: sessionId
        }, sessionId);
      }
    });
    
    webSocket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      if (sessionId) {
        this.sessions.delete(sessionId);
      }
    });
  }

  broadcast(message, excludeId = null) {
    const messageStr = JSON.stringify(message);
    
    this.sessions.forEach((session, id) => {
      if (id !== excludeId) {
        try {
          session.webSocket.send(messageStr);
        } catch (error) {
          console.error('Broadcast error:', error);
          this.sessions.delete(id);
        }
      }
    });
  }
}

// HTML content for the application
function getIndexHTML() {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini Translation Conference</title>
    <script src="https://cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js" crossorigin></script>
    <script src="https://cdn.jsdelivr.net/npm/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://unpkg.com/lucide-react@0.263.1/dist/lucide-react.css">
</head>
<body>
    <div id="root"></div>
    <script type="text/babel">
      ${getReactAppCode()}
    </script>
</body>
</html>`;
}

// Minified version of the React app code
function getReactAppCode() {
  return `
    // Lucide React icons (inline implementation)
    const Icon = ({ name, className = "w-5 h-5" }) => {
      const icons = {
        'mic': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>,
        'mic-off': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>,
        'monitor': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>,
        'monitor-off': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M22 15V5a2 2 0 0 0-2-2H9" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /><line x1="1" y1="1" x2="23" y2="23" /></svg>,
        'phone-off': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.91 8.91A16 16 0 0 0 6.34 6.34l1.27-1.27a2 2 0 0 0 .45-2.11A12.84 12.84 0 0 0 7.36 2.2 2 2 0 0 0 5.36 2H2.36A2 2 0 0 0 .36 2.2 19.77 19.77 0 0 0 3.41 10.68" /><line x1="23" y1="1" x2="1" y2="23" /></svg>,
        'settings': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1v6m0 6v6m4.22-10.22l4.24-4.24M6.34 6.34L2.1 2.1m10.12 19.8l4.24-4.24M6.34 17.66l-4.24 4.24M1 12h6m6 0h6m-10.22 4.22l-4.24 4.24m12.12 0l4.24-4.24M6.34 6.34l-4.24-4.24m12.12 0l4.24 4.24" /></svg>,
        'globe': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>,
        'users': <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M23 21v-2a4 4 0 0 0-3-3.87" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
      };
      return icons[name] || null;
    };

    const { useState, useEffect, useRef, useCallback } = React;

    const App = () => {
      const [apiKey, setApiKey] = useState('');
      const [isConnected, setIsConnected] = useState(false);
      const [isMuted, setIsMuted] = useState(false);
      const [isScreenSharing, setIsScreenSharing] = useState(false);
      const [myLanguage, setMyLanguage] = useState('ja');
      const [translations, setTranslations] = useState([]);
      const [participants, setParticipants] = useState([]);
      const [showSettings, setShowSettings] = useState(true);
      
      const wsRef = useRef(null);
      const localStreamRef = useRef(null);
      const screenStreamRef = useRef(null);
      const peerConnectionsRef = useRef({});
      const clientIdRef = useRef(Math.random().toString(36).substr(2, 9));
      
      const iceServers = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };

      const connectToSignaling = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsRef.current = new WebSocket(\`\${protocol}//\${window.location.host}/ws\`);
        
        wsRef.current.onopen = () => {
          console.log('Connected to signaling server');
          wsRef.current.send(JSON.stringify({
            type: 'join',
            clientId: clientIdRef.current,
            language: myLanguage
          }));
        };
        
        wsRef.current.onmessage = async (event) => {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'users-list':
              setParticipants(data.users.filter(u => u.clientId !== clientIdRef.current));
              break;
              
            case 'user-joined':
              setParticipants(prev => [...prev, { clientId: data.clientId, language: data.language }]);
              await createPeerConnection(data.clientId, true);
              break;
              
            case 'user-left':
              setParticipants(prev => prev.filter(p => p.clientId !== data.clientId));
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
        
        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      }, [myLanguage]);

      const createPeerConnection = async (peerId, createOffer = false) => {
        const pc = new RTCPeerConnection(iceServers);
        peerConnectionsRef.current[peerId] = pc;
        
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            pc.addTrack(track, localStreamRef.current);
          });
        }
        
        pc.onicecandidate = (event) => {
          if (event.candidate && wsRef.current) {
            wsRef.current.send(JSON.stringify({
              type: 'ice-candidate',
              targetId: peerId,
              candidate: event.candidate
            }));
          }
        };
        
        pc.ontrack = (event) => {
          const remoteAudio = document.getElementById(\`audio-\${peerId}\`);
          if (remoteAudio) {
            remoteAudio.srcObject = event.streams[0];
          } else {
            const audio = document.createElement('audio');
            audio.id = \`audio-\${peerId}\`;
            audio.autoplay = true;
            audio.srcObject = event.streams[0];
            document.body.appendChild(audio);
          }
          
          processAudioStream(event.streams[0], peerId);
        };
        
        if (createOffer) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          
          wsRef.current.send(JSON.stringify({
            type: 'offer',
            targetId: peerId,
            offer: offer
          }));
        }
        
        return pc;
      };

      const handleOffer = async (data) => {
        const pc = await createPeerConnection(data.fromId, false);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        wsRef.current.send(JSON.stringify({
          type: 'answer',
          targetId: data.fromId,
          answer: answer
        }));
      };

      const handleAnswer = async (data) => {
        const pc = peerConnectionsRef.current[data.fromId];
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      };

      const handleIceCandidate = async (data) => {
        const pc = peerConnectionsRef.current[data.fromId];
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      };

      const closePeerConnection = (peerId) => {
        const pc = peerConnectionsRef.current[peerId];
        if (pc) {
          pc.close();
          delete peerConnectionsRef.current[peerId];
        }
        
        const audio = document.getElementById(\`audio-\${peerId}\`);
        if (audio) {
          audio.remove();
        }
      };

      const processAudioStream = async (stream, peerId) => {
        if (!apiKey) return;
        
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        let audioBuffer = [];
        let silenceCounter = 0;
        
        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const sum = inputData.reduce((a, b) => a + Math.abs(b), 0);
          const average = sum / inputData.length;
          
          if (average > 0.01) {
            audioBuffer.push(...inputData);
            silenceCounter = 0;
          } else {
            silenceCounter++;
            
            if (silenceCounter > 40 && audioBuffer.length > 0) {
              const audioData = new Float32Array(audioBuffer);
              transcribeAndTranslate(audioData, peerId);
              audioBuffer = [];
            }
          }
        };
      };

      const transcribeAndTranslate = async (audioData, peerId) => {
        try {
          const participant = participants.find(p => p.clientId === peerId);
          if (!participant) return;
          
          const wavBuffer = encodeWAV(audioData);
          const base64Audio = btoa(String.fromCharCode(...new Uint8Array(wavBuffer)));
          
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    inlineData: {
                      mimeType: 'audio/wav',
                      data: base64Audio
                    }
                  },
                  {
                    text: \`Please transcribe this audio and translate it from \${participant.language === 'ja' ? 'Japanese' : 'Vietnamese'} to \${myLanguage === 'ja' ? 'Japanese' : 'Vietnamese'}. Return the result in JSON format: {"original": "transcribed text", "translation": "translated text"}\`
                  }
                ]
              }]
            })
          });
          
          const result = await response.json();
          if (result.candidates && result.candidates[0]) {
            const text = result.candidates[0].content.parts[0].text;
            try {
              const parsed = JSON.parse(text);
              setTranslations(prev => [...prev, {
                id: Date.now(),
                from: participant.clientId,
                fromLanguage: participant.language,
                original: parsed.original,
                translation: parsed.translation,
                timestamp: new Date().toLocaleTimeString()
              }]);
            } catch (e) {
              console.error('Failed to parse translation response:', e);
            }
          }
        } catch (error) {
          console.error('Translation error:', error);
        }
      };

      const encodeWAV = (samples) => {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        
        const writeString = (offset, string) => {
          for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
          }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 48000, true);
        view.setUint32(28, 48000 * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);
        
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
          const s = Math.max(-1, Math.min(1, samples[i]));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          offset += 2;
        }
        
        return buffer;
      };

      const startConference = async () => {
        if (!apiKey) {
          alert('Please enter your Gemini API key');
          return;
        }
        
        try {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: false 
          });
          
          connectToSignaling();
          
          setIsConnected(true);
          setShowSettings(false);
        } catch (error) {
          console.error('Failed to start conference:', error);
          alert('Failed to access microphone. Please check permissions.');
        }
      };

      const endConference = () => {
        Object.keys(peerConnectionsRef.current).forEach(peerId => {
          closePeerConnection(peerId);
        });
        
        if (wsRef.current) {
          wsRef.current.close();
        }
        
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => track.stop());
          localStreamRef.current = null;
        }
        
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach(track => track.stop());
          screenStreamRef.current = null;
        }
        
        setIsConnected(false);
        setIsScreenSharing(false);
        setTranslations([]);
        setParticipants([]);
      };

      const toggleMute = () => {
        if (localStreamRef.current) {
          const audioTrack = localStreamRef.current.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            setIsMuted(!audioTrack.enabled);
          }
        }
      };

      const toggleScreenShare = async () => {
        if (!isScreenSharing) {
          try {
            screenStreamRef.current = await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false
            });
            
            const videoTrack = screenStreamRef.current.getVideoTracks()[0];
            
            Object.values(peerConnectionsRef.current).forEach(pc => {
              const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
              if (sender) {
                sender.replaceTrack(videoTrack);
              } else {
                pc.addTrack(videoTrack, screenStreamRef.current);
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
            screenStreamRef.current.getTracks().forEach(track => track.stop());
            screenStreamRef.current = null;
          }
          setIsScreenSharing(false);
        }
      };

      return (
        <div className="min-h-screen bg-gray-900 text-white">
          <header className="bg-gray-800 border-b border-gray-700 p-4">
            <div className="container mx-auto flex items-center justify-between">
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Icon name="globe" className="w-6 h-6" />
                Gemini Translation Conference
              </h1>
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"
              >
                <Icon name="settings" />
              </button>
            </div>
          </header>

          {showSettings && (
            <div className="bg-gray-800 border-b border-gray-700 p-4">
              <div className="container mx-auto space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Gemini API Key
                  </label>
                  <input
                    type="password"
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
                    <option value="ja">日本語 (Japanese)</option>
                    <option value="vi">Tiếng Việt (Vietnamese)</option>
                  </select>
                </div>
                
                {!isConnected && (
                  <button
                    onClick={startConference}
                    className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
                  >
                    Start Conference
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="container mx-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-1 bg-gray-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Icon name="users" />
                Participants ({participants.length})
              </h2>
              <div className="space-y-2">
                {participants.map(participant => (
                  <div
                    key={participant.clientId}
                    className="p-3 bg-gray-700 rounded-lg flex items-center justify-between"
                  >
                    <span className="text-sm">{participant.clientId}</span>
                    <span className="text-xs bg-gray-600 px-2 py-1 rounded">
                      {participant.language === 'ja' ? '日本語' : 'Tiếng Việt'}
                    </span>
                  </div>
                ))}
                {participants.length === 0 && (
                  <p className="text-gray-400 text-sm">No other participants yet</p>
                )}
              </div>
            </div>

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

          {isConnected && (
            <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4">
              <div className="container mx-auto flex items-center justify-center gap-4">
                <button
                  onClick={toggleMute}
                  className={\`p-3 rounded-full transition-colors \${
                    isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'
                  }\`}
                >
                  <Icon name={isMuted ? 'mic-off' : 'mic'} />
                </button>
                
                <button
                  onClick={toggleScreenShare}
                  className={\`p-3 rounded-full transition-colors \${
                    isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'
                  }\`}
                >
                  <Icon name={isScreenSharing ? 'monitor' : 'monitor-off'} />
                </button>
                
                <button
                  onClick={endConference}
                  className="p-3 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
                >
                  <Icon name="phone-off" />
                </button>
              </div>
            </div>
          )}
        </div>
      );
    };

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);
  `;
}