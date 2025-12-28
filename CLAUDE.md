# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **otak-conference**, a real-time translation conference application that enables multilingual communication using WebRTC, Gemini Live Audio API, and features a WebGL generative art background. The project combines React frontend with Cloudflare Workers backend for serverless WebRTC signaling.

## Development Commands

### Building and Development
```bash
# Development with HTTPS tunnel (recommended - required for microphone access)
npm run dev:tunnel

# Local HTTP development (no microphone access)
npm run dev:frontend

# Production build
npm run build

# Development build with commit hash
npm run build:dev

# Cloudflare Workers development
npm run dev
```

### Testing
```bash
# Run all tests (70+ tests across unit, integration, API)
npm run test:all

# Unit tests only (52 tests - components, WebGL, business logic)
npm test
npm run test:watch

# API integration tests (14 tests - health checks, WebSocket, error handling)
npm run test:api
npm run test:api:watch

# Gemini Live Audio integration tests (4 tests - real API calls)
npm run test:integration
npm run test:integration:watch

# Test coverage
npm run test:coverage
```

### Deployment
```bash
# Deploy frontend to GitHub Pages
npm run deploy-gh-pages

# Deploy backend to Cloudflare Workers
npm run deploy
```

## Architecture

### Modular Frontend Architecture
The application uses a clean modular architecture:

- **main.tsx**: Application entry point and React root mounting
- **hooks.ts**: Core business logic in `useConferenceApp()` hook (2000+ lines) - **CRITICAL: Contains all state management and WebRTC logic**
- **components.tsx**: UI components and JSX structure  
- **types.ts**: TypeScript interfaces and type definitions
- **generative-art-background-webgl.tsx**: WebGL particle system with 5000+ particles

### Key Modules
- **gemini-live-audio.ts**: Gemini Live Audio streaming integration with real-time translation - **Contains GeminiLiveAudioStream class with session management**
- **gemini-utils.ts**: Audio processing utilities for Gemini API
- **translation-prompts.ts**: Multilingual system prompts for 25+ languages
- **debug-utils.ts**: Debug logging utilities with different log levels

### Backend Architecture
- **worker.js**: Main Cloudflare Worker with routing and request handling
- **room-handler.js**: Durable Object for WebSocket room management and participant coordination

### Key Technologies
- **WebGL**: Hardware-accelerated particle rendering with custom shaders
- **AudioWorklet**: Real-time audio processing (`pcm-processor.js`, `audio-capture-processor.js`)
- **WebRTC**: Peer-to-peer audio/video communication with ICE servers
- **Gemini Live Audio**: Native audio dialog API for real-time translation

## Important Implementation Details

### Audio Processing Pipeline
The application has a sophisticated audio processing chain:
1. **Raw audio capture** from microphone with device selection
2. **Noise filtering** (high-pass, low-pass, compression, gain control)
3. **WebRTC transmission** (optional raw audio to peers)
4. **Gemini Live Audio streaming** for real-time translation
5. **Audio level detection** for speaking indicators

### Critical Data Flow
1. **Audio Input**: Microphone → AudioWorklet → Gemini Live Audio (15ms intervals in ULTRAFAST mode)
2. **Translation**: Gemini processes audio and returns translated audio + text
3. **Distribution**: Translated audio sent to WebRTC peers + local playback
4. **UI Updates**: Speaking indicators, translations list, particle effects respond to conference state

## 🔄 Real-Time Processing Flow

### 1. Audio Capture & Voice Activity Detection (VAD)
```
User Speech → Microphone → AudioWorkletProcessor
    ↓
Voice Activity Detection (Advanced VAD)
    ├── Energy-based detection
    ├── Zero-crossing rate analysis  
    ├── Adaptive threshold calculation
    └── History-based smoothing
    ↓
Adaptive Interval Calculation:
    ├── Active speech: 15ms intervals
    ├── Recent speech: 25ms intervals
    ├── Moderate silence: 100ms intervals
    └── Extended silence: 300ms intervals
```

