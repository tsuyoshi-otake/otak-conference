import type { GeminiLiveAudioState } from './state';
import { sendBufferedAudio } from './audioSend';

type IncomingAudioOptions = {
  copyOnBufferReuse: boolean;
};

export const ensureAudioContextRunning = async (audioContext: AudioContext): Promise<void> => {
  // Ensure AudioContext is in running state for AudioWorklet
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }
};

export const waitForAudioContextReady = async (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 100));

export const canProcessAudio = (state: GeminiLiveAudioState): boolean =>
  Boolean(state.isProcessing && state.session && state.sessionConnected);

export const connectProcessingChain = (
  state: GeminiLiveAudioState,
  inputContext: AudioContext,
  processorNode: AudioWorkletNode | ScriptProcessorNode
): void => {
  state.sourceNode?.connect(processorNode);
  if (state.inputNode) {
    processorNode.connect(state.inputNode);
  } else {
    processorNode.connect(inputContext.destination);
  }
};

export const handleIncomingAudio = (
  state: GeminiLiveAudioState,
  pcmData: Float32Array,
  options: IncomingAudioOptions
): void => {
  updateInputMetrics(state, pcmData);
  bufferAudioData(state, pcmData, options);
  detectSpeechActivity(state, pcmData);
  maybeSendBufferedAudio(state);
};

const updateInputMetrics = (state: GeminiLiveAudioState, pcmData: Float32Array): void => {
  state.inputFrameCount += 1;
  state.lastInputFrameTime = Date.now();
  state.lastInputFrameSize = pcmData.length;
};

const bufferAudioData = (
  state: GeminiLiveAudioState,
  pcmData: Float32Array,
  options: IncomingAudioOptions
): void => {
  // Limit buffer size to reduce memory use.
  if (state.audioBuffer.length >= state.maxBufferSize) {
    state.audioBuffer.shift();
  }

  const bufferedData = options.copyOnBufferReuse
    ? copyPcmData(pcmData)
    : ensureAttachedPcmData(pcmData);

  state.audioBuffer.push(bufferedData);
};

const copyPcmData = (pcmData: Float32Array): Float32Array => {
  const pcmDataCopy = new Float32Array(pcmData.length);
  pcmDataCopy.set(pcmData);
  return pcmDataCopy;
};

const ensureAttachedPcmData = (pcmData: Float32Array): Float32Array => {
  const isDataTransferred = pcmData.buffer.byteLength === 0;
  return isDataTransferred ? new Float32Array(pcmData) : pcmData;
};

const maybeSendBufferedAudio = (state: GeminiLiveAudioState): void => {
  const currentTime = Date.now();
  const effectiveInterval = getAdaptiveInterval(state);

  if (currentTime - state.lastSendTime >= effectiveInterval) {
    sendBufferedAudio(state);
    state.lastSendTime = currentTime;
  }
};

const detectSpeechActivity = (state: GeminiLiveAudioState, audioData: Float32Array): void => {
  // Reduce CPU load: run detailed VAD every 3rd frame.
  if (shouldSkipDetailedVad(state)) {
    const energy = computeCoarseEnergy(audioData);
    updateSpeechFromCoarseEnergy(state, energy);
    return;
  }

  // Detailed VAD (every 3rd frame).
  resetVadSkipCounter(state);

  const { energy, zeroCrossingRate } = computeDetailedVadMetrics(audioData);
  updateEnergyHistory(state, energy);
  updateEnergyTrend(state);

  const adaptiveThreshold = computeAdaptiveThreshold(state);
  const voiceDetected = isVoiceDetected(energy, adaptiveThreshold, zeroCrossingRate);

  updateSpeechPredicted(state, energy);
  updateVadHistory(state, voiceDetected);
  updateSpeechDetected(state);
  updateLastSpeechTimeIfDetected(state);
};

const shouldSkipDetailedVad = (state: GeminiLiveAudioState): boolean => {
  state.vadSkipCounter += 1;
  return state.vadSkipCounter < state.vadSkipThreshold;
};

