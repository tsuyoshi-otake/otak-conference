import { debugError, debugLog, debugWarn } from '../../debug-utils';
import { GeminiLiveAudioStream } from '../../gemini-live-audio';
import type { Translation } from '../../types';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';

type SoloSessionParams = {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  state: Pick<ConferenceState, 'setTranslations'>;
  refs: Pick<
    ConferenceRefs,
    'liveAudioStreamRef' | 'localStreamRef' | 'isStartingGeminiRef' | 'isLocalPlaybackEnabledRef'
  >;
};

export const startSoloGeminiSession = async ({
  apiKey,
  sourceLanguage,
  targetLanguage,
  state,
  refs
}: SoloSessionParams): Promise<boolean> => {
  const { setTranslations } = state;
  const { liveAudioStreamRef, localStreamRef, isStartingGeminiRef, isLocalPlaybackEnabledRef } = refs;

  if (isStartingGeminiRef.current) {
    debugLog('[Conference] Solo Gemini session start already in progress, skipping');
    return false;
  }
  isStartingGeminiRef.current = true;

  try {
    if (!apiKey || !localStreamRef.current) {
      console.warn('[Conference] Cannot start solo Gemini session - missing API key or local stream');
      debugWarn('[Conference] Solo session prerequisites missing', {
        hasApiKey: Boolean(apiKey),
        hasLocalStream: Boolean(localStreamRef.current)
      });
      return false;
    }

    if (liveAudioStreamRef.current) {
      debugLog('[Conference] Stopping existing Gemini Live Audio stream before solo session');
      await liveAudioStreamRef.current.stop();
      liveAudioStreamRef.current = null;
    }

    debugLog(`[Conference] Creating solo Gemini Live Audio session: ${sourceLanguage} -> ${targetLanguage}`);

    liveAudioStreamRef.current = new GeminiLiveAudioStream({
      apiKey,
      sourceLanguage,
      targetLanguage,
      localPlaybackEnabled: isLocalPlaybackEnabledRef.current,
      otherParticipantLanguages: [],
      usePeerTranslation: false,
      onAudioReceived: async () => {
        try {
          debugLog('[Conference] Solo mode - Received translated audio from Gemini');
        } catch (error) {
          debugError('[Conference] Solo mode - Error handling audio:', error);
        }
      },
      onTextReceived: (text) => {
        try {
          debugLog('?? [Solo Mode] Received translated text:', text);
          debugLog('[Conference] Solo mode - Translated text received:', text);

          const newTranslation: Translation = {
            id: Date.now(),
            from: 'Gemini AI',
            fromLanguage: targetLanguage,
            original: text,
            translation: text,
            timestamp: new Date().toLocaleTimeString()
          };

          setTranslations(prev => [...prev, newTranslation]);
        } catch (error) {
          debugError('[Conference] Solo mode - Error handling text:', error);
        }
      }
    });

    if (liveAudioStreamRef.current) {
      debugLog('[Conference] Solo session callbacks configured');
    }

    await liveAudioStreamRef.current.start(localStreamRef.current);
    debugLog('[Conference] Solo Gemini Live Audio session started successfully');
    return true;
  } catch (error) {
    console.error('[Conference] Failed to start solo Gemini session:', error);
    liveAudioStreamRef.current = null;
    return false;
  } finally {
    isStartingGeminiRef.current = false;
  }
};