### 2. Audio Processing Pipeline Detailed Flow
```
Raw Audio (Float32Array) → AudioWorklet
    ↓
Advanced VAD Analysis
    ├── RMS Energy: √(Σx²/N)
    ├── Zero Crossings: Count sign changes
    ├── Adaptive Threshold: max(0.01, avgEnergy × 2.0)
    └── Smoothing: 3/5 positive detections required
    ↓
Audio Buffering & Adaptive Sending
    ├── Buffer audio chunks
    ├── Apply adaptive interval (15ms-300ms)
    └── Send to Gemini when interval reached
    ↓
Optimized PCM Encoding
    ├── 4-sample parallel processing
    ├── Unrolled loops for performance
    ├── 8KB chunk-based base64 encoding
    └── Send to Gemini Live Audio API
```

### 3. Gemini Live Audio Translation Flow
```
Gemini Live Audio API
    ├── Input: base64 PCM (16kHz)
    ├── Processing: Real-time translation (~250ms)
    ├── Output: Translated audio (24kHz) + text
    └── Streaming response handling
    ↓
Audio Output Pipeline
    ├── PCM Processor (250ms buffer - optimized)
    ├── Audio playback (local + WebRTC peers)
    └── Text display (800ms buffer for readability)
```

### 4. WebSocket Communication Flow
```
Client A                    Server                     Client B
   │                          │                          │
   ├── speaking-status ────→   │   ────→ broadcast ────→  │
   │   (100ms intervals)       │                          │
   │                          │                          │
   ├── translated-audio ───→   │   ────→ relay ────────→  │
   │   (base64 encoded)        │                          │
   │                          │                          │
   ├── join/leave ─────────→   │   ────→ participant ──→  │
   │                          │         management       │
```

### 5. WebRTC P2P Communication
```
Peer A                                                 Peer B
   │                                                     │
   ├── ICE Gathering (bundlePolicy: max-bundle) ────────│
   │                                                     │
   ├── Offer/Answer Exchange ──────────────────────────→ │
   │                                                     │
   ├── Direct P2P Audio Stream ────────────────────────→ │
   │   (optimized for low latency)                       │
```

### 6. Performance Optimizations Applied

#### **Ultra-Low Latency Optimizations**
- **Adaptive Audio Intervals**: 15ms (speech) → 300ms (silence)
- **PCM Buffer Reduction**: 1000ms → 250ms (750ms improvement)
- **Optimized Encoding**: 4-sample parallel + chunked base64
- **WebRTC Optimization**: max-bundle + ICE pooling
- **Speaking Detection**: 500ms → 100ms intervals

#### **Current Latency Breakdown (Theory)**
```
User Speech → [15ms] → VAD Detection → [15ms] → Gemini Send
→ [250ms] → Gemini Processing → [250ms] → PCM Buffer
→ [10ms] → Audio Output

Total: ~540ms (vs ~1.7s before optimization)
```

#### **Bottleneck Analysis**
1. 🔴 **Gemini API Response**: ~250ms (largest bottleneck)
2. 🟡 **PCM Buffering**: 250ms (further reducible to 100ms)
3. 🟢 **Network Latency**: ~10-50ms (geographical)
4. 🟢 **Processing Overhead**: ~30ms (optimized)

### Translation Flow
1. User speaks in their language
2. Audio sent to Gemini Live Audio API for real-time translation
3. Translated audio received from Gemini
4. Local playback (configurable) and transmission to other participants
5. Text translations displayed in UI

### Translation Speed Modes
The application supports multiple translation speed settings:
- **ULTRAFAST**: 15ms audio intervals, ~0.5s delay, 15x cost ($7.50/hour) - **DEFAULT** (最適化済み)
- **REALTIME**: 300ms intervals, ~1s delay, 5x cost
- **BALANCED**: 800ms intervals, ~2s delay, 2x cost  
- **ECONOMY**: 1500ms intervals, ~4s delay, 1x cost ($0.50/hour)

### Voice Selection
Supports prebuilt Gemini voices:
- **Zephyr** (default)
- **Puck**
- **Kore**

### State Management
The `useConferenceApp` hook manages extensive state:
- **Connection state**: WebSocket, WebRTC peer connections
- **Media state**: audio/video streams, device selection, noise filtering
- **Conference state**: participants, translations, chat messages
- **API usage tracking**: token consumption, costs, session counts
- **Translation settings**: speed mode, voice selection, local playback control

