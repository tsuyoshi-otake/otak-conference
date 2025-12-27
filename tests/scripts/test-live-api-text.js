const { GoogleGenAI, Modality } = require('@google/genai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';
const MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const INPUT_TEXT = process.env.LIVE_TEXT_INPUT || process.argv.slice(2).join(' ') || 'This is a test.';
const OUTPUT_PATH = process.env.LIVE_AUDIO_OUTPUT
  || path.join(__dirname, '..', 'assets', 'output', 'live-audio.wav');
const SEND_DELAY_MS = Number.parseInt(process.env.LIVE_SEND_DELAY_MS || '0', 10);
const SYSTEM_PROMPT = process.env.LIVE_SYSTEM_PROMPT || [
  'You are a real-time translator.',
  'If the input is Japanese, translate it to English.',
  'Respond using spoken English audio only.',
  'Output only the translation with no commentary or labels.'
].join(' ');

const responseQueue = [];
let session = null;
let audioParts = [];
let audioMimeType = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleTurn() {
  const turn = [];
  let done = false;
  while (!done) {
    const message = await waitMessage();
    turn.push(message);
    if (message.serverContent && message.serverContent.turnComplete) {
      done = true;
    }
  }
  return turn;
}

async function waitMessage() {
  let done = false;
  let message = null;
  while (!done) {
    message = responseQueue.shift();
    if (message) {
      handleModelTurn(message);
      done = true;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return message;
}

function handleModelTurn(message) {
  const parts = message.serverContent?.modelTurn?.parts || [];

  for (const part of parts) {
    if (part?.fileData?.fileUri) {
      console.log(`[Model File] ${part.fileData.fileUri}`);
    }

    if (part?.inlineData?.data) {
      audioParts.push(part.inlineData.data);
      if (!audioMimeType && part.inlineData.mimeType) {
        audioMimeType = part.inlineData.mimeType;
      }
    }

    if (part?.text) {
      console.log('[Model Text]', part.text);
    }
  }

  if (message.serverContent?.outputTranscription?.text) {
    console.log('[Output Transcription]', message.serverContent.outputTranscription.text);
  }

  if (message.serverContent?.turnComplete) {
    if (audioParts.length > 0) {
      const buffer = convertToWav(audioParts, audioMimeType);
      saveBinaryFile(OUTPUT_PATH, buffer);
      audioParts = [];
      audioMimeType = '';
    } else {
      console.warn('Turn completed with no audio output.');
    }
  }
}

function saveBinaryFile(fileName, content) {
  fs.mkdirSync(path.dirname(fileName), { recursive: true });
  fs.writeFileSync(fileName, content);
  console.log(`Saved audio to ${fileName}`);
}

function convertToWav(rawData, mimeType) {
  const options = parseMimeType(mimeType);
  const buffer = Buffer.concat(rawData.map(data => Buffer.from(data, 'base64')));
  const wavHeader = createWavHeader(buffer.length, options);

  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType) {
  const fallbackRate = 24000;
  if (!mimeType) {
    return { numChannels: 1, bitsPerSample: 16, sampleRate: fallbackRate };
  }

  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options = {
    numChannels: 1,
    bitsPerSample: 16,
    sampleRate: fallbackRate
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      const rate = parseInt(value, 10);
      if (!isNaN(rate)) {
        options.sampleRate = rate;
      }
    }
  }

  return options;
}

function createWavHeader(dataLength, options) {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  // http://soundfile.sapp.org/doc/WaveFormat
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);                      // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
  buffer.write('WAVE', 8);                      // Format
  buffer.write('fmt ', 12);                     // Subchunk1ID
  buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);        // NumChannels
  buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
  buffer.writeUInt32LE(byteRate, 28);           // ByteRate
  buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
  buffer.write('data', 36);                     // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

  return buffer;
}

async function main() {
  if (!API_KEY || API_KEY === 'your-api-key-here') {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const ai = new GoogleGenAI({
    apiKey: API_KEY,
    httpOptions: { apiVersion: 'v1alpha' }
  });

  const config = {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        }
      },
      languageCode: 'en-US'
    },
    systemInstruction: {
      parts: [{
        text: SYSTEM_PROMPT
      }]
    }
  };

  session = await ai.live.connect({
    model: MODEL,
    callbacks: {
      onopen: function () {
        console.log('Opened');
      },
      onmessage: function (message) {
        responseQueue.push(message);
      },
      onerror: function (e) {
        console.error('Error:', e.message);
      },
      onclose: function (e) {
        console.log('Close:', e.reason);
      },
    },
    config
  });

  if (SEND_DELAY_MS > 0) {
    console.log(`Waiting ${SEND_DELAY_MS}ms before sending input...`);
    await sleep(SEND_DELAY_MS);
  }

  session.sendClientContent({
    turns: [INPUT_TEXT]
  });

  await handleTurn();
  session.close();
}

main().catch((error) => {
  console.error('Test failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
