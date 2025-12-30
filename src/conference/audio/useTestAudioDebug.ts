import { useEffect } from 'react';
import { isLocalRuntime } from '../utils';
import type { ConferenceRefs } from '../useConferenceState';
import type { TestAudioOptions } from './useTestAudio';

type TestAudioDebugParams = {
  setTestAudioUrl: (url: string, options?: TestAudioOptions) => Promise<void>;
  stopTestAudio: () => void;
  useMicrophoneInput: () => Promise<void>;
  testAudioRef: ConferenceRefs['testAudioRef'];
};

export const useTestAudioDebug = ({ setTestAudioUrl, stopTestAudio, useMicrophoneInput, testAudioRef }: TestAudioDebugParams) => {
  useEffect(() => {
    if (!isLocalRuntime()) {
      return;
    }

    const api = {
      setTestAudioUrl: (url: string, options?: TestAudioOptions) => setTestAudioUrl(url, options),
      clearTestAudio: async () => {
        if (testAudioRef.current) {
          await useMicrophoneInput();
        } else {
          stopTestAudio();
        }
      },
      useMicrophone: () => useMicrophoneInput(),
      getStatus: () => ({
        active: Boolean(testAudioRef.current),
        url: testAudioRef.current?.url || null
      }),
      getDebug: () => ({
        active: Boolean(testAudioRef.current),
        url: testAudioRef.current?.url || null,
        paused: testAudioRef.current?.audio.paused ?? null,
        readyState: testAudioRef.current?.audio.readyState ?? null,
        trackCount: testAudioRef.current?.stream.getAudioTracks().length ?? 0,
        options: testAudioRef.current?.options ?? null
      })
    };

    (window as any).otakConferenceTest = api;

    return () => {
      if ((window as any).otakConferenceTest === api) {
        delete (window as any).otakConferenceTest;
      }
    };
  }, [setTestAudioUrl, stopTestAudio, testAudioRef, useMicrophoneInput]);
};
