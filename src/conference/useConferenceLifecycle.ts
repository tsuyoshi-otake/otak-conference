import { useCallback } from 'react';
import { debugLog } from '../debug-utils';
import type { Participant } from '../types';
import type { ConferenceRefs, ConferenceState } from './useConferenceState';

type LifecycleParams = {
  state: Pick<
    ConferenceState,
    | 'apiKey'
    | 'username'
    | 'selectedMicrophone'
    | 'myLanguage'
    | 'roomId'
    | 'setParticipants'
    | 'setIsConnected'
    | 'setIsInConference'
    | 'setShowSettings'
    | 'setIsScreenSharing'
    | 'setIsMuted'
    | 'setTranslations'
    | 'setShowCopyModal'
  >;
  refs: Pick<
    ConferenceRefs,
    | 'clientIdRef'
    | 'localStreamRef'
    | 'peerConnectionsRef'
    | 'screenStreamRef'
    | 'wsRef'
    | 'liveAudioStreamRef'
  >;
  actions: {
    getAudioInputStream: (audioConstraints: MediaTrackConstraints | boolean) => Promise<MediaStream>;
    replaceLocalAudioInputStream: (stream: MediaStream) => void;
    connectToSignaling: () => void;
    updateGeminiTargetLanguage: (participants: Participant[]) => Promise<void>;
    cleanupNoiseFilterChain: () => void;
    closePeerConnection: (peerId: string) => void;
  };
};

export const useConferenceLifecycle = ({ state, refs, actions }: LifecycleParams) => {
  const {
    apiKey,
    username,
    selectedMicrophone,
    myLanguage,
    roomId,
    setParticipants,
    setIsConnected,
    setIsInConference,
    setShowSettings,
    setIsScreenSharing,
    setIsMuted,
    setTranslations,
    setShowCopyModal
  } = state;
  const {
    clientIdRef,
    localStreamRef,
    peerConnectionsRef,
    screenStreamRef,
    wsRef,
    liveAudioStreamRef
  } = refs;
  const {
    getAudioInputStream,
    replaceLocalAudioInputStream,
    connectToSignaling,
    updateGeminiTargetLanguage,
    cleanupNoiseFilterChain,
    closePeerConnection
  } = actions;

  const startConference = useCallback(async () => {
    if (!apiKey) {
      alert('Please enter your Gemini API key.');
      return;
    }
    if (!username) {
      alert('Please enter your username.');
      return;
    }

    try {
      const audioConstraints = selectedMicrophone
        ? { deviceId: { exact: selectedMicrophone } }
        : true;

      const rawStream = await getAudioInputStream(audioConstraints);
      replaceLocalAudioInputStream(rawStream);

      const selfParticipant: Participant = {
        clientId: clientIdRef.current,
        username: username,
        language: myLanguage,
        isSpeaking: false,
        isHandRaised: false
      };
      setParticipants([selfParticipant]);

      debugLog('[Conference] Starting local Gemini session check', {
        hasApiKey: Boolean(apiKey),
        hasLocalStream: Boolean(localStreamRef.current),
        myLanguage
      });
      updateGeminiTargetLanguage([selfParticipant]).catch(error => {
        debugLog('[Conference] Failed to start Gemini session:', error);
      });

      connectToSignaling();

      setIsConnected(true);
      setIsInConference(true);
      setShowSettings(false);

      debugLog('[Conference] Gemini Live Audio will run in solo mode or update when participants join');

      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('roomId', roomId);
      window.history.pushState({}, '', `${nextUrl.pathname}?${nextUrl.searchParams.toString()}`);
    } catch (error) {
      console.error('Failed to start conference:', error);
      alert('Failed to access microphone. Please check permissions.');
    }
  }, [
    apiKey,
    clientIdRef,
    connectToSignaling,
    getAudioInputStream,
    localStreamRef,
    myLanguage,
    replaceLocalAudioInputStream,
    roomId,
    selectedMicrophone,
    setIsConnected,
    setIsInConference,
    setParticipants,
    setShowSettings,
    updateGeminiTargetLanguage,
    username
  ]);

  const endConference = useCallback(() => {
    Object.keys(peerConnectionsRef.current).forEach(peerId => {
      closePeerConnection(peerId);
    });

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      localStreamRef.current = null;
    }

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      screenStreamRef.current = null;
    }

    if (liveAudioStreamRef.current) {
      debugLog('[Conference] Stopping Gemini Live Audio stream...');
      liveAudioStreamRef.current.stop();
      liveAudioStreamRef.current = null;
      debugLog('[Conference] Gemini Live Audio stream stopped');
    }

    cleanupNoiseFilterChain();

    setIsConnected(false);
    setIsInConference(false);
    setIsScreenSharing(false);
    setIsMuted(true);
    setTranslations([]);
    setParticipants([]);
  }, [
    cleanupNoiseFilterChain,
    closePeerConnection,
    liveAudioStreamRef,
    localStreamRef,
    peerConnectionsRef,
    screenStreamRef,
    setIsConnected,
    setIsInConference,
    setIsMuted,
    setIsScreenSharing,
    setParticipants,
    setTranslations,
    wsRef
  ]);

  const shareRoomUrl = useCallback(async () => {
    const roomUrl = `${window.location.href.split('?')[0]}?roomId=${roomId}`;
    try {
      await navigator.clipboard.writeText(roomUrl);
      setShowCopyModal(true);
      setTimeout(() => setShowCopyModal(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
      setShowCopyModal(true);
      setTimeout(() => setShowCopyModal(false), 2000);
    }
  }, [roomId, setShowCopyModal]);

  return { startConference, endConference, shareRoomUrl };
};
