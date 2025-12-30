import { useCallback } from 'react';
import { debugLog, infoLog } from '../../debug-utils';
import { GeminiLiveAudioStream, GEMINI_LANGUAGE_MAP } from '../../gemini-live-audio';
import { arrayBufferToBase64 } from '../utils';
import type { Participant } from '../../types';
import type { ConferenceRefs, ConferenceState } from '../useConferenceState';
import { useGeminiFallback } from './useGeminiFallback';
import { startSoloGeminiSession } from './soloSession';
import { createGeminiTextHandler } from './textHandlers';
import { applyGeminiTokenUsageUpdate } from './usageTracking';

type GeminiSessionParams = {
  state: Pick<
    ConferenceState,
    | 'apiKey'
    | 'username'
    | 'myLanguage'
    | 'translationSpeedSettings'
    | 'setTranslations'
    | 'setApiUsageStats'
    | 'setErrorMessage'
    | 'setShowErrorModal'
  >;
  refs: Pick<
    ConferenceRefs,
    | 'liveAudioStreamRef'
    | 'localStreamRef'
    | 'isStartingGeminiRef'
    | 'currentSourceLanguageRef'
    | 'currentTargetLanguageRef'
    | 'isSoloModeRef'
    | 'pendingFallbackTimerRef'
    | 'lastOutputTimestampRef'
    | 'inputTranscriptBufferRef'
    | 'inputTranscriptTimeoutRef'
    | 'pendingFallbackInputTimestampRef'
    | 'lastInputTimestampRef'
    | 'wsRef'
    | 'isLocalPlaybackEnabledRef'
    | 'clientIdRef'
  >;
};

