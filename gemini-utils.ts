/**
 * Utility functions for Gemini Live Audio processing
 * Based on Google's official sample implementation
 */
import { debugLog, debugWarn, debugError } from './debug-utils';

/**
 * Create a blob from PCM audio data for sending to Gemini
 */
export function createBlob(pcmData: Float32Array): Blob {
  // Convert Float32 to Int16 PCM
  const int16Array = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    const sample = Math.max(-1, Math.min(1, pcmData[i]));
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  return new Blob([int16Array.buffer], { type: 'audio/pcm' });
}

/**
 * Decode base64 string to ArrayBuffer
 */
export function decode(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Decode audio data to AudioBuffer
 */
export async function decodeAudioData(
  audioData: ArrayBuffer,
  audioContext: AudioContext,
  sampleRate: number,
  channels: number
): Promise<AudioBuffer> {
  try {
    // Create a copy of the ArrayBuffer to avoid detached buffer issues
    const audioDataCopy = audioData.slice(0);
    
    // Try native decoding first
    return await audioContext.decodeAudioData(audioDataCopy);
  } catch (error) {
    // Fallback: assume raw PCM data
    debugLog('[Gemini Utils] Native decode failed, treating as raw PCM');
    
    try {
      // Create a fresh copy for PCM processing to avoid detached buffer
      const audioDataCopy = audioData.slice(0);
      const int16Array = new Int16Array(audioDataCopy);
      const audioBuffer = audioContext.createBuffer(channels, int16Array.length / channels, sampleRate);
      
      // Convert Int16 to Float32 and fill buffer
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < int16Array.length; i++) {
        channelData[i] = int16Array[i] / 32768.0;
      }
      
      return audioBuffer;
    } catch (pcmError) {
      debugError('[Gemini Utils] Failed to process as PCM:', pcmError);
      
      // Last resort: create a silent buffer
      const silentBuffer = audioContext.createBuffer(channels, sampleRate * 0.1, sampleRate); // 100ms silence
      debugWarn('[Gemini Utils] Created silent buffer as fallback');
      return silentBuffer;
    }
  }
}

/**
 * Convert Float32Array to base64 encoded PCM
 */
export function float32ToBase64PCM(float32Array: Float32Array): string {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  const bytes = new Uint8Array(int16Array.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}