import { useCallback } from 'react';
import { debugLog } from '../../debug-utils';
import { ICE_SERVERS } from './iceServers';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type PeerConnectionsParams = {
  state: Pick<
    ConferenceState,
    'sendRawAudio' | 'selectedSpeaker' | 'setRemoteScreenSharer' | 'remoteScreenSharer' | 'isScreenSharing'
  >;
  refs: Pick<
    ConferenceRefs,
    'localStreamRef' | 'peerConnectionsRef' | 'wsRef' | 'screenPreviewRef'
  >;
};

export const usePeerConnections = ({ state, refs }: PeerConnectionsParams) => {
  const { sendRawAudio, selectedSpeaker, setRemoteScreenSharer, remoteScreenSharer, isScreenSharing } = state;
  const { localStreamRef, peerConnectionsRef, wsRef, screenPreviewRef } = refs;

  const createPeerConnection = useCallback(async (peerId: string, isInitiator: boolean) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionsRef.current[peerId] = pc;

    if (localStreamRef.current) {
      debugLog('Adding local stream tracks to peer connection for', peerId);
      localStreamRef.current.getTracks().forEach((track: MediaStreamTrack) => {
        if (localStreamRef.current) {
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

    pc.ontrack = async (event) => {
      debugLog('Received remote stream from', peerId);
      const [remoteStream] = event.streams;
      const track = event.track;
      debugLog(`Received ${track.kind} track from ${peerId}, enabled: ${track.enabled}, readyState: ${track.readyState}`);

      if (track.kind === 'video') {
        debugLog('Received video track (screen share) from', peerId);
        if (screenPreviewRef.current) {
          screenPreviewRef.current.srcObject = remoteStream;
          screenPreviewRef.current.play().catch(e => console.error('Error playing remote screen share:', e));
          setRemoteScreenSharer(peerId);
        }
      } else if (track.kind === 'audio') {
        debugLog('Processing audio stream from', peerId);
        const audioElement = new Audio();
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;

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

    pc.onicecandidate = (event) => {
      if (event.candidate && wsRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'ice-candidate',
          peerId: peerId,
          candidate: event.candidate
        }));
      }
    };

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
  }, [
    localStreamRef,
    peerConnectionsRef,
    screenPreviewRef,
    sendRawAudio,
    selectedSpeaker,
    setRemoteScreenSharer,
    wsRef
  ]);

  const closePeerConnection = useCallback((peerId: string) => {
    if (peerConnectionsRef.current[peerId]) {
      peerConnectionsRef.current[peerId].close();
      delete peerConnectionsRef.current[peerId];
    }
  }, [peerConnectionsRef]);

  const handleOffer = useCallback(async (peerId: string, offer: RTCSessionDescriptionInit) => {
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
  }, [createPeerConnection, peerConnectionsRef, wsRef]);

  const handleAnswer = useCallback(async (peerId: string, answer: RTCSessionDescriptionInit) => {
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      await pc.setRemoteDescription(answer);
    }
  }, [peerConnectionsRef]);

  const handleIceCandidate = useCallback(async (peerId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current[peerId];
    if (pc) {
      await pc.addIceCandidate(candidate);
    }
  }, [peerConnectionsRef]);

  const clearRemoteScreenShare = useCallback(() => {
    if (screenPreviewRef.current && !isScreenSharing && remoteScreenSharer) {
      screenPreviewRef.current.srcObject = null;
    }
  }, [isScreenSharing, remoteScreenSharer, screenPreviewRef]);

  return {
    createPeerConnection,
    closePeerConnection,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    clearRemoteScreenShare
  };
};
