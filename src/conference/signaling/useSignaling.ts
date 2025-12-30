import { useCallback } from 'react';
import { debugLog } from '../../debug-utils';
import type { Participant } from '../../types';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';
import { createMessageHandlers } from './messageHandlers';
import { useRawAudioToggle } from './useRawAudioToggle';

type SignalingParams = {
  state: Pick<
    ConferenceState,
    | 'roomId'
    | 'username'
    | 'myLanguage'
    | 'participants'
    | 'showChat'
    | 'chatInput'
    | 'isHandRaised'
    | 'setIsHandRaised'
    | 'sendRawAudio'
    | 'isInConference'
    | 'setSendRawAudio'
    | 'setIsConnected'
    | 'setIsInConference'
    | 'setErrorMessage'
    | 'setShowErrorModal'
    | 'setParticipants'
    | 'setTranslations'
    | 'setChatMessages'
    | 'setChatInput'
    | 'setUnreadMessageCount'
    | 'setShowChat'
    | 'setShowReactions'
    | 'selectedSpeaker'
    | 'remoteScreenSharer'
    | 'setRemoteScreenSharer'
    | 'isScreenSharing'
  >;
  refs: Pick<
    ConferenceRefs,
    'wsRef' | 'clientIdRef' | 'screenPreviewRef' | 'peerConnectionsRef' | 'localStreamRef'
  >;
  actions: {
    createPeerConnection: (peerId: string, isInitiator: boolean) => Promise<RTCPeerConnection>;
    closePeerConnection: (peerId: string) => void;
    handleOffer: (peerId: string, offer: RTCSessionDescriptionInit) => Promise<void>;
    handleAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => Promise<void>;
    handleIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => Promise<void>;
    updateGeminiTargetLanguage: (participants: Participant[]) => Promise<void>;
  };
};

export const useSignaling = ({ state, refs, actions }: SignalingParams) => {
  const {
    roomId,
    username,
    myLanguage,
    participants,
    showChat,
    chatInput,
    isHandRaised,
    setIsHandRaised,
    sendRawAudio,
    setSendRawAudio,
    isInConference,
    setIsConnected,
    setIsInConference,
    setErrorMessage,
    setShowErrorModal,
    setParticipants,
    setTranslations,
    setChatMessages,
    setChatInput,
    setUnreadMessageCount,
    setShowChat,
    setShowReactions,
    selectedSpeaker,
    remoteScreenSharer,
    setRemoteScreenSharer,
    isScreenSharing
  } = state;
  const { wsRef, clientIdRef, screenPreviewRef, peerConnectionsRef, localStreamRef } = refs;
  const {
    createPeerConnection,
    closePeerConnection,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    updateGeminiTargetLanguage
  } = actions;

  const connectToSignaling = useCallback(() => {
    const workerDomain = process.env.CLOUDFLARE_WORKER_DOMAIN || 'otak-conference-worker.systemexe-research-and-development.workers.dev';
    const wsUrl = `wss://${workerDomain}/ws?room=${roomId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    if (!wsRef.current) return;

    const handlers = createMessageHandlers({
      state: {
        username,
        myLanguage,
        participants,
        showChat,
        selectedSpeaker,
        setIsConnected,
        setIsInConference,
        setErrorMessage,
        setShowErrorModal,
        setParticipants,
        setTranslations,
        setChatMessages,
        setUnreadMessageCount,
        remoteScreenSharer,
        setRemoteScreenSharer,
        isScreenSharing
      },
      refs: {
        wsRef,
        screenPreviewRef,
        clientIdRef,
        localStreamRef
      },
      actions: {
        createPeerConnection,
        closePeerConnection,
        handleOffer,
        handleAnswer,
        handleIceCandidate,
        updateGeminiTargetLanguage
      }
    });

    ws.onopen = () => {
      debugLog('Connected to signaling server');
      console.log(`[PARTICIPANT] ${username} is joining the conference (Language: ${myLanguage})`);
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

      const handler = handlers[message.type];
      if (handler) {
        await handler(message);
      }
    };

    ws.onclose = () => {
      debugLog('Disconnected from signaling server');
      setIsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [
    clientIdRef,
    closePeerConnection,
    createPeerConnection,
    handleAnswer,
    handleIceCandidate,
    handleOffer,
    isScreenSharing,
    myLanguage,
    participants,
    remoteScreenSharer,
    roomId,
    screenPreviewRef,
    selectedSpeaker,
    setErrorMessage,
    setIsConnected,
    setIsInConference,
    setParticipants,
    setRemoteScreenSharer,
    setShowErrorModal,
    setTranslations,
    setChatMessages,
    setUnreadMessageCount,
    showChat,
    updateGeminiTargetLanguage,
    username,
    wsRef
  ]);

  const toggleHandRaise = useCallback(() => {
    const newHandRaised = !isHandRaised;
    setIsHandRaised(newHandRaised);
    setParticipants(prev => prev.map(p =>
      p.clientId === clientIdRef.current
        ? { ...p, isHandRaised: newHandRaised }
        : p
    ));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'hand-raise',
        raised: newHandRaised,
        username: username
      }));
    }
  }, [clientIdRef, isHandRaised, setIsHandRaised, setParticipants, username, wsRef]);

  const sendReaction = useCallback((reaction: string) => {
    setParticipants(prev => prev.map(p =>
      p.clientId === clientIdRef.current
        ? { ...p, reaction: reaction, reactionTimestamp: Date.now() }
        : p
    ));

    setTimeout(() => {
      setParticipants(prev => prev.map(p =>
        p.clientId === clientIdRef.current
          ? { ...p, reaction: undefined, reactionTimestamp: undefined }
          : p
      ));
    }, 3000);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'reaction',
        reaction: reaction,
        username: username
      }));
    }
    setShowReactions(false);

    debugLog(`Sent reaction: ${reaction}`);
  }, [clientIdRef, setParticipants, setShowReactions, username, wsRef]);

  const sendChatMessage = useCallback(() => {
    if (!chatInput.trim()) return;

    const message = chatInput.trim();
    setChatMessages(prev => [...prev, {
      id: Date.now(),
      from: username,
      message: message,
      timestamp: new Date().toLocaleTimeString(),
      readBy: [username]
    }]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        message: message,
        username: username
      }));
    }

    setChatInput('');
  }, [chatInput, setChatInput, setChatMessages, username, wsRef]);

  const toggleChat = useCallback((value: boolean) => {
    setShowChat(value);
    if (value) {
      setUnreadMessageCount(0);
      setChatMessages(prev => prev.map(msg => {
        if (!msg.readBy?.includes(username)) {
          const updatedMsg = {
            ...msg,
            readBy: [...(msg.readBy || []), username]
          };
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
  }, [setChatMessages, setShowChat, setUnreadMessageCount, username, wsRef]);

  const { toggleSendRawAudio } = useRawAudioToggle({
    state: { sendRawAudio, setSendRawAudio, isInConference },
    refs: { localStreamRef, peerConnectionsRef, wsRef }
  });

  return {
    connectToSignaling,
    toggleHandRaise,
    sendReaction,
    sendChatMessage,
    toggleChat,
    toggleSendRawAudio
  };
};
