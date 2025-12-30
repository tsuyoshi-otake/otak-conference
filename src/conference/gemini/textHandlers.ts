import { debugError, debugLog, debugWarn } from '../../debug-utils';
import { getTextRetranslationService } from '../../text-retranslation-service';
import type { Participant, Translation } from '../../types';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type TextHandlerParams = {
  apiKey: string;
  username: string;
  myLanguage: string;
  otherParticipants: Participant[];
  state: Pick<ConferenceState, 'setTranslations'>;
  refs: Pick<ConferenceRefs, 'pendingFallbackTimerRef' | 'lastOutputTimestampRef' | 'wsRef'>;
};

export const createGeminiTextHandler = ({
  apiKey,
  username,
  myLanguage,
  otherParticipants,
  state,
  refs
}: TextHandlerParams) => {
  const { setTranslations } = state;
  const { pendingFallbackTimerRef, lastOutputTimestampRef, wsRef } = refs;

  return (text: string) => {
    lastOutputTimestampRef.current = Date.now();
    if (pendingFallbackTimerRef.current) {
      clearTimeout(pendingFallbackTimerRef.current);
      pendingFallbackTimerRef.current = null;
    }
    debugLog('?? [HOOKS] onTextReceived called with text:', text);
    debugLog('[Conference] Translated text received:', text);

    const newTranslation: Translation = {
      id: Date.now(),
      from: username,
      fromLanguage: myLanguage,
      original: text,
      translation: text,
      timestamp: new Date().toLocaleTimeString()
    };

    debugLog('?? [HOOKS] Adding translation to state:', newTranslation);
    setTranslations(prev => {
      const updated = [...prev, newTranslation];
      debugLog('?? [HOOKS] Updated translations array length:', updated.length);
      return updated;
    });
    debugLog('? [HOOKS] Translation added to state');

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const translationMessage = {
        type: 'translation',
        translation: newTranslation
      };
      debugLog('?? [HOOKS] Sending translation to participants:', translationMessage);
      wsRef.current.send(JSON.stringify(translationMessage));
    }

    (async () => {
      try {
        const retranslationService = getTextRetranslationService(apiKey);
        const targetLanguage = otherParticipants.length > 0
          ? otherParticipants[0].language
          : 'english';

        const result = await retranslationService.retranslateToSpeakerLanguage(
          text,
          targetLanguage,
          myLanguage
        );

        if (result.success) {
          debugLog('?? [Text Retranslation] Success:', result.retranslatedText);
          setTranslations(prev =>
            prev.map(t =>
              t.id === newTranslation.id
                ? { ...t, originalLanguageText: result.retranslatedText }
                : t
            )
          );
        } else {
          debugWarn('?? [Text Retranslation] Failed:', result.error);
        }
      } catch (error) {
        debugError('? [Text Retranslation] Error:', error);
      }
    })();
  };
};
