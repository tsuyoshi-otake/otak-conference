import { useCallback } from 'react';
import { debugLog } from '../debug-utils';
import type { ConferenceRefs, ConferenceState } from './useConferenceState';

type ControlsParams = {
  state: Pick<
    ConferenceState,
    | 'isInConference'
    | 'selectedMicrophone'
    | 'noiseFilterSettings'
    | 'setNoiseFilterSettings'
    | 'isAudioTranslationEnabled'
    | 'isLocalPlaybackEnabled'
    | 'setIsLocalPlaybackEnabled'
  >;
  refs: Pick<ConferenceRefs, 'isLocalPlaybackEnabledRef' | 'liveAudioStreamRef' | 'localStreamRef'>;
  actions: {
    stopTestAudio: () => void;
    getAudioInputStream: (audioConstraints: MediaTrackConstraints | boolean) => Promise<MediaStream>;
    replaceLocalAudioInputStream: (stream: MediaStream) => void;
    changeMicrophone: (deviceId: string) => Promise<void>;
  };
};

export const useConferenceControls = ({ state, refs, actions }: ControlsParams) => {
  const {
    isInConference,
    selectedMicrophone,
    noiseFilterSettings,
    setNoiseFilterSettings,
    isAudioTranslationEnabled,
    isLocalPlaybackEnabled,
    setIsLocalPlaybackEnabled
  } = state;
  const { isLocalPlaybackEnabledRef, liveAudioStreamRef, localStreamRef } = refs;
  const { stopTestAudio, getAudioInputStream, replaceLocalAudioInputStream, changeMicrophone } = actions;

  const useMicrophoneInput = useCallback(async () => {
    stopTestAudio();
    if (!isInConference) {
      return;
    }

    const audioConstraints = selectedMicrophone
      ? { deviceId: { exact: selectedMicrophone } }
      : true;
    const rawStream = await getAudioInputStream(audioConstraints);
    replaceLocalAudioInputStream(rawStream);
  }, [
    getAudioInputStream,
    isInConference,
    replaceLocalAudioInputStream,
    selectedMicrophone,
    stopTestAudio
  ]);

  const toggleLocalPlayback = useCallback(() => {
    const newValue = !isLocalPlaybackEnabled;
    setIsLocalPlaybackEnabled(newValue);
    isLocalPlaybackEnabledRef.current = newValue;

    debugLog(`[Conference] Local playback of Gemini responses ${newValue ? 'enabled' : 'disabled'}`);

    if (liveAudioStreamRef.current) {
      liveAudioStreamRef.current.setLocalPlaybackEnabled(newValue);
    }
  }, [isLocalPlaybackEnabled, isLocalPlaybackEnabledRef, liveAudioStreamRef, setIsLocalPlaybackEnabled]);

  const updateNoiseFilterSettings = useCallback((newSettings: Partial<typeof noiseFilterSettings>) => {
    const updatedSettings = { ...noiseFilterSettings, ...newSettings };
    setNoiseFilterSettings(updatedSettings);

    if (isInConference && localStreamRef.current) {
      try {
        debugLog('[NoiseFilter] Updating filter settings during conference');
        changeMicrophone(selectedMicrophone || '');
      } catch (error) {
        debugLog('Error updating noise filter settings:', error);
      }
    }
  }, [
    changeMicrophone,
    isInConference,
    localStreamRef,
    noiseFilterSettings,
    selectedMicrophone,
    setNoiseFilterSettings
  ]);

  const toggleNoiseFilter = useCallback(() => {
    updateNoiseFilterSettings({ enabled: !noiseFilterSettings.enabled });
  }, [noiseFilterSettings.enabled, updateNoiseFilterSettings]);

  const generateTranslationAudio = useCallback(async () => {
    if (!isAudioTranslationEnabled) {
      return;
    }
    try {
      debugLog(`[Conference] Audio translation requested`);
    } catch (error) {
      console.error('Audio generation error:', error);
    }
  }, [isAudioTranslationEnabled]);

  return {
    useMicrophoneInput,
    toggleLocalPlayback,
    updateNoiseFilterSettings,
    toggleNoiseFilter,
    generateTranslationAudio
  };
};
