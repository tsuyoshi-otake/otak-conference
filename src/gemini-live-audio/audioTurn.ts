import { decode } from '../gemini-utils';
import { debugError, debugLog, debugWarn, infoLog } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';
import { updateTokenUsage } from './tokenUsage';
import { createWavFile, createWavFromChunks, parseMimeType } from './wav';

export const processCompleteAudioTurn = async (
  state: GeminiLiveAudioState,
  audioChunks: string[],
  mimeType?: string
): Promise<void> => {
  try {
    debugLog(`[Gemini Live Audio] Processing complete audio turn with ${audioChunks.length} chunks`);

    if (audioChunks.length === 0) {
      debugWarn('[Gemini Live Audio] No audio chunks to process');
      return;
    }

    // Calculate total size first to avoid array resizing
    let totalSamples = 0;
    const decodedChunks: Int16Array[] = [];

    // Decode all chunks first (parallel processing potential)
    for (let i = 0; i < audioChunks.length; i++) {
      const chunk = audioChunks[i];
      // Commented out verbose chunk processing logging
      // console.log(`[Audio Processing] Processing chunk ${i + 1}/${audioChunks.length}: ${chunk.length} chars`);

      const buffer = decode(chunk);
      const intArray = new Int16Array(buffer);
      decodedChunks.push(intArray);
      totalSamples += intArray.length;

      // console.log(`[Audio Processing] Chunk ${i + 1} decoded: ${intArray.length} samples`);
    }

    if (totalSamples === 0) {
      debugWarn('[Gemini Live Audio] No audio data to process - empty chunks');
      return;
    }

    // Efficiently combine using pre-allocated buffer
    const audioBuffer = new Int16Array(totalSamples);
    let offset = 0;

    for (const chunk of decodedChunks) {
      audioBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Reduced verbose audio processing logs
    debugLog(`[Gemini Live Audio] Combined audio buffer: ${audioBuffer.length} samples`);

    // Parse audio parameters from MIME type
    const audioParams = mimeType ? parseMimeType(mimeType) : {
      sampleRate: 24000,
      bitsPerSample: 16,
      numChannels: 1
    };

    debugLog(`[Gemini Live Audio] Audio parameters: ${audioParams.sampleRate}Hz, ${audioParams.bitsPerSample}bit, ${audioParams.numChannels}ch`);

    // Use optimized method if we have MIME type, fallback to current method
    let wavData: ArrayBuffer;
    if (mimeType) {
      // Use Google's direct method for better compatibility
      wavData = createWavFromChunks(audioChunks, mimeType);
      debugLog('[Gemini Live Audio] Using direct WAV creation from chunks');
    } else {
      // Fallback to current decoded method
      wavData = createWavFile(audioBuffer, audioParams.sampleRate, audioParams.numChannels);
      debugLog('[Gemini Live Audio] Using decoded WAV creation method');
    }

    // Calculate duration for token tracking using correct sample rate
    const audioDurationSeconds = audioBuffer.length / audioParams.sampleRate;
    debugLog(`[Gemini Live Audio] Audio duration: ${audioDurationSeconds.toFixed(2)}s`);

    // Only play locally if local playback is enabled
    if (state.localPlaybackEnabled && state.outputAudioContext) {
      await playWavAudio(state, wavData);
      debugLog(`[Gemini Live Audio] Playing combined audio locally: ${audioDurationSeconds.toFixed(2)}s`);
    } else {
      debugLog(`[Gemini Live Audio] Skipping local playback: ${audioDurationSeconds.toFixed(2)}s`);
    }

    const now = Date.now();
    if (now - state.lastInfoAudioReceiveTime >= state.infoLogIntervalMs) {
      infoLog(`[Gemini Live Audio] Received audio response: ${audioDurationSeconds.toFixed(2)}s, chunks=${audioChunks.length}`);
      state.lastInfoAudioReceiveTime = now;
    }

    // Track output token usage
    updateTokenUsage(state, 0, audioDurationSeconds);

    // Always call the callback for translated audio distribution to other participants
    state.config.onAudioReceived?.(wavData.slice(0));
  } catch (error) {
    console.error('[Audio Processing] Failed to process complete audio turn:', error);
    console.error('[Gemini Live Audio] Failed to process complete audio turn:', error);
    debugError('[Gemini Live Audio] Error details:', error);
  }
};

const playWavAudio = async (state: GeminiLiveAudioState, wavData: ArrayBuffer): Promise<void> => {
  if (!state.outputAudioContext || !state.outputNode) return;

  try {
    if (state.outputAudioContext.state === 'suspended') {
      await state.outputAudioContext.resume();
      debugLog('[Gemini Live Audio] Resumed output audio context before playback');
    }
    const audioBuffer = await state.outputAudioContext.decodeAudioData(wavData.slice(0));

    const source = state.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.outputNode);

    source.addEventListener('ended', () => {
      state.sources.delete(source);
    });

    state.nextStartTime = Math.max(
      state.nextStartTime,
      state.outputAudioContext.currentTime
    );

    source.start(state.nextStartTime);
    state.nextStartTime = state.nextStartTime + audioBuffer.duration;
    state.sources.add(source);
  } catch (error) {
    console.error('[Gemini Live Audio] Failed to play WAV audio:', error);
  }
};