### WebGL Particle System
- **5000+ particles** with GPU-accelerated rendering
- **Conference-aware effects**: particles respond to speaking status
- **Perlin noise flow fields** for organic particle movement
- **Interactive effects**: mouse/touch influence and avatar formations

## File Organization Patterns

### Frontend Files (Root Level)
All main frontend modules are in the repository root for easy access and modification.

### Testing Structure
```
tests/
├── unit/                    # Component and module tests with mocks
├── integration/             # Real API integration tests  
├── scripts/                 # Test utility scripts
└── __mocks__/              # Mock implementations
```

### Configuration Files
- **tsconfig.json**: TypeScript configuration with strict types
- **tailwind.config.js**: Tailwind CSS configuration
- **jest.*.config.js**: Multiple Jest configurations for different test types
- **wrangler.toml**: Cloudflare Workers configuration

## Development Guidelines

### Modular Development
When making changes:
1. **Business logic** goes in `hooks.ts`
2. **UI components** go in `components.tsx`
3. **Type definitions** go in `types.ts`
4. Keep the modular architecture - avoid creating monolithic components

### Testing Requirements
- Write tests for new features across all test categories
- WebGL components require shader compilation tests
- Audio features need AudioWorklet and real-time processing tests
- API integrations require both mocked and real API tests

### Audio Development
- Use `debugLog`, `debugWarn`, `debugError` for audio-related logging
- Respect noise filter settings and device selection
- Handle AudioContext lifecycle properly
- Test with both Chrome and Firefox (different WebRTC implementations)

### WebGL Development
- Particle system is performance-critical (60fps target)
- Use proper WebGL resource cleanup
- Test shader compilation on different GPUs
- Handle WebGL context loss gracefully

### Gemini API Integration
- API key stored in localStorage with security considerations
- Token usage tracked for cost monitoring
- Handle both solo mode (local development) and multi-participant translation
- Respect local playback settings for user experience
- **Audio Quality Settings**: Uses `enableAffectiveDialog: true` for improved audio quality
- **MIME Type Parsing**: Supports Google's official audio format parsing (`audio/L16;rate=24000`)
- **WAV Creation**: Dual methods - direct from chunks (preferred) and decoded buffer (fallback)

## Common Development Tasks

### Adding New Languages
1. Add language mapping to `GEMINI_LANGUAGE_MAP` in `gemini-live-audio.ts`
2. Add system prompts in `translation-prompts.ts`
3. Update language selection UI in `components.tsx`

### Adding New Voices
1. Add voice to voice enum in `types.ts`
2. Update voice selection UI in `components.tsx`
3. Voice automatically applied to Gemini Live Audio configuration

### Modifying Audio Pipeline
1. Audio processing logic is in `hooks.ts` (`setupNoiseFilterChain`, `setupAudioLevelDetection`)
2. AudioWorklet processors are in `public/` directory
3. Test with different devices and browsers

### WebGL Modifications
1. Core particle system in `generative-art-background-webgl.tsx`
2. Shaders and rendering logic are GPU-optimized
3. Conference integration for dynamic effects

### Audio Quality Troubleshooting
If experiencing audio issues (echo, reverb, poor quality):
1. **Check Affective Dialog**: Ensure `enableAffectiveDialog: true` for natural voice
2. **Speed Settings**: Slower translation speeds generally have better quality
3. **Local Playback**: Toggle local playback to prevent audio feedback loops
4. **Device Settings**: Check microphone/speaker device selection

### Backend Changes
1. WebSocket signaling in `room-handler.js`
2. Room management and participant coordination
3. Deploy to Cloudflare Workers for testing

## Environment Variables

- `CLOUDFLARE_WORKER_DOMAIN`: WebSocket signaling server domain
- `REACT_APP_COMMIT_HASH`: Build commit hash (injected by build script)
- `NODE_ENV`: Environment detection for local development features

## HTTPS Requirement

WebRTC and microphone access require HTTPS. Use `npm run dev:tunnel` for local development with Cloudflare Tunnels to get a secure HTTPS URL.