const resetVadSkipCounter = (state: GeminiLiveAudioState): void => {
  state.vadSkipCounter = 0;
};

const computeCoarseEnergy = (audioData: Float32Array): number => {
  let energy = 0;
  const step = Math.max(1, Math.floor(audioData.length / 16));
  for (let i = 0; i < audioData.length; i += step) {
    energy += audioData[i] * audioData[i];
  }
  return energy / (audioData.length / step);
};

const updateSpeechFromCoarseEnergy = (state: GeminiLiveAudioState, energy: number): void => {
  state.speechDetected = energy > state.silenceThreshold * 4;
  updateLastSpeechTimeIfDetected(state);
};

const computeDetailedVadMetrics = (audioData: Float32Array): { energy: number; zeroCrossingRate: number } => {
  let energy = 0;
  let zeroCrossings = 0;
  let previousSample = 0;
  const step = Math.max(1, Math.floor(audioData.length / 32));

  for (let i = 0; i < audioData.length; i += step) {
    energy += audioData[i] * audioData[i];

    if (i > 0 && previousSample * audioData[i] < 0) {
      zeroCrossings++;
    }
    previousSample = audioData[i];
  }

  energy = energy / (audioData.length / step);
  const zeroCrossingRate = zeroCrossings / (audioData.length / step);

  return { energy, zeroCrossingRate };
};

const updateEnergyHistory = (state: GeminiLiveAudioState, energy: number): void => {
  // Keep 10-sample energy history (30 -> 10).
  state.energyHistory.push(energy);
  if (state.energyHistory.length > 10) {
    state.energyHistory.shift();
  }
};

const updateEnergyTrend = (state: GeminiLiveAudioState): void => {
  if (state.energyHistory.length >= 2) {
    const recent = state.energyHistory.slice(-2);
    state.energyTrend = recent[1] - recent[0];
  }
};

const computeAdaptiveThreshold = (state: GeminiLiveAudioState): number => {
  let avgEnergy = 0;
  for (let i = 0; i < state.energyHistory.length; i++) {
    avgEnergy += state.energyHistory[i];
  }
  avgEnergy = avgEnergy / state.energyHistory.length;
  return Math.max(state.silenceThreshold, avgEnergy * 1.5);
};

const isVoiceDetected = (energy: number, adaptiveThreshold: number, zeroCrossingRate: number): boolean =>
  energy > adaptiveThreshold && zeroCrossingRate < 0.6;

const updateSpeechPredicted = (state: GeminiLiveAudioState, energy: number): void => {
  state.speechPredicted = state.energyTrend > 0.002 && energy > state.silenceThreshold;
};

const updateVadHistory = (state: GeminiLiveAudioState, voiceDetected: boolean): void => {
  // Keep 3-sample VAD history (5 -> 3).
  state.vadHistory.push(voiceDetected);
  if (state.vadHistory.length > 3) {
    state.vadHistory.shift();
  }
};

const updateSpeechDetected = (state: GeminiLiveAudioState): void => {
  let trueCount = 0;
  for (let i = 0; i < state.vadHistory.length; i++) {
    if (state.vadHistory[i]) trueCount++;
  }
  state.speechDetected = trueCount >= 2;
};

const updateLastSpeechTimeIfDetected = (state: GeminiLiveAudioState): void => {
  if (state.speechDetected) {
    state.lastSpeechTime = Date.now();
  }
};

const getAdaptiveInterval = (state: GeminiLiveAudioState): number => {
  const baseInterval = state.sendInterval;
  if (state.speechPredicted && state.isPreemptiveSendEnabled) {
    return Math.max(20, Math.round(baseInterval * 0.75));
  }
  if (state.speechDetected) {
    return baseInterval;
  }

  const timeSinceLastSpeech = Date.now() - state.lastSpeechTime;
  return timeSinceLastSpeech < 1000
    ? Math.max(baseInterval * 2, baseInterval + 20)
    : Math.max(baseInterval * 4, baseInterval + 100);
};
