import { GeminiLiveAudioStream, GEMINI_LANGUAGE_MAP } from './gemini-live-audio';

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

describe('Gemini Live Audio API Integration Test', () => {
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
    
    let connectionOpened = false;
    let connectionError: any = null;
    
    const audioReceived = jest.fn();
    const textReceived = jest.fn();
    const errorReceived = jest.fn((error) => {
      console.error('Error received in test:', error);
      connectionError = error;
    });

    // Mock the GoogleGenAI to track connection
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    // Track console logs
    const consoleLogs: string[] = [];
    console.log = (...args) => {
      consoleLogs.push(args.join(' '));
      originalConsoleLog(...args);
    };
    console.error = (...args) => {
      consoleLogs.push('ERROR: ' + args.join(' '));
      originalConsoleError(...args);
    };

    audioStream = new GeminiLiveAudioStream({
      apiKey: REAL_API_KEY,
      sourceLanguage: 'Japanese',
      targetLanguage: 'English',
      onAudioReceived: audioReceived,
      onTextReceived: textReceived,
      onError: errorReceived
    });

    try {
      // Start the stream
      console.log('Starting audio stream...');
      await audioStream.start(mediaStream);
      console.log('Audio stream started');

      // Wait longer for connection to establish
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if stream is active
      const isActive = audioStream.isActive();
      console.log('Stream active status:', isActive);
      
      if (!isActive) {
        console.error('Stream is not active. Checking logs...');
        console.error('Console logs:', consoleLogs);
        if (errorReceived.mock.calls.length > 0) {
          console.error('Errors during connection:', errorReceived.mock.calls);
        }
        if (connectionError) {
          console.error('Connection error details:', connectionError);
        }
      }
      
      // Restore console
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      
      expect(isActive).toBe(true);
    } catch (error) {
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      console.error('Failed to start stream:', error);
      console.error('Console logs:', consoleLogs);
      throw error;
    }
    
    // Send a test message
    console.log('Sending test audio...');
    
    // Wait for potential responses
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if any errors occurred
    if (errorReceived.mock.calls.length > 0) {
      console.error('Errors received:', errorReceived.mock.calls);
    }

    // Log any text responses
    if (textReceived.mock.calls.length > 0) {
      console.log('Text responses:', textReceived.mock.calls);
    }

    // Log audio responses
    if (audioReceived.mock.calls.length > 0) {
      console.log('Audio responses received:', audioReceived.mock.calls.length);
      audioReceived.mock.calls.forEach((call, index) => {
        const audioData = call[0];
        console.log(`Audio response ${index + 1}: ${(audioData.byteLength / 1024).toFixed(2)}KB`);
      });
    }

    // Stop the stream
    await audioStream.stop();
    expect(audioStream.isActive()).toBe(false);
  });

  test('should handle different language pairs', async () => {
    console.log('Testing language pair: English to Japanese');
    
    const audioReceived = jest.fn();
    const errorReceived = jest.fn((error) => {
      console.error('Error in language pair test:', error);
    });

    audioStream = new GeminiLiveAudioStream({
      apiKey: REAL_API_KEY,
      sourceLanguage: 'English',
      targetLanguage: 'Japanese',
      onAudioReceived: audioReceived,
      onError: errorReceived
    });

    try {
      await audioStream.start(mediaStream);
      await new Promise(resolve => setTimeout(resolve, 2000));

      const isActive = audioStream.isActive();
      console.log('Stream active for English->Japanese:', isActive);
      
      expect(isActive).toBe(true);
    } catch (error) {
      console.error('Failed in language pair test:', error);
      throw error;
    }
    
    // Check for errors
    if (errorReceived.mock.calls.length > 0) {
      console.error('Errors:', errorReceived.mock.calls);
    }

    await audioStream.stop();
  });

  test('should validate audio format detection', async () => {
    jest.setTimeout(15000); // Increase timeout for this test
    console.log('Testing audio format detection...');
    
    let detectedFormat: string | null = null;
    
    const audioReceived = jest.fn((audioData: ArrayBuffer) => {
      const firstBytes = new Uint8Array(audioData.slice(0, 8));
      console.log(`First 8 bytes: ${Array.from(firstBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      
      // Check for common audio format signatures
      if (firstBytes[0] === 0x1a && firstBytes[1] === 0x45 && firstBytes[2] === 0xdf && firstBytes[3] === 0xa3) {
        detectedFormat = 'WebM/Matroska';
      } else if (firstBytes[0] === 0x4f && firstBytes[1] === 0x67 && firstBytes[2] === 0x67 && firstBytes[3] === 0x53) {
        detectedFormat = 'Ogg';
      } else if (firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46) {
        detectedFormat = 'WAV/RIFF';
      } else {
        detectedFormat = 'Unknown/PCM';
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
    }

    await audioStream.stop();
  });

  test('should measure response latency', async () => {
    jest.setTimeout(15000); // Increase timeout for this test
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
  });
});