export const useGeminiSession = ({ state, refs }: GeminiSessionParams) => {
  const {
    apiKey,
    username,
    myLanguage,
    translationSpeedSettings,
    setTranslations,
    setApiUsageStats,
    setErrorMessage,
    setShowErrorModal
  } = state;
  const {
    liveAudioStreamRef,
    localStreamRef,
    isStartingGeminiRef,
    currentSourceLanguageRef,
    currentTargetLanguageRef,
    isSoloModeRef,
    pendingFallbackTimerRef,
    lastOutputTimestampRef,
    inputTranscriptBufferRef,
    inputTranscriptTimeoutRef,
    pendingFallbackInputTimestampRef,
    lastInputTimestampRef,
    wsRef,
    isLocalPlaybackEnabledRef,
    clientIdRef
  } = refs;

  const { handleInputTranscription } = useGeminiFallback({
    apiKey,
    state: { translationSpeedSettings, username, setTranslations },
    refs: {
      inputTranscriptBufferRef,
      inputTranscriptTimeoutRef,
      pendingFallbackTimerRef,
      pendingFallbackInputTimestampRef,
      lastOutputTimestampRef,
      lastInputTimestampRef,
      currentSourceLanguageRef,
      currentTargetLanguageRef,
      wsRef
    }
  });

  const sendTranslatedAudioToParticipants = useCallback(async (audioData: ArrayBuffer) => {
    try {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        console.warn('[Conference] WebSocket not available, cannot send translated audio');
        return;
      }

      debugLog(`?? [Audio Send] Converting ${audioData.byteLength} bytes to Base64...`);
      const base64Audio = arrayBufferToBase64(audioData);

      debugLog(`?? [Audio Send] Base64 conversion completed: ${base64Audio.length} characters`);
      debugLog(`?? [Audio Send] Base64 preview: ${base64Audio.substring(0, 100)}...`);

      infoLog(`?? [Audio Send] Sending translated audio (${audioData.byteLength} bytes)`);
      debugLog(`[Conference] Sending translated audio to participants (${audioData.byteLength} bytes)`);

      wsRef.current.send(JSON.stringify({
        type: 'translated-audio',
        audioData: base64Audio,
        audioFormat: 'pcm-24khz-16bit',
        from: username,
        fromLanguage: myLanguage,
        timestamp: Date.now()
      }));

      debugLog('[Conference] Translated audio sent to participants');
    } catch (error) {
      console.error('[Conference] Failed to send translated audio:', error);
    }
  }, [myLanguage, username, wsRef]);

  const updateGeminiTargetLanguage = useCallback(async (currentParticipants: Participant[]) => {
    const otherParticipants = currentParticipants.filter(p => p.clientId !== clientIdRef.current);
    debugLog('[Conference] Updating Gemini target', {
      participants: currentParticipants.length,
      otherParticipants: otherParticipants.length,
      isSoloMode: isSoloModeRef.current
    });

    if (otherParticipants.length === 0) {
      const sourceLanguage = GEMINI_LANGUAGE_MAP[myLanguage] || 'English';
      const soloTargetLanguageCode = myLanguage === 'english' ? 'japanese' : 'english';
      const targetLanguage = GEMINI_LANGUAGE_MAP[soloTargetLanguageCode] || 'English';

      if (isSoloModeRef.current && liveAudioStreamRef.current) {
        const currentTargetLanguage = liveAudioStreamRef.current.getCurrentTargetLanguage();
        if (
          currentTargetLanguage === targetLanguage &&
          currentSourceLanguageRef.current === myLanguage &&
          currentTargetLanguageRef.current === soloTargetLanguageCode
        ) {
          debugLog('[Conference] Solo session already active, skipping restart');
          return;
        }
      }

      debugLog('[Conference] Starting solo session with Gemini');
      infoLog('?? [Solo Session] Active (no other participants)');
      infoLog(`?? My Language: ${myLanguage} -> ${sourceLanguage}`);
      infoLog(`?? Gemini Target: ${targetLanguage} (solo mode)`);
      infoLog(`?? Translation Direction: ${sourceLanguage} -> ${targetLanguage}`);

      const started = await startSoloGeminiSession({
        apiKey,
        sourceLanguage,
        targetLanguage,
        state: { setTranslations },
        refs: {
          liveAudioStreamRef,
          localStreamRef,
          isStartingGeminiRef,
          isLocalPlaybackEnabledRef
        }
      });
      if (started) {
        currentSourceLanguageRef.current = myLanguage;
        currentTargetLanguageRef.current = soloTargetLanguageCode;
        isSoloModeRef.current = true;
      } else {
        isSoloModeRef.current = false;
      }
      return;
    }

    if (isSoloModeRef.current && liveAudioStreamRef.current) {
      debugLog('[Conference] Switching from solo to peer translation; restarting session');
      await liveAudioStreamRef.current.stop();
      liveAudioStreamRef.current = null;
    }
    isSoloModeRef.current = false;

    const primaryTarget = otherParticipants[0].language;
    const targetLanguage = GEMINI_LANGUAGE_MAP[primaryTarget] || 'English';
    const sourceLanguage = GEMINI_LANGUAGE_MAP[myLanguage] || 'English';
    currentSourceLanguageRef.current = myLanguage;
    currentTargetLanguageRef.current = primaryTarget;

    infoLog(`?? [Translation Setup] Session Started`);
    infoLog(`?? My Language: ${myLanguage} -> ${sourceLanguage}`);
    infoLog(`?? Participant Language: ${primaryTarget} -> ${targetLanguage}`);
    infoLog(`?? Translation Direction: ${sourceLanguage} -> ${targetLanguage}`);

    debugLog(`[Conference] Language mapping debug:`);
    debugLog(`[Conference] - My language: ${myLanguage} -> ${sourceLanguage}`);
    debugLog(`[Conference] - Participant language: ${primaryTarget} -> ${targetLanguage}`);

    if (!liveAudioStreamRef.current) {
      debugLog(`[Conference] Creating new Gemini Live Audio session: ${sourceLanguage} -> ${targetLanguage}`);

      if (!apiKey || !localStreamRef.current) {
        console.warn('[Conference] Cannot start Gemini Live Audio - missing API key or local stream');
        return;
      }

      try {
        setApiUsageStats(prev => ({
          ...prev,
          sessionCount: (prev.sessionCount || 0) + 1
        }));

        const otherLanguages = otherParticipants.map(p => GEMINI_LANGUAGE_MAP[p.language] || 'english');
        const onTextReceived = createGeminiTextHandler({
          apiKey,
          username,
          myLanguage,
          otherParticipants,
          state: { setTranslations },
          refs: { pendingFallbackTimerRef, lastOutputTimestampRef, wsRef }
        });

        liveAudioStreamRef.current = new GeminiLiveAudioStream({
          apiKey,
          sourceLanguage,
          targetLanguage,
          localPlaybackEnabled: isLocalPlaybackEnabledRef.current,
          sendInterval: translationSpeedSettings.sendInterval,
          textBufferDelay: translationSpeedSettings.textBufferDelay,
          otherParticipantLanguages: otherLanguages,
          usePeerTranslation: true,
          onAudioReceived: async (audioData) => {
            debugLog('[Conference] Received translated audio (handled by GeminiLiveAudioStream internally)');
            await sendTranslatedAudioToParticipants(audioData);
          },
          onTextReceived,
          onInputTranscription: handleInputTranscription,
          onTokenUsage: (usage) => applyGeminiTokenUsageUpdate({ setApiUsageStats }, usage),
          onError: (error) => {
            console.error('[Conference] Gemini Live Audio error:', error);
            setErrorMessage(error.message);
            setShowErrorModal(true);
          }
        });

        await liveAudioStreamRef.current.start(localStreamRef.current);
        debugLog('[Conference] Gemini Live Audio session started successfully');
      } catch (error) {
        console.error('[Conference] Failed to start Gemini Live Audio session:', error);
        liveAudioStreamRef.current = null;
      }
    } else {
      const otherLanguages = otherParticipants.map(p => GEMINI_LANGUAGE_MAP[p.language] || 'english');
      debugLog(`[Conference] Updating Gemini session with participant languages:`, otherLanguages);

      if (liveAudioStreamRef.current.updateOtherParticipantLanguages) {
        liveAudioStreamRef.current.updateOtherParticipantLanguages(otherLanguages);
      } else {
        const currentTargetLanguage = liveAudioStreamRef.current.getCurrentTargetLanguage();
        if (targetLanguage !== currentTargetLanguage) {
          debugLog(`[Conference] Updating Gemini target language: ${currentTargetLanguage} -> ${targetLanguage}`);
          await liveAudioStreamRef.current.updateTargetLanguage(targetLanguage);
        } else {
          debugLog(`[Conference] Target language already set to ${targetLanguage}, no update needed`);
        }
      }
    }
  }, [
    apiKey,
    clientIdRef,
    currentSourceLanguageRef,
    currentTargetLanguageRef,
    handleInputTranscription,
    isLocalPlaybackEnabledRef,
    isSoloModeRef,
    lastOutputTimestampRef,
    liveAudioStreamRef,
    localStreamRef,
    myLanguage,
    pendingFallbackTimerRef,
    sendTranslatedAudioToParticipants,
    setApiUsageStats,
    setErrorMessage,
    setShowErrorModal,
    setTranslations,
    translationSpeedSettings.sendInterval,
    translationSpeedSettings.textBufferDelay,
    username,
    wsRef
  ]);

  return {
    updateGeminiTargetLanguage,
    sendTranslatedAudioToParticipants
  };
};
