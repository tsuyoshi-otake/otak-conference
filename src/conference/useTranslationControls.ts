import { useCallback, useEffect } from 'react';
import { debugLog } from '../debug-utils';
import { TranslationSpeedMode, VoiceSettings } from '../types';
import { getTranslationSpeedSettings } from './translationSpeed';
import type { ConferenceRefs, ConferenceState } from './useConferenceState';

type TranslationControlsParams = {
  state: Pick<
    ConferenceState,
    | 'isAudioTranslationEnabled'
    | 'setIsAudioTranslationEnabled'
    | 'voiceSettings'
    | 'setVoiceSettings'
    | 'translationSpeedMode'
    | 'setTranslationSpeedMode'
    | 'translationSpeedSettings'
    | 'setTranslationSpeedSettings'
  >;
  refs: Pick<ConferenceRefs, 'isAudioTranslationEnabledRef' | 'liveAudioStreamRef'>;
};

export const useTranslationControls = ({ state, refs }: TranslationControlsParams) => {
  const {
    isAudioTranslationEnabled,
    setIsAudioTranslationEnabled,
    setVoiceSettings,
    setTranslationSpeedMode,
    setTranslationSpeedSettings
  } = state;
  const { isAudioTranslationEnabledRef, liveAudioStreamRef } = refs;

  const toggleAudioTranslation = useCallback(() => {
    setIsAudioTranslationEnabled(prev => {
      const next = !prev;
      isAudioTranslationEnabledRef.current = next;
      return next;
    });
  }, [setIsAudioTranslationEnabled, isAudioTranslationEnabledRef]);

  useEffect(() => {
    isAudioTranslationEnabledRef.current = isAudioTranslationEnabled;
  }, [isAudioTranslationEnabled, isAudioTranslationEnabledRef]);

  const updateVoiceSettings = useCallback((newSettings: Partial<VoiceSettings>) => {
    setVoiceSettings(prev => ({ ...prev, ...newSettings }));
  }, [setVoiceSettings]);

  const updateTranslationSpeedMode = useCallback((mode: TranslationSpeedMode) => {
    const settings = getTranslationSpeedSettings(mode);
    setTranslationSpeedMode(mode);
    setTranslationSpeedSettings(settings);

    if (liveAudioStreamRef.current) {
      liveAudioStreamRef.current.updateSpeedSettings(settings.sendInterval, settings.textBufferDelay);
    }

    debugLog(
      `[Translation Speed] Updated to ${mode} mode - Send: ${settings.sendInterval}ms, Buffer: ${settings.textBufferDelay}ms`
    );
  }, [setTranslationSpeedMode, setTranslationSpeedSettings, liveAudioStreamRef]);

  return { toggleAudioTranslation, updateVoiceSettings, updateTranslationSpeedMode };
};
