import { debugLog } from '../../debug-utils';
import { playAudioData } from '../../gemini-live-audio';
import type { Participant, Translation } from '../../types';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type HandlerParams = {
  state: Pick<
    ConferenceState,
    | 'username'
    | 'myLanguage'
    | 'participants'
    | 'showChat'
    | 'selectedSpeaker'
    | 'setIsConnected'
    | 'setIsInConference'
    | 'setErrorMessage'
    | 'setShowErrorModal'
    | 'setParticipants'
    | 'setTranslations'
    | 'setChatMessages'
    | 'setUnreadMessageCount'
    | 'remoteScreenSharer'
    | 'setRemoteScreenSharer'
    | 'isScreenSharing'
  >;
  refs: Pick<ConferenceRefs, 'wsRef' | 'screenPreviewRef' | 'clientIdRef' | 'localStreamRef'>;
  actions: {
    createPeerConnection: (peerId: string, isInitiator: boolean) => Promise<RTCPeerConnection>;
    closePeerConnection: (peerId: string) => void;
    handleOffer: (peerId: string, offer: RTCSessionDescriptionInit) => Promise<void>;
    handleAnswer: (peerId: string, answer: RTCSessionDescriptionInit) => Promise<void>;
    handleIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => Promise<void>;
    updateGeminiTargetLanguage: (participants: Participant[]) => Promise<void>;
  };
};

type MessageHandler = (message: any) => Promise<void> | void;

export const createMessageHandlers = ({ state, refs, actions }: HandlerParams): Record<string, MessageHandler> => {
  const {
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
  } = state;
  const { wsRef, screenPreviewRef, clientIdRef, localStreamRef } = refs;
  const {
    createPeerConnection,
    closePeerConnection,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    updateGeminiTargetLanguage
  } = actions;

  const handleRoomFull: MessageHandler = (message) => {
    debugLog('Room is full:', message);
    setIsConnected(false);
    setIsInConference(false);
    setErrorMessage(`会議室が満室です。最大参加者数は${message.maxParticipants}名です。（現在${message.currentParticipants}名が参加中）`);
    setShowErrorModal(true);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      localStreamRef.current = null;
    }
  };

  const handleUserJoined: MessageHandler = async (message) => {
    debugLog(`User joined: ${message.peerId}`);
    console.log(`[PARTICIPANT] ${message.username} has joined the conference (Language: ${message.language})`);
    if (message.peerId !== clientIdRef.current) {
      await createPeerConnection(message.peerId, true);
      setParticipants(prev => {
        const newParticipants = [...prev, { clientId: message.peerId, username: message.username, language: message.language }];
        updateGeminiTargetLanguage(newParticipants);
        return newParticipants;
      });
    }
  };

  const handleUserLeft: MessageHandler = (message) => {
    debugLog(`User left: ${message.peerId}`);
    const leavingParticipant = participants.find(p => p.clientId === message.peerId);
    if (leavingParticipant) {
      console.log(`[PARTICIPANT] ${leavingParticipant.username} has left the conference`);
    }
    closePeerConnection(message.peerId);
    setParticipants(prev => {
      const newParticipants = prev.filter(p => p.clientId !== message.peerId);
      updateGeminiTargetLanguage(newParticipants);
      return newParticipants;
    });
    if (remoteScreenSharer === message.peerId) {
      setRemoteScreenSharer(null);
      if (screenPreviewRef.current && !isScreenSharing) {
        screenPreviewRef.current.srcObject = null;
      }
    }
  };

  const handleParticipants: MessageHandler = async (message) => {
    debugLog('Received participants list:', message.participants);
    setParticipants(message.participants);
    updateGeminiTargetLanguage(message.participants);
    const otherParticipants = message.participants.filter((p: Participant) => p.clientId !== clientIdRef.current);
    for (const participant of otherParticipants) {
      await createPeerConnection(participant.clientId, false);
    }
  };

  const handleHandRaise: MessageHandler = (message) => {
    debugLog(`Hand raise from ${message.username}: ${message.raised}`);
    setParticipants(prev => prev.map(p =>
      p.username === message.username
        ? { ...p, isHandRaised: message.raised }
        : p
    ));
  };

  const handleReaction: MessageHandler = (message) => {
    debugLog(`Reaction from ${message.username}: ${message.reaction}`);
    setParticipants(prev => prev.map(p =>
      p.username === message.username
        ? { ...p, reaction: message.reaction, reactionTimestamp: Date.now() }
        : p
    ));
    setTimeout(() => {
      setParticipants(prev => prev.map(p =>
        p.username === message.username
          ? { ...p, reaction: undefined, reactionTimestamp: undefined }
          : p
      ));
    }, 3000);
  };

  const handleChat: MessageHandler = (message) => {
    debugLog(`Chat message from ${message.username}: ${message.message}`);
    if (message.username !== username) {
      setChatMessages(prev => [...prev, {
        id: Date.now(),
        from: message.username,
        message: message.message,
        timestamp: new Date().toLocaleTimeString(),
        readBy: showChat ? [username] : []
      }]);
      if (!showChat) {
        setUnreadMessageCount(prev => prev + 1);
      }
    }
  };

  const handleMessageRead: MessageHandler = (message) => {
    debugLog(`Message read by ${message.readBy}: ${message.messageId}`);
    setChatMessages(prev => prev.map(msg =>
      msg.id === message.messageId
        ? { ...msg, readBy: [...(msg.readBy || []), message.readBy] }
        : msg
    ));
  };

  const handleSpeakingStatus: MessageHandler = (message) => {
    setParticipants(prev => prev.map(p =>
      p.username === message.username
        ? { ...p, isSpeaking: message.isSpeaking, audioLevel: message.audioLevel }
        : p
    ));
  };

  const handleTranslatedAudio: MessageHandler = async (message) => {
    logTranslatedAudioMetadata(message);

    if (message.from === username) {
      debugLog(`[Conference] Skipping translated audio from self (${message.from})`);
      return;
    }

    try {
      await processTranslatedAudio(message, selectedSpeaker);
    } catch (error) {
      logTranslatedAudioError(error, message, selectedSpeaker);
    }
  };

  const handleTranslation: MessageHandler = (message) => {
    debugLog(`[Conference] Received translation from ${message.translation.from}`);
    if (message.translation.from !== username) {
      setTranslations(prev => {
        const updated = [...prev, message.translation as Translation];
        debugLog('?? [HOOKS] Received translation from participant:', message.translation);
        debugLog('?? [HOOKS] Updated translations array length:', updated.length);
        return updated;
      });
    }
  };

  return {
    'room-full': handleRoomFull,
    'user-joined': handleUserJoined,
    'user-left': handleUserLeft,
    'offer': (message) => handleOffer(message.peerId, message.offer),
    'answer': (message) => handleAnswer(message.peerId, message.answer),
    'ice-candidate': (message) => handleIceCandidate(message.peerId, message.candidate),
    'participants': handleParticipants,
    'hand-raise': handleHandRaise,
    'reaction': handleReaction,
    'chat': handleChat,
    'message-read': handleMessageRead,
    'speaking-status': handleSpeakingStatus,
    'translated-audio': handleTranslatedAudio,
    'translation': handleTranslation
  };
};

