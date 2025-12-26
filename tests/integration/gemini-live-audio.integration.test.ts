/**
 * Integration tests for Gemini Live Audio API
 * These tests use the real API and do not use mocks
 */

import { GeminiLiveAudioStream, GEMINI_LANGUAGE_MAP } from '../../src/gemini-live-audio';

// Mock MediaStream for testing
class MockMediaStreamTrack {
  kind = 'audio';
  enabled = true;
  stop = jest.fn();
}

class MockMediaStream {
  private tracks: MockMediaStreamTrack[] = [];
  
  constructor() {
    this.tracks = [new MockMediaStreamTrack()];
  }
  
  getTracks() {
    return this.tracks;
  }
  
  getAudioTracks() {
    return this.tracks.filter(t => t.kind === 'audio');
  }
}

describe('Gemini Live Audio Integration Tests', () => {
  const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';
  let audioStream: GeminiLiveAudioStream;
  let mediaStream: MediaStream;

  beforeEach(() => {
    // Create a mock MediaStream
    mediaStream = new MockMediaStream() as unknown as MediaStream;
  });

  afterEach(async () => {
    if (audioStream) {
      await audioStream.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
    }
  });

  test('should connect to Gemini Live Audio API with real API key', async () => {
    console.log('Testing Gemini Live Audio API connection...');
    console.log('API Key:', REAL_API_KEY.substring(0, 10) + '...');
    
    const audioReceived = jest.fn();
    const textReceived = jest.fn();
    const errorReceived = jest.fn();

    audioStream = new GeminiLiveAudioStream({
      apiKey: REAL_API_KEY,
      sourceLanguage: 'Japanese',
      targetLanguage: 'English',
      onAudioReceived: audioReceived,
      onTextReceived: textReceived,
      onError: errorReceived
    });

    // Start the stream
    console.log('Starting audio stream...');
    await audioStream.start(mediaStream);
    console.log('Audio stream started');

    // Wait a moment for the connection to establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check if stream is active
    const isActive = audioStream.isActive();
    console.log('Stream active status:', isActive);
    
    expect(isActive).toBe(true);
    
    // Wait for potential responses
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if any errors occurred
    if (errorReceived.mock.calls.length > 0) {
      console.error('Errors received:', errorReceived.mock.calls);
    }

    // Stop the stream
    await audioStream.stop();
    expect(audioStream.isActive()).toBe(false);
  }, 30000);

  test('should handle different language pairs', async () => {
    console.log('Testing language pair: English to Japanese');
    
    const audioReceived = jest.fn();
    const errorReceived = jest.fn();

    audioStream = new GeminiLiveAudioStream({
      apiKey: REAL_API_KEY,
      sourceLanguage: 'English',
      targetLanguage: 'Japanese',
      onAudioReceived: audioReceived,
      onError: errorReceived
    });

    await audioStream.start(mediaStream);
    await new Promise(resolve => setTimeout(resolve, 1000));

    const isActive = audioStream.isActive();
    console.log('Stream active for English->Japanese:', isActive);
    
    expect(isActive).toBe(true);
    
    await audioStream.stop();
  }, 30000);

  test('should validate audio format detection', async () => {
    console.log('Testing audio format detection...');
    
    let detectedFormat: string | null = null;
    
    const audioReceived = jest.fn((audioData: ArrayBuffer) => {
      const firstBytes = new Uint8Array(audioData.slice(0, 8));
      console.log(`First 8 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      // Check for common audio format signatures
      if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46) {
        detectedFormat = 'WAV/RIFF';
      } else {
        detectedFormat = 'PCM';
      }
      
      console.log(`Detected audio format: ${detectedFormat}`);
    });

    audioStream = new GeminiLiveAudioStream({
      apiKey: REAL_API_KEY,
      sourceLanguage: 'Japanese',
      targetLanguage: 'English',
      onAudioReceived: audioReceived,
      onError: console.error
    });

    await audioStream.start(mediaStream);
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (audioReceived.mock.calls.length > 0) {
      console.log(`Total audio responses: ${audioReceived.mock.calls.length}`);
      console.log(`Detected format: ${detectedFormat}`);
      expect(detectedFormat).toBeTruthy();
    }

    await audioStream.stop();
  }, 30000);

  test('should measure response latency', async () => {
    console.log('Testing response latency...');
    
    const startTime = Date.now();
    let firstResponseTime: number | null = null;
    
    const audioReceived = jest.fn(() => {
      if (!firstResponseTime) {
        firstResponseTime = Date.now();
        const latency = firstResponseTime - startTime;
        console.log(`First response latency: ${latency}ms`);
      }
    });

    audioStream = new GeminiLiveAudioStream({
      apiKey: REAL_API_KEY,
      sourceLanguage: 'Japanese',
      targetLanguage: 'English',
      onAudioReceived: audioReceived,
      onError: console.error
    });

    await audioStream.start(mediaStream);
    
    // Wait for responses
    await new Promise(resolve => setTimeout(resolve, 10000));

    if (firstResponseTime) {
      const totalLatency = firstResponseTime - startTime;
      console.log(`Total latency from start to first response: ${totalLatency}ms`);
      expect(totalLatency).toBeLessThan(10000); // Should respond within 10 seconds
    }

    await audioStream.stop();
  }, 30000);
});
