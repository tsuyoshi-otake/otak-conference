import { useCallback } from 'react';
import { debugLog, debugWarn } from '../../debug-utils';
import type { ConferenceRefs, ConferenceState, NormalizedTestAudioOptions, TestAudioState } from '../useConferenceState';

export type TestAudioOptions = {
  loop?: boolean;
  volume?: number;
  playbackRate?: number;
};

type AudioCaptureElement = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

type TestAudioParams = {
  state: Pick<ConferenceState, 'isInConference'>;
  refs: Pick<ConferenceRefs, 'testAudioRef' | 'audioContextRef' | 'liveAudioStreamRef'>;
  onTestAudioReady?: (stream: MediaStream) => void;
};

const normalizeTestAudioOptions = (options: TestAudioOptions = {}): NormalizedTestAudioOptions => ({
  loop: options.loop ?? false,
  volume: options.volume ?? 1,
  playbackRate: options.playbackRate ?? 1
});

export const useTestAudio = ({ state, refs, onTestAudioReady }: TestAudioParams) => {
  const { isInConference } = state;
  const { testAudioRef, audioContextRef, liveAudioStreamRef } = refs;

  const stopTestAudio = useCallback(() => {
    if (!testAudioRef.current) {
      return;
    }

    const { audio, stream, sourceNode, destination, endedHandler } = testAudioRef.current;
    try {
      audio.pause();
    } catch (error) {
      debugWarn('[TestAudio] Failed to pause audio element:', error);
    }

    if (endedHandler) {
      audio.removeEventListener('ended', endedHandler);
    }

    audio.removeAttribute('src');
    audio.load();

    try {
      sourceNode?.disconnect();
      destination?.disconnect();
    } catch (error) {
      debugWarn('[TestAudio] Failed to disconnect test audio nodes:', error);
    }

    stream.getTracks().forEach(track => track.stop());
    testAudioRef.current = null;
    debugLog('[TestAudio] Cleared test audio');
  }, [testAudioRef]);

  const createTestAudioStream = useCallback(async (
    url: string,
    options: TestAudioOptions = {}
  ): Promise<TestAudioState> => {
    const waitForAudioTrack = async (stream: MediaStream, timeoutMs: number = 2000) => {
      if (stream.getAudioTracks().length > 0) {
        return true;
      }
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (stream.getAudioTracks().length > 0) {
          return true;
        }
      }
      return false;
    };

    const normalizedOptions = normalizeTestAudioOptions(options);
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = url;
    audio.loop = normalizedOptions.loop;
    audio.volume = normalizedOptions.volume;
    audio.playbackRate = normalizedOptions.playbackRate;
    if (options.volume !== undefined) {
      audio.volume = options.volume;
    }
    if (options.playbackRate !== undefined) {
      audio.playbackRate = options.playbackRate;
    }
    audio.currentTime = 0;

    await new Promise<void>((resolve, reject) => {
      audio.addEventListener('canplay', () => resolve(), { once: true });
      audio.addEventListener('error', () => reject(new Error('Failed to load test audio')), { once: true });
    });

    const captureElement = audio as AudioCaptureElement;
    const capture = captureElement.captureStream?.bind(audio) || captureElement.mozCaptureStream?.bind(audio);
    if (!capture) {
      throw new Error('captureStream is not supported in this browser');
    }

    if (audio.readyState < 2) {
      await new Promise(resolve => {
        audio.addEventListener('loadeddata', resolve, { once: true });
      });
    }

    try {
      await audio.play();
    } catch (error) {
      debugWarn('[TestAudio] Autoplay blocked, click the page and call play again if needed:', error);
    }

    let stream = capture();
    let hasTrack = await waitForAudioTrack(stream);

    debugLog('[TestAudio] Loaded test audio', {
      url,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      loop: audio.loop,
      volume: audio.volume,
      playbackRate: audio.playbackRate,
      hasTrack
    });

    if (!hasTrack) {
      debugWarn('[TestAudio] captureStream returned no audio track, falling back to MediaElementSource');
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const audioContext = audioContextRef.current;
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (error) {
          debugWarn('[TestAudio] Failed to resume AudioContext:', error);
        }
      }
      const sourceNode = audioContext.createMediaElementSource(audio);
      const destination = audioContext.createMediaStreamDestination();
      sourceNode.connect(destination);
      stream = destination.stream;
      hasTrack = await waitForAudioTrack(stream, 1000);
      if (!hasTrack) {
        debugWarn('[TestAudio] MediaElementSource fallback still has no audio track');
      }
      return { stream, audio, url, sourceNode, destination, options: normalizedOptions };
    }

    return { stream, audio, url, options: normalizedOptions };
  }, [audioContextRef]);

  const setTestAudioUrl = useCallback(async (url: string, options: TestAudioOptions = {}) => {
    stopTestAudio();
    const testAudio = await createTestAudioStream(url, options);
    const endedHandler = () => {
      if (testAudio.options?.loop) {
        return;
      }
      const liveStream = liveAudioStreamRef.current;
      if (!liveStream) {
        return;
      }
      debugLog('[TestAudio] Playback ended, sending trailing silence');
      liveStream.sendTrailingSilence(1);
      liveStream.sendAudioStreamEnd();
    };

    testAudio.audio.addEventListener('ended', endedHandler);
    testAudioRef.current = { ...testAudio, endedHandler };
    debugLog('[TestAudio] Test audio ready', { url, inConference: isInConference });

    if (onTestAudioReady) {
      onTestAudioReady(testAudio.stream);
    }
  }, [createTestAudioStream, stopTestAudio, testAudioRef, liveAudioStreamRef, isInConference, onTestAudioReady]);

  const ensureTestAudioStream = useCallback(async () => {
    if (!testAudioRef.current) {
      return null;
    }

    const { stream, url, options } = testAudioRef.current;
    if (stream.getAudioTracks().length === 0) {
      debugWarn('[TestAudio] No audio tracks detected; recreating test audio stream', { url });
      await setTestAudioUrl(url, options);
    }

    return testAudioRef.current?.stream ?? null;
  }, [setTestAudioUrl, testAudioRef]);

  const getAudioInputStream = useCallback(async (audioConstraints: MediaTrackConstraints | boolean) => {
    if (testAudioRef.current?.stream) {
      const ensuredStream = await ensureTestAudioStream();
      if (!ensuredStream) {
        debugWarn('[TestAudio] Failed to prepare test audio stream, falling back to microphone');
      } else {
        debugLog('[TestAudio] Using test audio input stream', {
          url: testAudioRef.current?.url,
          tracks: ensuredStream.getAudioTracks().length
        });
        const { audio, stream } = testAudioRef.current;
        if (audio.paused) {
          if (audio.ended) {
            audio.currentTime = 0;
          }
          try {
            await audio.play();
          } catch (error) {
            debugWarn('[TestAudio] Autoplay blocked when starting stream:', error);
          }
        }
        return stream;
      }
    }

    debugLog('[Conference] Requesting microphone input', { audioConstraints });
    return navigator.mediaDevices.getUserMedia({
      audio: audioConstraints,
      video: false
    });
  }, [ensureTestAudioStream, testAudioRef]);

  return { setTestAudioUrl, stopTestAudio, ensureTestAudioStream, getAudioInputStream };
};
