import {
  LiveServerMessage,
  MediaResolution,
  Modality
} from '@google/genai';
import { debugError, debugLog, debugWarn, infoLog } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';
import { handleServerMessage } from './messageHandlers';
import { getSystemInstruction, resolveInputLanguageCode, resolveOutputLanguageCode } from './prompt';

export const initializeSession = async (state: GeminiLiveAudioState): Promise<void> => {
  const model = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
  debugLog(`[Gemini Live Audio] Initializing session with model: ${model}`);

  state.sessionConnected = false;
  state.sessionReady = false;
  state.sessionReadyPromise = new Promise((resolve) => {
    state.sessionReadyResolver = resolve;
  });

  // Get initial system instruction based on current mode
  const systemInstruction = getSystemInstruction(state);

  // Log system prompt for visibility
  debugLog('[Gemini Prompt] System Instruction Set');
  debugLog(`[Gemini Prompt] Prompt Preview: ${systemInstruction.substring(0, 200)}...`);

  debugLog(`[Gemini Live Audio] Setting system instruction for mode: ${state.config.targetLanguage}`);

  const inputLanguageCode = resolveInputLanguageCode(state);
  const outputLanguageCode = resolveOutputLanguageCode(state);
  const inputAudioTranscription = inputLanguageCode ? { languageCode: inputLanguageCode } : {};
  const outputAudioTranscription = outputLanguageCode ? { languageCode: outputLanguageCode } : {};
  const config = {
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    responseModalities: [Modality.AUDIO], // Keep audio only to avoid INVALID_ARGUMENT error
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    contextWindowCompression: {
      triggerTokens: '25600',
      slidingWindow: { targetTokens: '12800' }
    },
    inputAudioTranscription,
    outputAudioTranscription,
    enableAffectiveDialog: false,
    temperature: 0.2,
    topP: 0.8,
    maxOutputTokens: 256,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        }
      },
      ...(outputLanguageCode ? { languageCode: outputLanguageCode } : {})
    },
  };

  // Connecting to Gemini Live API
  debugLog('[Gemini Live Audio] Connecting to API...');
  state.session = await state.ai.live.connect({
    model,
    callbacks: {
      onopen: () => {
        debugLog('[Gemini Session] Connection established');
        debugLog('[Gemini Live Audio] Session opened successfully');
        infoLog('[Gemini Live Audio] Session opened');
        state.sessionConnected = true;
        state.sessionOpenTime = Date.now();
        state.lastSessionMessageTime = state.sessionOpenTime;
      },
      onmessage: (message: LiveServerMessage) => {
        state.lastSessionMessageTime = Date.now();
        // Commented out verbose message logging
        // console.log('[Gemini Session] MESSAGE RECEIVED:', {
        //   hasModelTurn: !!message.serverContent?.modelTurn,
        //   hasParts: !!message.serverContent?.modelTurn?.parts,
        //   turnComplete: message.serverContent?.turnComplete,
        //   setupComplete: !!message.setupComplete,
        //   hasAudio: !!message.serverContent?.modelTurn?.parts?.some(part => part.inlineData?.data),
        //   hasTranscription: !!message.serverContent?.outputTranscription,
        //   interrupted: !!message.serverContent?.interrupted
        // });

        debugLog('[Gemini Live Audio] Received message:', {
          hasModelTurn: !!message.serverContent?.modelTurn,
          hasParts: !!message.serverContent?.modelTurn?.parts,
          turnComplete: message.serverContent?.turnComplete,
          setupComplete: !!message.setupComplete
        });

        // Check if this is a setup complete message
        if (message.setupComplete) {
          debugLog('[Gemini Session] Setup completed - Session ready for audio input');
          debugLog('[Gemini Live Audio] Setup completed, session is ready');
          infoLog('[Gemini Live Audio] Session setup complete');
          state.sessionConnected = true;
          state.sessionReady = true;
          if (state.sessionReadyResolver) {
            state.sessionReadyResolver(true);
            state.sessionReadyResolver = null;
          }
        }

        handleServerMessage(state, message);
      },
      onerror: (e: ErrorEvent) => {
        console.error('[Gemini Session] ERROR:', e.message);
        console.error('[Gemini Live Audio] Error:', e.message);
        state.sessionConnected = false;
        state.sessionReady = false;
        if (state.sessionReadyResolver) {
          state.sessionReadyResolver(false);
          state.sessionReadyResolver = null;
        }

        // Check for quota error specifically
        if (e.message.includes('quota') || e.message.includes('exceeded')) {
          console.error('[Gemini Live Audio] API quota exceeded - translation service temporarily unavailable');
          state.config.onError?.(new Error('API quota exceeded. Please try again later or check your Gemini API billing settings.'));
        } else if (e.message.includes('API key expired') || e.message.includes('expired')) {
          console.error('[Gemini Live Audio] API key expired - please renew your API key');
          state.config.onError?.(new Error('API key expired. Please renew your Gemini API key in the settings.'));
        } else {
          state.config.onError?.(new Error(e.message));
        }
      },
      onclose: (e: CloseEvent) => {
        debugLog('[Gemini Live Audio] Session closed:', e.reason);
        state.sessionConnected = false;
        state.sessionReady = false;
        if (state.sessionReadyResolver) {
          state.sessionReadyResolver(false);
          state.sessionReadyResolver = null;
        }

        // Check for specific error types in close reason
        if (e.reason && (e.reason.includes('quota') || e.reason.includes('exceeded'))) {
          console.error('[Gemini Live Audio] Session closed due to quota limit');
          state.config.onError?.(new Error('API quota exceeded. Gemini API usage limit has been reached.'));
        } else if (e.reason && (e.reason.includes('API key expired') || e.reason.includes('expired'))) {
          console.error('[Gemini Live Audio] Session closed due to expired API key');
          state.config.onError?.(new Error('API key expired. Please renew your Gemini API key in the settings.'));
        } else if (e.reason && e.reason.includes('API key')) {
          console.error('[Gemini Live Audio] Session closed due to API key issue');
          state.config.onError?.(new Error('API key error. Please check your Gemini API key in the settings.'));
        }
      },
    },
    config
  });
  debugLog('[Gemini Live Audio] Session initialized, waiting for setup completion...');
};

export const waitForSessionReady = async (state: GeminiLiveAudioState, timeoutMs: number = 8000): Promise<boolean> => {
  if (state.sessionReady) {
    return true;
  }
  if (!state.sessionReadyPromise) {
    return false;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(false), timeoutMs);
  });

  const result = await Promise.race([state.sessionReadyPromise, timeoutPromise]);
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }
  return result;
};
