# otak-conference v0.8.0

A real-time translation conference application that enables multilingual communication using WebRTC and Gemini Live Audio API, featuring a stunning WebGL generative art background.

## ✨ Features

### 🎯 Core Translation Features
- **Real-time Audio Translation**: Live voice translation using Gemini 2.5 Flash Native Audio Dialog
- **25+ Languages Support**: Seamless multilingual communication with automatic language detection
- **Bi-directional Translation**: Supports all participant language pairs simultaneously
- **Local Playback Control**: Toggle to control Gemini response playback

### 🚀 Advanced Communication
- **WebRTC Integration**: High-quality peer-to-peer audio/video conferencing
- **Screen Sharing**: Share your screen during conferences with remote display
- **Interactive Features**: Real-time chat, emoji reactions, hand raise system
- **Speaking Indicators**: Visual feedback for active speakers with audio level detection

### 🎨 Visual Excellence
- **WebGL Generative Art**: GPU-accelerated particle system background with 5000+ particles
- **Conference-Aware Effects**: Dynamic particle behaviors responding to conference state
- **Responsive Design**: Mobile-first with desktop optimization
- **Real-time Animations**: Hardware-accelerated rendering at 60fps

### 🔧 Technical Excellence
- **AudioWorklet Processing**: Low-latency audio processing in separate thread
- **Modular Architecture**: Clean separation of concerns with TypeScript
- **Comprehensive Testing**: 70+ tests covering unit, integration, and WebGL components
- **Performance Optimized**: GPU rendering and optimized audio pipeline

## Supported Languages

- English
- Français (French)
- Deutsch (German)
- Italiano (Italian)
- Español (Spanish)
- Português (Portuguese)
- Čeština (Czech)
- Magyar (Hungarian)
- Български (Bulgarian)
- Türkçe (Turkish)
- Polski (Polish)
- Русский (Russian)
- 日本語 (Japanese)
- 中文 (Chinese)
- 繁體中文 (Traditional Chinese)
- 한국어 (Korean)
- Tiếng Việt (Vietnamese)
- ไทย (Thai)
- हिन्दी (Hindi)
- বাংলা (Bengali)
- Basa Jawa (Javanese)
- தமிழ் (Tamil)
- မြန်မာဘာသာ (Burmese)
- العربية (Arabic)
- עברית (Hebrew)

## 🛠️ Technology Stack

### Frontend
- **Framework**: React 19 with TypeScript and Tailwind CSS
- **Architecture**: Modular design with custom hooks and components
- **Graphics**: WebGL-based generative art with custom shaders
- **Audio**: AudioWorklet-based PCM processing for real-time translation
- **Build**: esbuild for fast bundling and development

### Backend
- **Runtime**: Cloudflare Workers with Durable Objects
- **WebSocket**: Real-time signaling for WebRTC connections
- **Room Management**: Participant limits and message broadcasting
- **Architecture**: Lightweight and scalable serverless design

### APIs & Services
- **Translation**: Google Gemini 2.5 Flash Native Audio Dialog
- **Communication**: WebRTC for peer-to-peer audio/video
- **Deployment**: GitHub Pages (frontend), Cloudflare Workers (backend)
- **CI/CD**: GitHub Actions with automated testing

### Key Technologies
- **WebGL**: Hardware-accelerated particle rendering
- **Perlin Noise**: Organic flow field generation for particle movement
- **AudioWorklet**: Real-time audio processing in separate thread
- **WebRTC**: Direct peer-to-peer communication
- **WebSocket**: Low-latency signaling and messaging

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Cloudflare account (for backend deployment)
- Google Gemini API key

### Installation

1. Clone the repository:
```bash
git clone https://github.com/tsuyoshi-otake/otak-conference.git
cd otak-conference
```

2. Install dependencies:
```bash
npm install
```

3. Set up your Gemini API key:
   - Open the application
   - Enter your API key in the settings panel

### Development

#### HTTPS Local Development (Required for Microphone Access)

Since WebRTC and microphone access require HTTPS, use Cloudflare Tunnels for local development:

