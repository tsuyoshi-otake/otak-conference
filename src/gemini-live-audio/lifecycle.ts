import { debugError, debugLog, debugWarn } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';
import { setupAudioProcessing } from './audioCapture';
import { resetDebugMetrics, startDebugTicker, stopDebugTicker } from './debug';
import { sendInitialPrompt } from './prompt';
import { initializeSession, waitForSessionReady } from './session';

export const startStream = async (state: GeminiLiveAudioState, mediaStream: MediaStream): Promise<void> => {
  try {
    debugLog('[Gemini Session] Session started');
    debugLog(`[Gemini Session] Source Language: ${state.config.sourceLanguage}`);
    debugLog(`[Gemini Session] Target Language: ${state.config.targetLanguage}`);

    debugLog('[Gemini Live Audio] Starting stream...');
    debugLog(`[Gemini Live Audio] Source Language: ${state.config.sourceLanguage}`);
    debugLog(`[Gemini Live Audio] Target Language: ${state.config.targetLanguage}`);

    resetDebugMetrics(state);
    state.mediaStream = mediaStream;
    // Initialize separate audio contexts for input and output (following Google's sample)
    state.inputAudioContext = new AudioContext({ sampleRate: 16000 });
    state.outputAudioContext = new AudioContext({ sampleRate: 24000 });
    if (state.outputAudioContext.state === 'suspended') {
      try {
        await state.outputAudioContext.resume();
        debugLog('[Gemini Live Audio] Resumed output audio context');
      } catch (error) {
        debugWarn('[Gemini Live Audio] Failed to resume output audio context:', error);
      }
    }
    state.inputSampleRate = state.inputAudioContext.sampleRate;
    if (state.inputSampleRate !== state.targetSampleRate) {
      debugWarn(`[Gemini Live Audio] Input sample rate ${state.inputSampleRate}Hz != ${state.targetSampleRate}Hz, will resample before send`);
    }

    // Create gain nodes for audio management
    state.inputNode = state.inputAudioContext.createGain();
    state.inputNode.gain.value = 0.00001;
    state.inputNode.connect(state.inputAudioContext.destination);
    state.outputNode = state.outputAudioContext.createGain();
    state.outputNode.connect(state.outputAudioContext.destination);

    // Initialize audio timing
    state.nextStartTime = state.outputAudioContext.currentTime;

    // Initialize the session
    debugLog('[Gemini Live Audio] About to initialize session...');
    await initializeSession(state);
    debugLog('[Gemini Live Audio] Session initialization completed');

    const sessionReady = await waitForSessionReady(state);
    if (!sessionReady) {
      debugWarn('[Gemini Live Audio] Session did not report ready state before audio setup');
      if (state.sessionConnected) {
        state.sessionReady = true;
      }
    }

    // Start processing audio from the media stream
    debugLog('[Gemini Live Audio] About to setup audio processing...');
    await setupAudioProcessing(state);
    debugLog('[Gemini Live Audio] Audio processing setup completed');

    startDebugTicker(state);

    // Send initial prompt to reinforce translation context
    setTimeout(() => {
      sendInitialPrompt();
    }, 1000);

    debugLog('[Gemini Live Audio] Stream started successfully');
  } catch (error) {
    console.error('[Gemini Live Audio] Failed to start stream:', error);
    debugError('[Gemini Live Audio] Error details:', error);
    if (error instanceof Error) {
      debugError('[Gemini Live Audio] Error message:', error.message);
      debugError('[Gemini Live Audio] Error stack:', error.stack);
    }
    state.config.onError?.(error as Error);
    throw error; // Re-throw to ensure the test catches it
  }
};

