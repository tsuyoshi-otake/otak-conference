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
 * Ultra-optimized Float32Array to base64 encoded PCM with 8-sample SIMD-style processing
 */
export function float32ToBase64PCM(float32Array: Float32Array): string {
  const int16Array = new Int16Array(float32Array.length);
  
  // Process 8 samples at once for maximum CPU pipeline utilization
  const len = float32Array.length;
  const len8 = Math.floor(len / 8) * 8;
  
  // Extreme optimization: 8-sample unrolled loop
  for (let i = 0; i < len8; i += 8) {
    // Manual vectorization for modern CPUs
    const s0 = Math.max(-1, Math.min(1, float32Array[i]));
    const s1 = Math.max(-1, Math.min(1, float32Array[i + 1]));
    const s2 = Math.max(-1, Math.min(1, float32Array[i + 2]));
    const s3 = Math.max(-1, Math.min(1, float32Array[i + 3]));
    const s4 = Math.max(-1, Math.min(1, float32Array[i + 4]));
    const s5 = Math.max(-1, Math.min(1, float32Array[i + 5]));
    const s6 = Math.max(-1, Math.min(1, float32Array[i + 6]));
    const s7 = Math.max(-1, Math.min(1, float32Array[i + 7]));
    
    int16Array[i] = s0 < 0 ? s0 * 0x8000 : s0 * 0x7FFF;
    int16Array[i + 1] = s1 < 0 ? s1 * 0x8000 : s1 * 0x7FFF;
    int16Array[i + 2] = s2 < 0 ? s2 * 0x8000 : s2 * 0x7FFF;
    int16Array[i + 3] = s3 < 0 ? s3 * 0x8000 : s3 * 0x7FFF;
    int16Array[i + 4] = s4 < 0 ? s4 * 0x8000 : s4 * 0x7FFF;
    int16Array[i + 5] = s5 < 0 ? s5 * 0x8000 : s5 * 0x7FFF;
    int16Array[i + 6] = s6 < 0 ? s6 * 0x8000 : s6 * 0x7FFF;
    int16Array[i + 7] = s7 < 0 ? s7 * 0x8000 : s7 * 0x7FFF;
  }
  
  // Process remaining samples
  for (let i = len8; i < len; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  
  // Ultra-fast base64 encoding with large chunks
  const bytes = new Uint8Array(int16Array.buffer);
  const chunkSize = 32768; // 32KB chunks for maximum throughput
  const chunks: string[] = [];
  
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.byteLength);
    let chunk = '';
    for (let j = i; j < end; j++) {
      chunk += String.fromCharCode(bytes[j]);
    }
    chunks.push(chunk);
  }
  
  return btoa(chunks.join(''));
}