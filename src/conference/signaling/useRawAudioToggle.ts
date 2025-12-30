import { useCallback } from 'react';
import { debugLog } from '../../debug-utils';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type RawAudioToggleParams = {
  state: Pick<ConferenceState, 'sendRawAudio' | 'setSendRawAudio' | 'isInConference'>;
  refs: Pick<ConferenceRefs, 'localStreamRef' | 'peerConnectionsRef' | 'wsRef'>;
};

export const useRawAudioToggle = ({ state, refs }: RawAudioToggleParams) => {
  const { sendRawAudio, setSendRawAudio, isInConference } = state;
  const { localStreamRef, peerConnectionsRef, wsRef } = refs;

  const toggleSendRawAudio = useCallback(async () => {
    const newValue = !sendRawAudio;
    setSendRawAudio(newValue);

    debugLog(`[Conference] Raw audio transmission ${newValue ? 'enabled' : 'disabled'}`);

    if (localStreamRef.current && isInConference) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        for (const [peerId, pc] of Object.entries(peerConnectionsRef.current)) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'audio');

          try {
            if (newValue && !sender) {
              pc.addTrack(audioTrack, localStreamRef.current!);
              debugLog(`[Conference] Added audio track to peer connection ${peerId}`);

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
              pc.removeTrack(sender);
              debugLog(`[Conference] Removed audio track from peer connection ${peerId}`);

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
  }, [isInConference, localStreamRef, peerConnectionsRef, sendRawAudio, setSendRawAudio, wsRef]);

  return { toggleSendRawAudio };
};
