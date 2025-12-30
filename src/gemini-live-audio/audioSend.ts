import { float32ToBase64PCM } from '../gemini-utils';
import { debugLog, debugWarn, infoLog, isDebugEnabled } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';
import { updateTokenUsage } from './tokenUsage';

export const sendBufferedAudio = (state: GeminiLiveAudioState): void => {
  if (!state.session || state.audioBuffer.length === 0) return;
  if (!ensureSessionReady(state)) return;

  try {
    const { pcmBuffer, totalLength } = buildPcmBuffer(state);

    const now = Date.now();
    const rms = computeRms(pcmBuffer);
    updateInputMetrics(state, rms, pcmBuffer.length);
    const nearSilence = isNearSilence(state, rms);
    updateSilenceTracking(state, nearSilence, now);

    if (flushSilenceIfNeeded(state, nearSilence, now)) {
      clearAudioBuffer(state);
      return;
    }

    if (shouldSkipBuffer(state, nearSilence, now, pcmBuffer.length)) {
      handleSkippedBuffer(state, nearSilence, rms, now);
      clearAudioBuffer(state);
      return;
    }

    const normalizedPcm = applyInputGain(state, pcmBuffer, rms);
    const base64Audio = float32ToBase64PCM(normalizedPcm);

    const audioLengthSeconds = pcmBuffer.length / state.targetSampleRate;
    // debugLog(`[Gemini Live Audio] Sending buffered audio: ${totalLength} samples (${audioLengthSeconds.toFixed(2)}s)`);

    if (!sendAudioPayload(state, base64Audio, audioLengthSeconds, rms, pcmBuffer.length)) {
      clearAudioBuffer(state);
      return;
    }

    state.sentAudioChunks += 1;
    state.lastInputSendTime = now;

    // Track input token usage
    updateTokenUsage(state, audioLengthSeconds);

    // Clear the buffer after sending
    clearAudioBuffer(state);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    debugWarn('[Gemini Live Audio] Error sending buffered audio:', errorMessage);
    debugWarn('[Gemini Live Audio] Error details:', error);
    // Clear buffer on error to prevent buildup
    clearAudioBuffer(state);
  }
};

export const sendTrailingSilence = (state: GeminiLiveAudioState, seconds: number = 1): void => {
  if (!state.session || !state.sessionReady) {
    debugWarn('[Gemini Live Audio] Cannot send trailing silence - session not ready');
    return;
  }

  const sampleCount = Math.max(1, Math.floor(state.targetSampleRate * seconds));
  const silence = new Float32Array(sampleCount);
  const base64Audio = float32ToBase64PCM(silence);
  state.session.sendRealtimeInput({
    audio: {
      data: base64Audio,
      mimeType: `audio/pcm;rate=${state.targetSampleRate}`
    }
  });
  debugLog(`[Gemini Live Audio] Sent trailing silence: ${seconds}s`);
};

export const sendAudioStreamEnd = (state: GeminiLiveAudioState): void => {
  if (!state.session || !state.sessionReady) {
    debugWarn('[Gemini Live Audio] Cannot send audioStreamEnd - session not ready');
    return;
  }

  state.session.sendRealtimeInput({ audioStreamEnd: true });
  debugLog('[Gemini Live Audio] Sent audioStreamEnd');
};

const resampleToTargetRate = (
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array => {
  if (inputSampleRate === outputSampleRate) {
    return buffer;
  }

  const ratio = outputSampleRate / inputSampleRate;
  const newLength = Math.round(buffer.length * ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const sourceIndex = i / ratio;
    const lowIndex = Math.floor(sourceIndex);
    const highIndex = Math.min(lowIndex + 1, buffer.length - 1);
    const weight = sourceIndex - lowIndex;

    result[i] = buffer[lowIndex] * (1 - weight) + buffer[highIndex] * weight;
  }

  return result;
};

const computeRms = (buffer: Float32Array): number => {
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / Math.max(1, buffer.length));
};

const isNearSilence = (state: GeminiLiveAudioState, rms: number): boolean => {
  if (!Number.isFinite(rms)) {
    return true;
  }
  return rms < Math.max(0.0008, state.silenceGateThreshold);
};

const applyInputGain = (
  state: GeminiLiveAudioState,
  buffer: Float32Array,
  rms: number
): Float32Array => {
  if (!rms) {
    return buffer;
  }
  let gain = state.inputTargetRms / rms;
  if (!Number.isFinite(gain)) {
    return buffer;
  }
  gain = Math.min(state.inputMaxGain, Math.max(state.inputMinGain, gain));
  if (Math.abs(gain - 1) <= state.inputGainEpsilon) {
    return buffer;
  }

  const output = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    let value = buffer[i] * gain;
    if (value > 1) value = 1;
    if (value < -1) value = -1;
    output[i] = value;
  }
  return output;
};