const logTranslatedAudioMetadata = (message: any): void => {
  debugLog(`[Conference] Received translated audio from ${message.from}`);
  debugLog(`[Conference] Audio data size: ${message.audioData?.length || 0} characters (Base64)`);
  debugLog(`[Conference] Audio format: ${message.audioFormat}`);
  debugLog(`[Conference] From language: ${message.fromLanguage}`);
};

const processTranslatedAudio = async (message: any, selectedSpeaker: string | null | undefined): Promise<void> => {
  logAudioReceiveDetails(message);
  const base64Audio = validateBase64AudioData(message.audioData);
  const audioData = decodeBase64ToArrayBuffer(base64Audio);
  logAudioPlaybackDetails(message.from, audioData.byteLength, selectedSpeaker);
  await playTranslatedAudio(audioData, message.from, selectedSpeaker);
};

const logAudioReceiveDetails = (message: any): void => {
  debugLog(`?? [Audio Receive] Received audio from ${message.from}`);
  debugLog(`?? [Audio Receive] Base64 data size: ${message.audioData?.length || 0} characters`);
  debugLog(`?? [Audio Receive] Base64 preview: ${message.audioData?.substring(0, 100) || 'None'}...`);
};

const validateBase64AudioData = (audioData: unknown): string => {
  if (!audioData || typeof audioData !== 'string') {
    throw new Error('Invalid audio data: not a string');
  }

  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(audioData)) {
    throw new Error('Invalid audio data: not valid Base64 format');
  }

  debugLog(`? [Audio Receive] Base64 validation passed`);
  return audioData;
};

const decodeBase64ToArrayBuffer = (base64Audio: string): ArrayBuffer => {
  debugLog(`?? [Audio Receive] Decoding Base64 to binary...`);
  const binaryString = atob(base64Audio);
  debugLog(`?? [Audio Receive] Decoded binary length: ${binaryString.length} bytes`);

  const audioData = new ArrayBuffer(binaryString.length);
  const uint8Array = new Uint8Array(audioData);

  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }

  debugLog(`?? [Audio Receive] ArrayBuffer created: ${audioData.byteLength} bytes`);
  return audioData;
};

const logAudioPlaybackDetails = (from: string, audioDataLength: number, selectedSpeaker: string | null | undefined): void => {
  debugLog(`[Conference] Playing translated audio from ${from} (${audioDataLength} bytes)`);
  debugLog(`[Conference] Selected speaker device: ${selectedSpeaker || 'default'}`);
};

const playTranslatedAudio = async (
  audioData: ArrayBuffer,
  from: string,
  selectedSpeaker: string | null | undefined
): Promise<void> => {
  debugLog(`?? [Audio Receive] Starting playback...`);
  const outputDeviceId = selectedSpeaker ?? undefined;
  await playAudioData(audioData, outputDeviceId);
  debugLog(`? [Audio Receive] Successfully played translated audio from ${from}`);
  debugLog(`[Conference] Successfully played translated audio from ${from}`);
};

const logTranslatedAudioError = (error: unknown, message: any, selectedSpeaker: string | null | undefined): void => {
  console.error('? [Audio Receive] Failed to play translated audio:', error);
  console.error('[Conference] Failed to play translated audio:', error);
  console.error('[Conference] Error details:', {
    errorMessage: error instanceof Error ? error.message : String(error),
    audioDataSize: message.audioData?.length || 0,
    audioDataType: typeof message.audioData,
    audioDataPreview: message.audioData?.substring(0, 100) || 'None',
    selectedSpeaker: selectedSpeaker || 'default',
    from: message.from
  });
};
