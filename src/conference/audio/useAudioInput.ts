import { useCallback } from 'react';
import { debugLog } from '../../debug-utils';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type AudioInputParams = {
  state: Pick<
    ConferenceState,
    | 'isMuted'
    | 'setIsMuted'
  >;
  refs: Pick<ConferenceRefs, 'localStreamRef' | 'peerConnectionsRef' | 'testAudioRef'>;
  setupNoiseFilterChain: (stream: MediaStream) => MediaStream;
  cleanupNoiseFilterChain: () => void;
  setupAudioLevelDetection: (stream: MediaStream) => void;
};

export const useAudioInput = ({
  state,
  refs,
  setupNoiseFilterChain,
  cleanupNoiseFilterChain,
  setupAudioLevelDetection
}: AudioInputParams) => {
  const { isMuted, setIsMuted } = state;
  const { localStreamRef, peerConnectionsRef, testAudioRef } = refs;

  const replaceLocalAudioInputStream = useCallback((rawStream: MediaStream) => {
    const usingTestAudio = Boolean(testAudioRef.current);
    const processedStream = usingTestAudio ? rawStream : setupNoiseFilterChain(rawStream);
    const newAudioTrack = processedStream.getAudioTracks()[0];

    if (newAudioTrack) {
      const shouldMute = !usingTestAudio && isMuted;
      newAudioTrack.enabled = !shouldMute;
      if (usingTestAudio && isMuted) {
        setIsMuted(false);
        debugLog('[TestAudio] Forcing unmute while using test audio stream');
      }
      Object.values(peerConnectionsRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) {
          sender.replaceTrack(newAudioTrack);
        }
      });
    }

    const existingTrack = localStreamRef.current?.getAudioTracks()[0];
    if (existingTrack) {
      existingTrack.stop();
    }

    localStreamRef.current = processedStream;
    if (!usingTestAudio) {
      setupAudioLevelDetection(rawStream);
    } else {
      cleanupNoiseFilterChain();
    }
    debugLog('[Conference] Local audio stream updated', {
      enabled: newAudioTrack?.enabled ?? false,
      muted: newAudioTrack?.muted ?? false,
      readyState: newAudioTrack?.readyState ?? 'unknown',
      label: newAudioTrack?.label ?? '',
      isMuted,
      hasTestAudio: Boolean(testAudioRef.current)
    });
  }, [
    cleanupNoiseFilterChain,
    isMuted,
    localStreamRef,
    peerConnectionsRef,
    setIsMuted,
    setupAudioLevelDetection,
    setupNoiseFilterChain,
    testAudioRef
  ]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const nextMuted = !audioTrack.enabled;
        setIsMuted(nextMuted);
        debugLog('[Conference] Microphone mute toggled', {
          muted: nextMuted,
          enabled: audioTrack.enabled
        });
      }
    }
  }, [localStreamRef, setIsMuted]);

  return {
    replaceLocalAudioInputStream,
    toggleMute
  };
};