```bash
# Install Cloudflare Tunnel (Windows)
winget install --id=Cloudflare.cloudflared -e

# Start HTTPS development environment
npm run dev:tunnel
```

This will:
1. Build the frontend application
2. Start local HTTP server on localhost:3000
3. Create Cloudflare Tunnel with auto-generated HTTPS URL
4. Enable microphone access for audio translation features

**Example output:**
```
Your quick Tunnel has been created! Visit it at:
https://xxxxx-xxxxx-xxxxx.trycloudflare.com
```

#### Alternative Development Options

```bash
# Local HTTP development (no microphone access)
npm run dev:frontend

# Build for production
npm run build

# Deploy to GitHub Pages for HTTPS testing
npm run build && npm run deploy-gh-pages
```

#### Development Scripts
- `npm run dev:tunnel` - HTTPS development with Cloudflare Tunnels (recommended)
- `npm run dev:frontend` - Local HTTP development
- `npm run dev` - Cloudflare Workers development
- `npm run build:dev` - Development build with commit hash
- `npm run build` - Production build

### Testing

Run all tests:
```bash
npm run test:all
```

Run unit tests:
```bash
npm test
```

Run API integration tests:
```bash
npm run test:api
```

Run Gemini Live Audio integration tests:
```bash
npm run test:integration
```

### Development Workflow

1. Make changes to modular files (main.tsx, components.tsx, hooks.ts, types.ts)
2. Run comprehensive test suite to ensure quality
3. Build and commit changes
4. Automated deployment and testing via GitHub Actions

### Deployment

#### Frontend (GitHub Pages)

The frontend is automatically deployed to GitHub Pages when you push to the main branch.

#### Backend (Cloudflare Workers)

Deploy the backend:
```bash
npm run deploy
```

## 🎯 Usage

### Getting Started
1. **Configure Settings**: Enter your Gemini API key, username, and preferred language
2. **Start a Conference**: Click "Start Conference" to create a new room
3. **Share Room**: Click the share button to copy the room URL and invite participants
4. **Join a Conference**: Open a shared room URL to join an existing conference

### During Conference
- **Media Controls**: Toggle microphone, camera, and screen sharing
- **Audio Translation**: Enable real-time translation to communicate across languages
- **Interactive Features**: Use chat, reactions, and hand raise for better communication
- **Audio Settings**: Configure microphone/speaker devices and local playback preferences
- **Visual Experience**: Enjoy the dynamic WebGL background that responds to conference activity

### Advanced Features
- **Local Playback Control**: Toggle whether you hear Gemini's translated responses
- **Device Management**: Switch audio devices during conference without disconnection
- **Debug Mode**: Add `?debug=true` to URL for detailed logging
- **Performance**: GPU-accelerated rendering for smooth visual experience

## 📁 Project Structure

