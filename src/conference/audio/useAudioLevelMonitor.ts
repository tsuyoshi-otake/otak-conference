import { useCallback } from 'react';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type AudioLevelParams = {
  state: Pick<ConferenceState, 'participants' | 'setParticipants' | 'noiseFilterSettings' | 'username'>;
  refs: Pick<
    ConferenceRefs,
    | 'audioAnalyzerRef'
    | 'audioDataRef'
    | 'lastSpeakingStatusRef'
    | 'lastSpeakingUpdateRef'
    | 'localStreamRef'
    | 'filteredStreamRef'
    | 'audioContextRef'
    | 'wsRef'
    | 'clientIdRef'
  >;
};

export const useAudioLevelMonitor = ({ state, refs }: AudioLevelParams) => {
  const { setParticipants, noiseFilterSettings, username } = state;
  const {
    audioAnalyzerRef,
    audioDataRef,
    lastSpeakingStatusRef,
    lastSpeakingUpdateRef,
    localStreamRef,
    filteredStreamRef,
    audioContextRef,
    wsRef,
    clientIdRef
  } = refs;

  const monitorAudioLevel = useCallback(() => {
    if (!audioAnalyzerRef.current || !audioDataRef.current) return;

    const checkAudioLevel = () => {
      if (!audioAnalyzerRef.current || !audioDataRef.current || !localStreamRef.current) return;

      audioAnalyzerRef.current.getByteFrequencyData(audioDataRef.current as any);
      const average = audioDataRef.current.reduce((acc, value) => acc + value, 0) / audioDataRef.current.length;

      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      const isAudioEnabled = audioTrack ? audioTrack.enabled : false;
      const isSpeaking = average > 5 && isAudioEnabled;

      setParticipants(prev => prev.map(p =>
        p.clientId === clientIdRef.current
          ? { ...p, isSpeaking, audioLevel: average }
          : p
      ));

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const now = Date.now();
        const statusChanged = lastSpeakingStatusRef.current !== isSpeaking;
        const timeSinceLastUpdate = now - lastSpeakingUpdateRef.current;

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
  }, [
    audioAnalyzerRef,
    audioDataRef,
    lastSpeakingStatusRef,
    lastSpeakingUpdateRef,
    localStreamRef,
    wsRef,
    clientIdRef,
    setParticipants,
    username
  ]);

  const setupAudioLevelDetection = useCallback((stream: MediaStream) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    try {
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

      monitorAudioLevel();
    } catch (error) {
      console.error('Error setting up audio level detection:', error);
    }
  }, [
    audioContextRef,
    audioAnalyzerRef,
    audioDataRef,
    filteredStreamRef,
    noiseFilterSettings.enabled,
    monitorAudioLevel
  ]);

  return { setupAudioLevelDetection };
};
