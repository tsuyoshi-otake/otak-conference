import { debugWarn } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';

export const initializeWorker = async (state: GeminiLiveAudioState): Promise<void> => {
  try {
    state.audioWorker = new Worker('/audio-worker.js');

    state.audioWorker.onmessage = (event) => {
      const { type, result } = event.data;

      if (type === 'audio-processed' && result) {
        const resolver = state.pendingRequests.get(result.requestId);
        if (resolver) {
          resolver(result);
          state.pendingRequests.delete(result.requestId);
        }
      }
    };

    state.audioWorker.onerror = (error) => {
      debugWarn('[Gemini Live Audio] Worker error, disabling worker for this session:', error);
      // Gracefully disable worker without affecting AudioWorklet
      if (state.audioWorker) {
        state.audioWorker.terminate();
        state.audioWorker = null;
      }
      // Clear pending requests
      state.pendingRequests.clear();
    };

    // Initialize worker
    state.audioWorker.postMessage({ type: 'init' });
  } catch (error) {
    console.warn('[Gemini Live Audio] Worker initialization failed, using main thread:', error);
    state.audioWorker = null;
  }
};