const ensureSessionReady = (state: GeminiLiveAudioState): boolean => {
  if (!state.sessionReady) {
    debugLog('[Gemini Live Audio] Session not ready, stopping audio send');
    state.isProcessing = false;
    clearAudioBuffer(state);
    return false;
  }
  return true;
};

const buildPcmBuffer = (state: GeminiLiveAudioState): { pcmBuffer: Float32Array; totalLength: number } => {
  const totalLength = state.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
  const combinedBuffer = new Float32Array(totalLength);
  let offset = 0;

  for (const buffer of state.audioBuffer) {
    combinedBuffer.set(buffer, offset);
    offset += buffer.length;
  }

  const inputSampleRate = state.inputSampleRate || state.inputAudioContext?.sampleRate || state.targetSampleRate;
  const pcmBuffer = inputSampleRate === state.targetSampleRate
    ? combinedBuffer
    : resampleToTargetRate(combinedBuffer, inputSampleRate, state.targetSampleRate);

  return { pcmBuffer, totalLength };
};

const updateInputMetrics = (state: GeminiLiveAudioState, rms: number, sampleCount: number): void => {
  state.lastInputRms = rms;
  state.lastInputSamples = sampleCount;
  state.lastInputSeconds = sampleCount / state.targetSampleRate;
};

const updateSilenceTracking = (state: GeminiLiveAudioState, nearSilence: boolean, now: number): void => {
  if (!nearSilence) {
    state.lastNonSilentTime = now;
    state.hasSentSilenceFlush = false;
  }
};

const flushSilenceIfNeeded = (state: GeminiLiveAudioState, nearSilence: boolean, now: number): boolean => {
  const shouldFlushSilence = nearSilence &&
    state.lastNonSilentTime > 0 &&
    now - state.lastNonSilentTime > state.silenceGateHoldMs;

  if (!shouldFlushSilence) {
    return false;
  }

  if (
    !state.hasSentSilenceFlush ||
    now - state.lastSilenceFlushTime > state.silenceFlushCooldownMs
  ) {
    sendTrailingSilence(state, state.silenceFlushSeconds);
    updateTokenUsage(state, state.silenceFlushSeconds);
    state.sentAudioChunks += 1;
    state.lastInputSendTime = now;
    state.hasSentSilenceFlush = true;
    state.lastSilenceFlushTime = now;
  }

  return true;
};

const shouldSkipBuffer = (
  state: GeminiLiveAudioState,
  nearSilence: boolean,
  now: number,
  bufferLength: number
): boolean => {
  return bufferLength === 0 || (nearSilence && state.lastNonSilentTime > 0 &&
    now - state.lastNonSilentTime > state.silenceGateHoldMs);
};

const handleSkippedBuffer = (
  state: GeminiLiveAudioState,
  nearSilence: boolean,
  rms: number,
  now: number
): void => {
  if (nearSilence && state.lastNonSilentTime > 0) {
    state.skippedSilentChunks += 1;
    if (isDebugEnabled() && now - state.lastSilenceLogTime > 2000) {
      state.lastSilenceLogTime = now;
      debugLog('[Gemini Live Audio] Skipping near-silence audio chunk', {
        rms: Number(rms.toFixed(6)),
        threshold: Math.max(0.0008, state.silenceGateThreshold)
      });
    }
  }
};

const sendAudioPayload = (
  state: GeminiLiveAudioState,
  base64Audio: string,
  audioLengthSeconds: number,
  rms: number,
  sampleCount: number
): boolean => {
  if (!state.session || !state.sessionReady) {
    debugWarn('[Gemini Live Audio] Session not ready, skipping audio send');
    return false;
  }

  state.session.sendRealtimeInput({
    audio: {
      data: base64Audio,
      mimeType: `audio/pcm;rate=${state.targetSampleRate}`
    }
  });

  const nowAfterSend = Date.now();
  if (nowAfterSend - state.lastInfoAudioSendTime >= state.infoLogIntervalMs) {
    infoLog(`[Gemini Live Audio] Sent audio chunk: ${audioLengthSeconds.toFixed(2)}s, rms=${rms.toFixed(4)}, samples=${sampleCount}`);
    state.lastInfoAudioSendTime = nowAfterSend;
  }

  return true;
};

const clearAudioBuffer = (state: GeminiLiveAudioState): void => {
  state.audioBuffer = [];
};
