# otak-conference

A real-time translation conference application that enables multilingual communication using WebRTC and Gemini API.

## Features

- **Real-time Translation**: Supports 25 languages for seamless multilingual communication
- **WebRTC Integration**: High-quality audio/video conferencing
- **Screen Sharing**: Share your screen during conferences
- **Camera Effects**: Background blur, beauty mode, and brightness adjustment
- **Simple Room Sharing**: Share conference rooms via URL

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

## Technology Stack

- **Frontend**: React (TypeScript) with Tailwind CSS
- **Backend**: Cloudflare Workers with Durable Objects
- **Real-time Communication**: WebRTC for audio/video, WebSocket for signaling
- **Translation**: Google Gemini API
- **Deployment**: GitHub Pages (frontend), Cloudflare Workers (backend)

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

Run the development server:
```bash
npm run dev
```

Build the application:
```bash
npm run build
```

Run tests:
```bash
npm test
```

### Deployment

#### Frontend (GitHub Pages)

The frontend is automatically deployed to GitHub Pages when you push to the main branch.

#### Backend (Cloudflare Workers)

Deploy the backend:
```bash
npm run deploy
```

## Usage

1. **Start a Conference**: Click "Start Conference" to create a new room
2. **Share Room**: Click the share button to copy the room URL
3. **Join a Conference**: Open a shared room URL to join
4. **Configure Settings**: Set your username, API key, and preferred language
5. **Use Media Controls**: Toggle microphone, camera, and screen sharing as needed

## Project Structure

```
otak-conference/
├── public/
│   ├── index.html          # Main HTML file
│   ├── bundle.js           # Compiled React application
│   └── favicon.svg         # Application icon
├── translation-conference-app.tsx    # Main React component
├── translation-conference-app.test.tsx # Test suite
├── worker-with-durable-objects.js   # Cloudflare Worker backend
├── jest.config.js          # Jest configuration
├── jest.setup.js           # Jest setup file
├── tsconfig.json           # TypeScript configuration
├── package.json            # Dependencies and scripts
├── wrangler.toml           # Cloudflare configuration
└── .github/workflows/      # GitHub Actions workflows
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.