```
otak-conference/
├── public/
│   ├── index.html                   # Main HTML with Tailwind CDN
│   ├── bundle.js                    # Built React app
│   ├── pcm-processor.js             # AudioWorklet for PCM audio processing
│   ├── audio-capture-processor.js   # AudioWorklet for audio capture
│   ├── styles.css                   # Generated Tailwind CSS
│   ├── demo-*.html                  # WebGL demo files
│   └── favicon.svg                  # Monochrome project icon
├── Frontend (Modular):
│   ├── main.tsx                     # Application entry point
│   ├── components.tsx               # UI components and JSX structure
│   ├── hooks.ts                     # Custom hook with business logic
│   ├── types.ts                     # Interface and type definitions
│   ├── gemini-live-audio.ts         # Gemini Live Audio streaming module
│   ├── gemini-utils.ts              # Gemini audio processing utilities
│   ├── debug-utils.ts               # Debug utility functions
│   ├── translation-prompts.ts       # Multilingual system prompts
│   └── generative-art-background-webgl.tsx # WebGL generative art background
├── Backend (Modular):
│   ├── worker.js            # Main worker with routing
│   └── room-handler.js      # Durable Object for WebSocket room management
├── Legacy:
│   └── translation-conference-app.tsx  # Original monolithic component
├── Testing:
│   ├── tests/
│   │   ├── unit/                        # Unit tests with mocks
│   │   │   ├── translation-conference-app.test.tsx # Main app test suite (32 tests)
│   │   │   └── generative-art-background.test.tsx  # WebGL component tests (20 tests)
│   │   ├── integration/                 # Integration tests with real APIs
│   │   │   ├── api-integration.test.js  # API integration tests (14 tests)
│   │   │   └── gemini-live-audio.integration.test.ts # Gemini Live Audio tests (4 tests)
│   │   └── scripts/                     # Test utility scripts
│   ├── jest.config.js                   # Jest configuration for unit tests
│   ├── jest.api.config.js               # Jest configuration for API tests
│   ├── jest.integration.config.js       # Jest configuration for integration tests
│   └── __mocks__/                       # Mock implementations
├── Configuration:
│   ├── tsconfig.json        # TypeScript configuration
│   ├── package.json         # Dependencies and scripts (v0.8.0)
│   ├── wrangler.toml        # Cloudflare configuration
│   ├── tailwind.config.js   # Tailwind CSS configuration
│   └── global.d.ts          # Global TypeScript declarations
├── Documentation:
│   ├── README.md            # Project documentation
│   ├── .roorules            # Project rules and understanding
│   └── GEMINI_LIVE_AUDIO_INTEGRATION.md # Live Audio integration guide
├── Build Scripts:
│   └── scripts/build-with-commit.js     # Build script with commit hash injection
└── CI/CD:
    ├── .github/workflows/deploy-gh-pages.yml     # GitHub Pages deployment
    └── .github/workflows/deploy-cloudflare.yml   # Cloudflare Workers deployment
```

## 🧪 Testing Infrastructure

### Comprehensive Test Coverage
- **70+ Total Tests**: Unit, integration, and WebGL component testing
- **Unit Tests (52 tests)**: Main application and WebGL components with mocking
- **Integration Tests (18 tests)**: Real API interactions and Live Audio testing
- **Automated Execution**: Tests run automatically after each deployment

### Test Categories
- Component rendering and interaction testing
- WebGL shader compilation and particle system testing
- Audio processing and AudioWorklet testing
- API endpoint testing (health checks, WebSocket, error handling)
- Performance and security validation
- Gemini Live Audio integration with real API calls

## 🚀 Performance Features

### WebGL Acceleration
- **GPU Rendering**: Hardware-accelerated particle system with 5000+ particles
- **60fps Target**: Smooth animations with optimized buffer management
- **Conference Integration**: Dynamic particle behaviors based on conference state
- **Interactive Effects**: Mouse/touch influence and Gemini avatar formations

### Audio Optimization
- **AudioWorklet Processing**: Real-time audio processing in separate thread
- **Efficient Buffering**: Optimized audio chunk handling and memory management
- **Low Latency**: Optimized for real-time audio translation requirements
- **Device Management**: Live microphone/speaker switching during conference

## 🔧 API Configuration

### Gemini Live Audio Setup
```typescript
// Example configuration for Gemini Live Audio
const session = await gemini.initializeSession({
  model: "models/gemini-2.5-flash-preview-native-audio-dialog",
  modality: "AUDIO", // AUDIO only for optimal performance
  audioFormat: "PCM", // 16kHz input, 24kHz output
  systemPrompt: "Translate audio to target language"
});
```

### WebGL Particle System
```typescript
// Example WebGL particle configuration
const particleConfig = {
  count: 5000,
  renderMode: "POINTS",
  blending: "SRC_ALPHA",
  shaders: {
    vertex: customVertexShader,
    fragment: customFragmentShader
  }
};
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Guidelines
1. Follow the modular architecture pattern
2. Write comprehensive tests for new features
3. Ensure WebGL components are properly tested
4. Maintain performance optimization standards
5. Update documentation for significant changes

### Areas for Contribution
- Additional language support
- WebGL visual effects and particle behaviors
- Audio processing optimizations
- Mobile experience improvements
- Accessibility enhancements

## 📜 License

This project is licensed under the MIT License.

---

**Version 0.8.0** - Enhanced with WebGL generative art, advanced audio processing, and comprehensive testing infrastructure.