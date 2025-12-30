import { debugError, debugLog, debugWarn, isDebugEnabled } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';
import {
  canProcessAudio,
  connectProcessingChain,
  ensureAudioContextRunning,
  handleIncomingAudio,
  waitForAudioContextReady
} from './audioProcessing';

export const setupAudioProcessing = async (state: GeminiLiveAudioState): Promise<void> => {
  if (!state.inputAudioContext || !state.mediaStream) return;

  debugLog('[Gemini Live Audio] Setting up audio processing pipeline...');
  const inputContext = state.inputAudioContext;
  if (inputContext.state === 'closed') {
    debugWarn('[Gemini Live Audio] Input audio context is closed, aborting setup');
    return;
  }

  // Create media stream source and connect to input node
  state.sourceNode = inputContext.createMediaStreamSource(state.mediaStream);
  state.sourceNode.connect(state.inputNode!);

  const audioWorkletSuccess = await trySetupAudioWorklet(state, inputContext);

  // Fallback: Only use ScriptProcessorNode if AudioWorklet absolutely failed
  if (!audioWorkletSuccess) {
    setupScriptProcessorFallback(state, inputContext);
  }

  state.isProcessing = true;
  debugLog('[Gemini Live Audio] Audio processing pipeline ready');
};

const trySetupAudioWorklet = async (state: GeminiLiveAudioState, inputContext: AudioContext): Promise<boolean> => {
  // First attempt: Try AudioWorklet (modern, preferred method)
  try {
    await ensureAudioContextRunning(state.inputAudioContext);
    await waitForAudioContextReady();

    // Add audio worklet for input capture (recommended by Google)
    await inputContext.audioWorklet.addModule('/audio-capture-processor.js');

    // Create AudioWorkletNode for audio capture
    const audioWorkletNode = new AudioWorkletNode(inputContext, 'audio-capture-processor', {
      processorOptions: { debugEnabled: isDebugEnabled() }
    });

    // Handle audio data from worklet
    audioWorkletNode.port.onmessage = (event) => {
      if (!canProcessAudio(state)) return;

      const pcmData = event.data as Float32Array; // Float32Array from worklet
      handleIncomingAudio(state, pcmData, { copyOnBufferReuse: false });
    };

    // Handle AudioWorklet errors
    audioWorkletNode.port.onerror = (error) => {
      debugError('[Gemini Live Audio] AudioWorklet error:', error);
    };

    // Connect audio processing chain (silent output to keep graph alive)
    connectProcessingChain(state, inputContext, audioWorkletNode);

    // Store reference for cleanup
    state.scriptProcessor = audioWorkletNode as any; // For compatibility

    debugLog('[Gemini Live Audio] AudioWorklet initialized successfully');
    return true;
  } catch (workletError) {
    debugWarn('[Gemini Live Audio] AudioWorklet initialization failed:', workletError);
    return false;
  }
};

const setupScriptProcessorFallback = (state: GeminiLiveAudioState, inputContext: AudioContext): void => {
  console.warn('[Gemini Live Audio] Using deprecated ScriptProcessorNode as fallback. Consider updating your browser for better performance.');

  // Fallback to ScriptProcessorNode for compatibility
  const bufferSize = 256;
  state.scriptProcessor = inputContext.createScriptProcessor(bufferSize, 1, 1);

  state.scriptProcessor.onaudioprocess = (event) => {
    if (!canProcessAudio(state)) return;

    const inputBuffer = event.inputBuffer;
    const pcmData = inputBuffer.getChannelData(0);
    handleIncomingAudio(state, pcmData, { copyOnBufferReuse: true });
  };

  // Connect audio processing chain (silent output to keep graph alive)
  connectProcessingChain(state, inputContext, state.scriptProcessor);

  debugLog('[Gemini Live Audio] ScriptProcessorNode fallback initialized');
};
