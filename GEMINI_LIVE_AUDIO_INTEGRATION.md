# Gemini Live Audio Integration

## Overview
This document describes the integration of Gemini 2.5 Flash Native Audio Dialog for real-time audio translation in the otak-conference application.

## Implementation Details

### 1. Core Module: `gemini-live-audio.ts`
- **Purpose**: Handles real-time audio streaming and translation using Gemini's Live Audio API
- **Key Features**:
  - Real-time audio capture from MediaStream
  - Audio processing and PCM conversion
  - Bidirectional streaming with Gemini API
  - Automatic language detection and translation
  - Audio playback of translated content

### 2. Key Components

#### GeminiLiveAudioStream Class
```typescript
export class GeminiLiveAudioStream {
  constructor(config: GeminiLiveAudioConfig)
  async start(mediaStream: MediaStream): Promise<void>
  async stop(): Promise<void>
  isActive(): boolean
}
```

#### Configuration Interface
```typescript
export interface GeminiLiveAudioConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onError?: (error: Error) => void;
}
```

### 3. Integration Points

#### Conference Start (`hooks.ts`)
When a user starts a conference:
1. Creates a new `GeminiLiveAudioStream` instance
2. Configures it with the user's API key and language preferences
3. Starts streaming audio from the user's microphone
4. Handles translated audio playback automatically

```typescript
// Start Gemini Live Audio Stream
const sourceLanguage = GEMINI_LANGUAGE_MAP[myLanguage] || 'English';
liveAudioStreamRef.current = new GeminiLiveAudioStream({
  apiKey,
  sourceLanguage,
  targetLanguage: 'English', // Dynamic based on participants
  onAudioReceived: async (audioData) => {
    await playAudioData(audioData);
  },
  onTextReceived: (text) => {
    console.log('Translated text:', text);
  },
  onError: (error) => {
    console.error('Gemini Live Audio error:', error);
  }
});
await liveAudioStreamRef.current.start(localStreamRef.current);
```

#### Conference End
When ending a conference:
1. Stops the Gemini Live Audio stream
2. Cleans up resources
3. Resets the stream reference

```typescript
if (liveAudioStreamRef.current) {
  liveAudioStreamRef.current.stop();
  liveAudioStreamRef.current = null;
}
```

### 4. Audio Processing Pipeline

1. **Capture**: Audio is captured from the user's microphone at 16kHz
2. **Processing**: Audio is converted to 16-bit PCM format
3. **Streaming**: PCM data is base64 encoded and sent to Gemini
4. **Translation**: Gemini processes and translates the audio
5. **Response**: Translated audio is received and decoded
6. **Playback**: Audio is played through the user's speakers

### 5. Language Support

The system supports 25 languages with automatic mapping:
- English, Japanese, Chinese (Simplified/Traditional)
- Korean, Spanish, French, German, Italian
- Portuguese, Russian, Arabic, Hindi, Bengali
- Vietnamese, Thai, Turkish, Polish, Czech
- Hungarian, Bulgarian, Javanese, Tamil, Burmese, Hebrew

### 6. System Instructions

The Gemini model is configured with specific instructions:
```
You are a real-time translator. The user will speak in [sourceLanguage]. 
Please translate their speech into [targetLanguage] and output both the 
translated text and audio. Keep translations natural and conversational.
```

### 7. Performance Optimizations

- **Chunked Processing**: Audio is processed in ~0.5 second chunks
- **Efficient Encoding**: Uses base64 encoding for network transmission
- **Resource Management**: Proper cleanup of audio contexts and streams
- **Error Handling**: Graceful degradation on API failures

### 8. Common Issues and Troubleshooting

#### EncodingError: Unable to decode audio data

This error occurs when the Gemini Live API cannot decode the received audio data. Here are the main causes and solutions:

**🔍 Main Causes:**

1. **Incorrect Audio Format**
   - Gemini Live API expects **16-bit little-endian PCM, 16kHz, mono** format
   - Any other format may cause decoding errors
   
   **Solution:**
   - Ensure audio data matches the specified format
   - Set MIME type to `"audio/pcm;rate=16000"` when sending audio data

2. **Incomplete or Corrupted Audio Data**
   - Received audio data is incomplete or corrupted
   - Can occur during streaming when chunks are not properly assembled
   
   **Solution:**
   - Verify audio data is completely received before processing
   - For streaming audio, ensure data chunks are correctly assembled
   - Implement data integrity checks

3. **Reusing the Same ArrayBuffer**
   - Some browsers throw errors when the same `ArrayBuffer` is passed to `decodeAudioData()` multiple times
   
   **Solution:**
   - Don't reuse `ArrayBuffer` instances
   - Create new buffers as needed
   - Reuse decoded `AudioBuffer` objects instead of re-decoding

