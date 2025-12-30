import { useCallback } from 'react';
import { debugError, debugLog, debugWarn } from '../../debug-utils';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type NoiseFilterParams = {
  state: Pick<ConferenceState, 'noiseFilterSettings'>;
  refs: Pick<
    ConferenceRefs,
    | 'audioContextRef'
    | 'sourceNodeRef'
    | 'highPassFilterRef'
    | 'lowPassFilterRef'
    | 'compressorRef'
    | 'gainNodeRef'
    | 'destinationRef'
    | 'filteredStreamRef'
  >;
};

export const useNoiseFilter = ({ state, refs }: NoiseFilterParams) => {
  const { noiseFilterSettings } = state;
  const {
    audioContextRef,
    sourceNodeRef,
    highPassFilterRef,
    lowPassFilterRef,
    compressorRef,
    gainNodeRef,
    destinationRef,
    filteredStreamRef
  } = refs;

  const cleanupNoiseFilterChain = useCallback(() => {
    try {
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
        sourceNodeRef.current = null;
      }
      if (highPassFilterRef.current) {
        highPassFilterRef.current.disconnect();
        highPassFilterRef.current = null;
      }
      if (lowPassFilterRef.current) {
        lowPassFilterRef.current.disconnect();
        lowPassFilterRef.current = null;
      }
      if (compressorRef.current) {
        compressorRef.current.disconnect();
        compressorRef.current = null;
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
        gainNodeRef.current = null;
      }
      if (destinationRef.current) {
        destinationRef.current.disconnect();
        destinationRef.current = null;
      }
      filteredStreamRef.current = null;
      debugLog('[NoiseFilter] Noise filter chain cleaned up');
    } catch (error) {
      debugError('Error cleaning up noise filter chain:', error);
    }
  }, [
    sourceNodeRef,
    highPassFilterRef,
    lowPassFilterRef,
    compressorRef,
    gainNodeRef,
    destinationRef,
    filteredStreamRef
  ]);

  const setupNoiseFilterChain = useCallback((stream: MediaStream): MediaStream => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    try {
      debugLog('[NoiseFilter] Setting up noise filter chain');
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(error => {
          debugWarn('[NoiseFilter] Failed to resume AudioContext:', error);
        });
      }

      cleanupNoiseFilterChain();

      sourceNodeRef.current = audioContext.createMediaStreamSource(stream);
      highPassFilterRef.current = audioContext.createBiquadFilter();
      lowPassFilterRef.current = audioContext.createBiquadFilter();
      compressorRef.current = audioContext.createDynamicsCompressor();
      gainNodeRef.current = audioContext.createGain();
      destinationRef.current = audioContext.createMediaStreamDestination();

      highPassFilterRef.current.type = 'highpass';
      highPassFilterRef.current.frequency.setValueAtTime(noiseFilterSettings.highPassFrequency, audioContext.currentTime);
      highPassFilterRef.current.Q.setValueAtTime(0.7, audioContext.currentTime);

      lowPassFilterRef.current.type = 'lowpass';
      lowPassFilterRef.current.frequency.setValueAtTime(noiseFilterSettings.lowPassFrequency, audioContext.currentTime);
      lowPassFilterRef.current.Q.setValueAtTime(0.7, audioContext.currentTime);

      compressorRef.current.threshold.setValueAtTime(-24, audioContext.currentTime);
      compressorRef.current.knee.setValueAtTime(30, audioContext.currentTime);
      compressorRef.current.ratio.setValueAtTime(noiseFilterSettings.compressionRatio, audioContext.currentTime);
      compressorRef.current.attack.setValueAtTime(0.003, audioContext.currentTime);
      compressorRef.current.release.setValueAtTime(0.25, audioContext.currentTime);

      const gainValue = Math.pow(10, noiseFilterSettings.gainReduction / 20);
      gainNodeRef.current.gain.setValueAtTime(gainValue, audioContext.currentTime);

      if (noiseFilterSettings.enabled) {
        sourceNodeRef.current
          .connect(highPassFilterRef.current)
          .connect(lowPassFilterRef.current)
          .connect(compressorRef.current)
          .connect(gainNodeRef.current)
          .connect(destinationRef.current);

        debugLog('[NoiseFilter] Noise filter chain enabled');
      } else {
        sourceNodeRef.current.connect(destinationRef.current);
        debugLog('[NoiseFilter] Noise filter chain bypassed');
      }

      filteredStreamRef.current = destinationRef.current.stream;
      debugLog('[NoiseFilter] Noise filter chain setup complete');

      return filteredStreamRef.current;
    } catch (error) {
      debugError('Error setting up noise filter chain:', error);
      return stream;
    }
  }, [
    audioContextRef,
    cleanupNoiseFilterChain,
    sourceNodeRef,
    highPassFilterRef,
    lowPassFilterRef,
    compressorRef,
    gainNodeRef,
    destinationRef,
    filteredStreamRef,
    noiseFilterSettings
  ]);

  return { setupNoiseFilterChain, cleanupNoiseFilterChain };
};
