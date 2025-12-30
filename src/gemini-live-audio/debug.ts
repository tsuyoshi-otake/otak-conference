import { debugLog, isDebugEnabled } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';

export const resetDebugMetrics = (state: GeminiLiveAudioState): void => {
  state.inputFrameCount = 0;
  state.lastInputFrameTime = 0;
  state.lastInputFrameSize = 0;
  state.lastInputSendTime = 0;
  state.lastInputRms = 0;
  state.lastInputSamples = 0;
  state.lastInputSeconds = 0;
  state.lastOutputTextTime = 0;
  state.lastOutputAudioTime = 0;
  state.lastSessionMessageTime = 0;
  state.sessionOpenTime = 0;
  state.sentAudioChunks = 0;
  state.skippedSilentChunks = 0;
  state.receivedAudioChunks = 0;
  state.receivedTextChunks = 0;
  state.lastSilenceLogTime = 0;
  state.lastDebugSnapshotKey = null;
  state.lastDebugSnapshotTime = 0;
  state.hasSentSilenceFlush = false;
  state.lastSilenceFlushTime = 0;
};

export const startDebugTicker = (state: GeminiLiveAudioState): void => {
  if (!isDebugEnabled() || state.debugInterval) {
    return;
  }

  state.debugInterval = setInterval(() => {
    if (!isDebugEnabled()) {
      return;
    }

    const now = Date.now();
    const since = (time: number) => (time ? now - time : null);
    const snapshotKey = JSON.stringify({
      sessionConnected: state.sessionConnected,
      isProcessing: state.isProcessing,
      bufferedChunks: state.audioBuffer.length,
      lastInputFrameSize: state.lastInputFrameSize,
      lastInputRms: Math.round(state.lastInputRms * 1000) / 1000,
      lastInputSamples: state.lastInputSamples,
      lastInputSeconds: Math.round(state.lastInputSeconds * 1000) / 1000,
      skippedSilentChunks: state.skippedSilentChunks,
      receivedAudioChunks: state.receivedAudioChunks,
      receivedTextChunks: state.receivedTextChunks
    });

    if (
      snapshotKey === state.lastDebugSnapshotKey &&
      now - state.lastDebugSnapshotTime < state.debugSnapshotMinIntervalMs
    ) {
      return;
    }

    state.lastDebugSnapshotKey = snapshotKey;
    state.lastDebugSnapshotTime = now;

    debugLog('[Gemini Live Audio] Debug snapshot', {
      sessionConnected: state.sessionConnected,
      isProcessing: state.isProcessing,
      bufferedChunks: state.audioBuffer.length,
      inputFrames: state.inputFrameCount,
      lastInputFrameMs: since(state.lastInputFrameTime),
      lastInputFrameSize: state.lastInputFrameSize,
      lastInputSendMs: since(state.lastInputSendTime),
      lastOutputTextMs: since(state.lastOutputTextTime),
      lastOutputAudioMs: since(state.lastOutputAudioTime),
      lastServerMessageMs: since(state.lastSessionMessageTime),
      lastInputRms: state.lastInputRms,
      lastInputSamples: state.lastInputSamples,
      lastInputSeconds: state.lastInputSeconds,
      sentAudioChunks: state.sentAudioChunks,
      skippedSilentChunks: state.skippedSilentChunks,
      receivedAudioChunks: state.receivedAudioChunks,
      receivedTextChunks: state.receivedTextChunks,
      sessionAgeMs: state.sessionOpenTime ? now - state.sessionOpenTime : null
    });
  }, 5000);
};

export const stopDebugTicker = (state: GeminiLiveAudioState): void => {
  if (state.debugInterval) {
    clearInterval(state.debugInterval);
    state.debugInterval = null;
  }
};
