# Test Structure

This directory contains all tests for the otak-conference project, organized by type.

## Directory Structure

```
tests/
├── unit/                    # Unit tests with mocks
│   ├── translation-conference-app.test.tsx
│   └── generative-art-background.test.tsx
├── integration/             # Integration tests with real APIs
│   ├── api-integration.test.js         # Cloudflare Worker API tests
│   └── gemini-live-audio.integration.test.ts  # Gemini Live Audio API tests
└── scripts/                 # Test utility scripts
    ├── test-audio-streaming.js
    ├── test-gemini-live-api.js
    ├── test-gemini-live-audio-direct.js
    ├── test-gemini-tts-simple.js
    ├── test-live-api-integration.js
    └── output/ (generated .pcm/.wav files)
```

Generated audio files from scripts are written to `tests/scripts/output/` and ignored by git.

## Running Tests

### Unit Tests (with mocks)
```bash
npm test                    # Run all unit tests
npm run test:watch         # Run unit tests in watch mode
npm run test:coverage      # Run unit tests with coverage
```

### Integration Tests (real APIs)
```bash
npm run test:api           # Run Cloudflare Worker API tests
npm run test:integration   # Run all integration tests (API + Gemini)
npm run test:integration:watch  # Run integration tests in watch mode
```

### All Tests
```bash
npm run test:all           # Run all tests (unit + integration)
```

## Test Configuration

- **Unit Tests**: `config/jest/jest.config.js`
  - Uses mocks for external dependencies
  - Fast execution
  - No network calls

- **API Integration Tests**: `config/jest/jest.api.config.js`
  - Tests deployed Cloudflare Worker endpoints
  - Requires internet connection
  - 30-second timeout

- **Gemini Integration Tests**: `config/jest/jest.integration.config.js`
  - Tests real Gemini Live Audio API
  - Requires valid API key in `.env`
  - 60-second timeout
  - Browser APIs mocked for Node.js environment

## Environment Setup

1. Create `.env` file with your Gemini API key:
   ```
   GEMINI_API_KEY=your-api-key-here
   ```

2. Ensure Cloudflare Worker is deployed for API tests

## Test Scripts

The `scripts/` directory contains standalone test scripts for manual testing:

- `test-gemini-live-api.js` - Basic Gemini Live API connection test
- `test-gemini-tts-simple.js` - Gemini TTS API test
- `test-live-api-integration.js` - Comprehensive Live API test
- `test-audio-streaming.js` - Audio streaming functionality test
- `test-gemini-live-audio-direct.js` - Direct Gemini Live Audio test

Run any script with:
```bash
node tests/scripts/[script-name].js
```