export const stopStream = async (state: GeminiLiveAudioState): Promise<void> => {
  debugLog('[Gemini Session] Session ending');
  debugLog(`[Gemini Session] Session Cost: $${state.sessionCost.toFixed(4)}`);
  debugLog(`[Gemini Session] Input Tokens: ${state.sessionInputTokens}, Output Tokens: ${state.sessionOutputTokens}`);

  debugLog('[Gemini Live Audio] Stopping stream...');
  stopDebugTicker(state);

  // Setting processing flags to false
  state.isProcessing = false;
  state.sessionConnected = false;

  // Disconnect audio processing nodes
  if (state.scriptProcessor) {
    // Disconnecting script processor
    state.scriptProcessor.disconnect();
    state.scriptProcessor = null;
    // Script processor disconnected
  }

  if (state.sourceNode) {
    // Disconnecting source node
    state.sourceNode.disconnect();
    state.sourceNode = null;
    // Source node disconnected
  }

  // Stop all audio sources (following Google's sample)
  if (state.sources.size > 0) {
    // Stopping active audio sources
    for (const source of state.sources.values()) {
      source.stop();
      state.sources.delete(source);
    }
    // All audio sources stopped
  }

  // Close audio contexts
  if (state.inputAudioContext) {
    // Closing input audio context
    await state.inputAudioContext.close();
    state.inputAudioContext = null;
    // Input audio context closed
  }

  if (state.outputAudioContext) {
    // Closing output audio context
    await state.outputAudioContext.close();
    state.outputAudioContext = null;
    // Output audio context closed
  }

  // Close session
  if (state.session) {
    // Closing Gemini Live session
    state.session.close();
    state.session = null;
    // Gemini Live session closed
  }

  // Reset nodes and clear buffers
  state.inputNode = null;
  state.outputNode = null;
  state.nextStartTime = 0;
  state.audioBuffer = [];
  state.lastSendTime = 0;
  state.lastNonSilentTime = 0;

  // Clear text buffer and timeout
  state.textBuffer = [];
  if (state.textBufferTimeout) {
    clearTimeout(state.textBufferTimeout);
    state.textBufferTimeout = null;
  }

  // Reset token usage for new session
  state.sessionInputTokens = 0;
  state.sessionOutputTokens = 0;
  state.sessionCost = 0;

  // Session completely stopped - All resources cleaned up
  debugLog('[Gemini Live Audio] Stream stopped');
};

export const updateOtherParticipantLanguages = (state: GeminiLiveAudioState, languages: string[]): void => {
  debugLog('[Gemini Live Audio] Updating other participant languages:', languages);
  state.config.otherParticipantLanguages = languages;
  state.config.usePeerTranslation = languages.length > 0;

  // If session is active, recreate it with new translation target
  if (state.sessionConnected && languages.length > 0) {
    debugLog(`[Gemini Live Audio] Recreating session for new translation target: ${languages[0]}`);
    recreateSessionWithNewTarget(state, languages[0]);
  }
};

export const updateTargetLanguage = async (state: GeminiLiveAudioState, newTargetLanguage: string): Promise<void> => {
  if (!state.session || !state.sessionReady) {
    console.warn('[Gemini Live Audio] Cannot update language - session not ready');
    return;
  }

  const oldTargetLanguage = state.config.targetLanguage;
  state.config.targetLanguage = newTargetLanguage;

  debugLog(`[Gemini Live Audio] Updated target language: ${oldTargetLanguage} -> ${newTargetLanguage}`);

  // If mode changed (System Assistant <-> Translation) or translation language changed, recreate session with new system instruction
  const oldMode = oldTargetLanguage === 'System Assistant';
  const newMode = newTargetLanguage === 'System Assistant';

  if (oldMode !== newMode || (oldMode === false && newMode === false && oldTargetLanguage !== newTargetLanguage)) {
    debugLog('[Gemini Live Audio] Mode or language changed, recreating session with new system instruction...');
    debugLog(`[Gemini Live Audio] Old: ${oldTargetLanguage} (System Assistant: ${oldMode})`);
    debugLog(`[Gemini Live Audio] New: ${newTargetLanguage} (System Assistant: ${newMode})`);

    try {
      // Store current media stream
      const currentMediaStream = state.mediaStream;

      // Stop current session
      await stopStream(state);

      // Restart with new system instruction
      if (currentMediaStream) {
        await startStream(state, currentMediaStream);
        debugLog('[Gemini Live Audio] Session recreated successfully with new system instruction');
      }
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to recreate session:', error);
      state.config.onError?.(error as Error);
    }
  } else {
    debugLog('[Gemini Live Audio] Same mode, no session recreation needed');
  }
};

const recreateSessionWithNewTarget = async (state: GeminiLiveAudioState, newTargetLanguage: string): Promise<void> => {
  try {
    debugLog(`[Gemini Live Audio] Recreating session for target language: ${newTargetLanguage}`);

    // Stop current session
    await stopStream(state);

    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Update config for new target
    state.config.otherParticipantLanguages = [newTargetLanguage];
    state.config.usePeerTranslation = true;

    // Restart with media stream if available
    if (state.mediaStream) {
      await startStream(state, state.mediaStream);
    }
  } catch (error) {
    debugError('[Gemini Live Audio] Error recreating session:', error);
    state.config.onError?.(error as Error);
  }
};