**🛠️ Implementation Best Practices:**

```typescript
// Correct audio format configuration
const audioConfig = {
  sampleRate: 16000,
  channelCount: 1,
  sampleFormat: 'int16'
};

// Proper error handling for audio decoding
try {
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice());
  // Use audioBuffer...
} catch (error) {
  console.error('[Gemini Live Audio] Audio decode error:', error);
  // Implement fallback or retry logic
}

// WebSocket data assembly verification
let audioChunks: ArrayBuffer[] = [];
websocket.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    audioChunks.push(event.data);
    // Verify chunk integrity before processing
    if (isCompleteAudioChunk(audioChunks)) {
      processAudioData(combineChunks(audioChunks));
      audioChunks = [];
    }
  }
};
```

**📋 Debugging Checklist:**

- [ ] Audio format is 16-bit PCM, 16kHz, mono
- [ ] MIME type is set to `"audio/pcm;rate=16000"`
- [ ] Audio data is complete before decoding
- [ ] Not reusing the same ArrayBuffer
- [ ] Proper error handling is implemented
- [ ] Browser compatibility is verified

### 9. Testing

- Mock implementations provided for unit testing
- All 46 tests passing with the integration
- API integration tests verify deployment functionality

### 10. Future Enhancements

1. **Dynamic Target Language**: Automatically detect and translate to each participant's language
2. **Multi-party Translation**: Support multiple simultaneous translations
3. **Transcription Display**: Show real-time transcriptions in the UI
4. **Voice Selection**: Allow users to choose different voice profiles
5. **Noise Reduction**: Implement audio preprocessing for better quality
## Troubleshooting

### Common Issues and Solutions

1. **EncodingError: Unable to decode audio data**
   - This error occurs when the browser cannot decode the audio format
   - **Fixed in latest version**:
     - Implemented AudioWorklet-based PCM audio playback (following Google's official sample)
     - Added automatic WAV header creation for raw PCM data as fallback
     - The `playAudioData` function now uses AudioWorklet for optimal PCM handling
     - Falls back to direct decoding or PCM-to-WAV conversion if worklet fails

2. **WebSocket connection errors**
   - Check that the API key is valid
   - Ensure the browser has microphone permissions
   - Verify network connectivity
   - **Fixed in latest version**: Added proper session state checking before sending audio chunks
   - Audio processing stops automatically when session closes

3. **"WebSocket is already in CLOSING or CLOSED state" errors**
   - **Fixed in latest version**: Added session state validation in `sendAudioChunk`
   - Script processor properly disconnects on stop
   - Audio processing halts when session is closing
   - No more attempts to send data after session closure

4. **No audio output**
   - Check browser console for errors
   - Verify that the audio context is not suspended
   - Ensure speakers/headphones are connected and volume is up
   - Check if audio data is being received (console logs will show)

5. **INVALID_ARGUMENT errors from Gemini API**
   - This occurs when using incompatible modality configurations
   - Solution: Use only AUDIO modality, not TEXT+AUDIO combination
   - Ensure proper audio format (16kHz PCM)
   - Verify API key has access to Native Audio features

### Debug Tips

- Enable verbose logging by checking console output with `[Gemini Live Audio]` prefix
- Monitor WebSocket connection state in browser DevTools
- Check Network tab for API requests and responses
- Verify audio permissions in browser settings
- Check if AudioWorklet is properly loaded (look for "Audio worklet initialized successfully" in console)
- Verify PCM audio format: should be 16-bit, 16kHz mono

### AudioWorklet Implementation

The latest version uses AudioWorklet for optimal PCM audio playback:

1. **PCM Processor**: Located at `/public/pcm-processor.js`
2. **Benefits**:
   - Runs on separate audio thread for better performance
   - Handles streaming PCM data efficiently
   - No audio glitches or dropouts
3. **Fallback**: If AudioWorklet fails, falls back to WAV conversion method

## Usage

1. Enter your Gemini API key in settings
2. Select your preferred language
3. Start a conference
4. Speak naturally - your audio will be automatically translated
5. Hear translations from other participants in real-time

## API Pricing (Gemini 2.5 Flash Native Audio)

- **Input**: $0.50/1M tokens (text), $3.00/1M tokens (audio)
- **Output**: $2.00/1M tokens (text), $12.00/1M tokens (audio)

## Technical Requirements

- Modern browser with WebRTC support
- Microphone permissions
- Stable internet connection
- Valid Gemini API key with Native Audio access