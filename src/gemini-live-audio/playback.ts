import { debugError, debugLog, debugWarn, isDebugEnabled } from '../debug-utils';

// Global audio context for playback
let globalAudioContext: AudioContext | null = null;

// Fallback: Initialize PCM worklet for browsers that don't support Opus streaming
let globalPcmWorkletNode: AudioWorkletNode | null = null;

const initializePCMWorklet = async (): Promise<void> => {
  if (!globalAudioContext) {
    // Use 24kHz to match Gemini output, or let browser choose optimal rate
    globalAudioContext = new AudioContext({ sampleRate: 24000 });

    // Resume context if suspended (required by some browsers)
    if (globalAudioContext.state === 'suspended') {
      await globalAudioContext.resume();
    }

    try {
      // Use relative path for the worklet module
      const workletPath = './pcm-processor.js';
      debugLog(`[Gemini Live Audio] Loading audio worklet from: ${workletPath}`);
      debugLog(`[Gemini Live Audio] Audio context sample rate: ${globalAudioContext.sampleRate}Hz`);

      // Add error handling and retry logic
      let retries = 3;
      while (retries > 0) {
        try {
          await globalAudioContext.audioWorklet.addModule(workletPath);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          debugWarn(`[Gemini Live Audio] Retrying worklet load... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Create the worklet node with debug mode option
      globalPcmWorkletNode = new AudioWorkletNode(globalAudioContext, 'pcm-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1], // Mono output
        processorOptions: {
          debugEnabled: isDebugEnabled()
        }
      });

      // Send debug mode to existing worklet if needed
      if (globalPcmWorkletNode.port) {
        globalPcmWorkletNode.port.postMessage({
          type: 'setDebugMode',
          enabled: isDebugEnabled()
        });
      }

      // Connect to destination with gain control
      const gainNode = globalAudioContext.createGain();
      gainNode.gain.value = 0.7; // Reduce volume to prevent distortion

      globalPcmWorkletNode.connect(gainNode);
      gainNode.connect(globalAudioContext.destination);

      debugLog('[Gemini Live Audio] PCM audio worklet initialized successfully');
      debugLog(`[Gemini Live Audio] Final sample rate: ${globalAudioContext.sampleRate}Hz`);
    } catch (error) {
      console.error('[Gemini Live Audio] Failed to initialize PCM worklet:', error);
      debugError('[Gemini Live Audio] Make sure pcm-processor.js is accessible at ./pcm-processor.js');
      globalAudioContext = null;
      globalPcmWorkletNode = null;
    }
  }
};

export const playAudioData = async (audioData: ArrayBuffer, outputDeviceId?: string): Promise<void> => {
  try {
    debugLog(`[Gemini Live Audio] Starting audio playback: ${(audioData.byteLength / 1024).toFixed(2)}KB`);
    debugLog(`[Gemini Live Audio] Output device: ${outputDeviceId || 'default'}`);

    // Check if the audio data is valid
    if (!audioData || audioData.byteLength === 0) {
      debugWarn('[Gemini Live Audio] Received empty audio data');
      return;
    }

    // Log first few bytes to identify format
    const firstBytes = new Uint8Array(audioData.slice(0, 4));
    debugLog(`[Gemini Live Audio] First 4 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    // Check if this is a WAV file (starts with "RIFF")
    const isWavFile = firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46;

    if (isWavFile) {
      debugLog('[Gemini Live Audio] Detected WAV audio format, using Web Audio API decodeAudioData');

      // Initialize global audio context if not already done
      if (!globalAudioContext) {
        globalAudioContext = new AudioContext({ sampleRate: 24000 });
      }

      // Set output device if specified and supported (non-blocking)
      if (outputDeviceId && 'setSinkId' in globalAudioContext.destination) {
        try {
          await (globalAudioContext.destination as any).setSinkId(outputDeviceId);
          debugLog(`[Gemini Live Audio] Set output device for WAV: ${outputDeviceId}`);
        } catch (error) {
          debugWarn('[Gemini Live Audio] Could not set output device for WAV, continuing with default:', error);
        }
      }

      // Decode WAV file using Web Audio API
      const audioBuffer = await globalAudioContext.decodeAudioData(audioData.slice(0));

      // Play the decoded audio
      const source = globalAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(globalAudioContext.destination);
      source.start();

      debugLog(`[Gemini Live Audio] Successfully played WAV audio: ${audioBuffer.duration.toFixed(2)}s`);
    } else {
      debugLog('[Gemini Live Audio] Detected PCM audio format, using PCM worklet');

      // Initialize PCM worklet if not already done
      if (!globalPcmWorkletNode) {
        await initializePCMWorklet();
      }

      // Set output device if specified and supported (non-blocking)
      if (outputDeviceId && globalAudioContext && 'setSinkId' in globalAudioContext.destination) {
        try {
          await (globalAudioContext.destination as any).setSinkId(outputDeviceId);
          debugLog(`[Gemini Live Audio] Set output device: ${outputDeviceId}`);
        } catch (error) {
          debugWarn('[Gemini Live Audio] Could not set output device, continuing with default:', error);
          // Continue with audio playback even if device setting fails
        }
      }

      if (globalPcmWorkletNode && globalAudioContext) {
        try {
          // Create a copy of the ArrayBuffer to avoid detached buffer issues
          const audioDataCopy = audioData.slice(0);

          // Gemini returns 24kHz 16-bit PCM audio
          const int16Array = new Int16Array(audioDataCopy);

          // No resampling needed if audio context is 24kHz
          // Convert directly to Float32 (-1 to 1 range)
          const float32Array = new Float32Array(int16Array.length);
          for (let i = 0; i < int16Array.length; i++) {
            // Apply slight gain reduction to prevent clipping
            float32Array[i] = (int16Array[i] / 32768.0) * 0.8;
          }

          // Send the audio data to the worklet
          globalPcmWorkletNode.port.postMessage(float32Array);

          debugLog(`[Gemini Live Audio] Successfully sent ${float32Array.length} samples to PCM worklet`);
          debugLog('[Gemini Live Audio] Audio playback initiated successfully via PCM worklet');
          return;
        } catch (workletError) {
          console.error('[Gemini Live Audio] PCM worklet playback failed:', workletError);
        }
      }
    }

    // Fallback: Try to play as WAV with correct format
    debugWarn('[Gemini Live Audio] PCM worklet failed, attempting WAV conversion');
    try {
      // Create a copy of the ArrayBuffer to avoid detached buffer issues
      const audioDataCopy = audioData.slice(0);
      const wavData = createWavFromPcm(audioDataCopy);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.8; // Reduce volume to avoid distortion

      // Set output device for WAV fallback (non-blocking)
      if (outputDeviceId && 'setSinkId' in audio) {
        try {
          await (audio as any).setSinkId(outputDeviceId);
          debugLog(`[Gemini Live Audio] Set output device for WAV fallback: ${outputDeviceId}`);
        } catch (deviceError) {
          debugWarn('[Gemini Live Audio] Could not set output device for WAV fallback, continuing with default:', deviceError);
          // Continue with audio playback even if device setting fails
        }
      }

      await audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
      debugLog('[Gemini Live Audio] Playing as WAV blob');
    } catch (wavError) {
      console.error('[Gemini Live Audio] Failed to play as WAV:', wavError);
    }
  } catch (error) {
    console.error('[Gemini Live Audio] Failed to play audio:', error);
  }
};

// Helper function to create WAV header for PCM data
const createWavFromPcm = (pcmData: ArrayBuffer): ArrayBuffer => {
  // Ensure we have a valid ArrayBuffer
  if (!pcmData || pcmData.byteLength === 0) {
    debugWarn('[Gemini Live Audio] Empty PCM data provided to createWavFromPcm');
    // Return a minimal valid WAV file with silence
    const silentWav = new ArrayBuffer(44);
    const view = new DataView(silentWav);
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true);
    view.setUint32(28, 24000 * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, 0, true);
    return silentWav;
  }

  const pcmLength = pcmData.byteLength;
  const wavBuffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(wavBuffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 24000, true); // sample rate (Gemini outputs at 24kHz)
  view.setUint32(28, 24000 * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, pcmLength, true);

  try {
    // Copy PCM data safely
    const pcmView = new Uint8Array(pcmData);
    const wavView = new Uint8Array(wavBuffer);
    wavView.set(pcmView, 44);
  } catch (error) {
    debugError('[Gemini Live Audio] Error copying PCM data to WAV buffer:', error);
    // Return the header-only WAV if data copy fails
    const headerOnlyWav = wavBuffer.slice(0, 44);
    const headerView = new DataView(headerOnlyWav);
    headerView.setUint32(4, 36, true); // Update file size
    headerView.setUint32(40, 0, true); // Update data size
    return headerOnlyWav;
  }

  return wavBuffer;
};
