import { useCallback } from 'react';
import { debugError, debugLog, debugWarn } from '../../debug-utils';
import { getTextRetranslationService } from '../../text-retranslation-service';
import type { Translation } from '../../types';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type GeminiFallbackParams = {
  apiKey: string;
  state: Pick<ConferenceState, 'translationSpeedSettings' | 'username' | 'setTranslations'>;
  refs: Pick<
    ConferenceRefs,
    | 'inputTranscriptBufferRef'
    | 'inputTranscriptTimeoutRef'
    | 'pendingFallbackTimerRef'
    | 'pendingFallbackInputTimestampRef'
    | 'lastOutputTimestampRef'
    | 'lastInputTimestampRef'
    | 'currentSourceLanguageRef'
    | 'currentTargetLanguageRef'
    | 'wsRef'
  >;
};

export const useGeminiFallback = ({ apiKey, state, refs }: GeminiFallbackParams) => {
  const { translationSpeedSettings, username, setTranslations } = state;
  const {
    inputTranscriptBufferRef,
    inputTranscriptTimeoutRef,
    pendingFallbackTimerRef,
    pendingFallbackInputTimestampRef,
    lastOutputTimestampRef,
    lastInputTimestampRef,
    currentSourceLanguageRef,
    currentTargetLanguageRef,
    wsRef
  } = refs;

  const handleInputTranscription = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    inputTranscriptBufferRef.current.push(trimmed);
    lastInputTimestampRef.current = Date.now();

    if (inputTranscriptTimeoutRef.current) {
      clearTimeout(inputTranscriptTimeoutRef.current);
    }

    const flushDelay = Math.max(800, translationSpeedSettings.textBufferDelay);
    inputTranscriptTimeoutRef.current = setTimeout(() => {
      const combined = inputTranscriptBufferRef.current
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      inputTranscriptBufferRef.current = [];
      if (!combined) {
        return;
      }

      const inputTimestamp = lastInputTimestampRef.current;
      if (pendingFallbackTimerRef.current) {
        clearTimeout(pendingFallbackTimerRef.current);
      }
      pendingFallbackInputTimestampRef.current = inputTimestamp;

      const fallbackDelayMs = 2000;
      pendingFallbackTimerRef.current = setTimeout(async () => {
        if (lastOutputTimestampRef.current >= inputTimestamp) {
          return;
        }
        if (pendingFallbackInputTimestampRef.current !== inputTimestamp) {
          return;
        }

        try {
          const sourceLanguage = currentSourceLanguageRef.current;
          const targetLanguage = currentTargetLanguageRef.current;
          const translationService = getTextRetranslationService(apiKey);
          const result = await translationService.translateText(combined, sourceLanguage, targetLanguage);

          if (!result.success || !result.retranslatedText.trim()) {
            debugWarn('?? [Fallback Translation] Failed:', result.error);
            return;
          }

          const translatedText = result.retranslatedText.trim();
          const fallbackTranslation: Translation = {
            id: Date.now(),
            from: username,
            fromLanguage: sourceLanguage,
            original: translatedText,
            translation: translatedText,
            originalLanguageText: combined,
            timestamp: new Date().toLocaleTimeString()
          };

          debugLog('?? [Fallback Translation] Adding translation to state:', fallbackTranslation);
          setTranslations(prev => [...prev, fallbackTranslation]);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'translation',
              translation: fallbackTranslation
            }));
          }

          lastOutputTimestampRef.current = Date.now();
          pendingFallbackTimerRef.current = null;
        } catch (error) {
          debugError('? [Fallback Translation] Error:', error);
        }
      }, fallbackDelayMs);
    }, flushDelay);
  }, [
    apiKey,
    currentSourceLanguageRef,
    currentTargetLanguageRef,
    inputTranscriptBufferRef,
    inputTranscriptTimeoutRef,
    lastInputTimestampRef,
    lastOutputTimestampRef,
    pendingFallbackInputTimestampRef,
    pendingFallbackTimerRef,
    setTranslations,
    translationSpeedSettings.textBufferDelay,
    username,
    wsRef
  ]);

  return { handleInputTranscription };
};
