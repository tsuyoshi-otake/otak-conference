const { GoogleGenAI, Modality } = require('@google/genai');
const mime = require('mime').default;
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config();

const MODEL = 'gemini-2.5-pro-preview-tts';
const VOICES = ['Zephyr'];
const OUTPUT_DIR = path.resolve(__dirname, '..', 'assets', 'audio', 'tts');
const PROMPTS_PATH = path.join(OUTPUT_DIR, 'prompts.json');
const SKIP_EXISTING = process.env.TTS_SKIP_EXISTING !== '0';
const RETRY_COUNT = Number.parseInt(process.env.TTS_RETRY_COUNT || '3', 10);
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.TTS_CONCURRENCY || '8', 10));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMimeType(mimeType) {
  const [fileType, ...params] = mimeType.split(';').map((s) => s.trim());
  const format = fileType.split('/')[1];

  const options = {
    numChannels: 1,
    sampleRate: 16000,
    bitsPerSample: 16
  };

  if (format && format.startsWith('L')) {
    const bits = Number.parseInt(format.slice(1), 10);
    if (!Number.isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map((s) => s.trim());
    if (key === 'rate') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        options.sampleRate = parsed;
      }
    }
    if (key === 'channels') {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        options.numChannels = parsed;
      }
    }
  }

  return options;
}

function createWavHeader(dataLength, options) {
  const { numChannels, sampleRate, bitsPerSample } = options;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  return buffer;
}

function convertPcmToWav(rawBuffer, mimeType) {
  const options = parseMimeType(mimeType || 'audio/pcm;rate=16000');
  const header = createWavHeader(rawBuffer.length, options);
  return {
    buffer: Buffer.concat([header, rawBuffer]),
    options
  };
}

function getExtension(mimeType) {
  if (!mimeType) {
    return '';
  }
  const baseType = mimeType.split(';')[0];
  return mime.getExtension(baseType) || '';
}

function estimateDurationSeconds(rawBuffer, options) {
  const bytesPerSample = (options.bitsPerSample || 16) / 8;
  const divisor = options.sampleRate * options.numChannels * bytesPerSample;
  if (!divisor) {
    return null;
  }
  return rawBuffer.length / divisor;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function synthesize(ai, prompt, voice) {
  const config = {
    temperature: 0.8,
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voice
        }
      },
      languageCode: 'ja-JP'
    }
  };

  const contents = [{
    role: 'user',
    parts: [{ text: prompt.text }]
  }];

  const response = await ai.models.generateContentStream({
    model: MODEL,
    config,
    contents
  });

  const chunks = [];
  let mimeType = '';

  for await (const chunk of response) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) {
      continue;
    }
    for (const part of parts) {
      if (part.inlineData?.data) {
        chunks.push(part.inlineData.data);
        if (!mimeType && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
      } else if (part.text) {
        console.log(`[${prompt.id}/${voice}] ${part.text}`);
      }
    }
  }

  if (chunks.length === 0) {
    throw new Error('No audio data returned from TTS.');
  }

  const rawBuffer = Buffer.concat(chunks.map((data) => Buffer.from(data, 'base64')));
  let extension = getExtension(mimeType);
  let outputBuffer = rawBuffer;
  let durationSeconds = null;

  if (!extension || mimeType.includes('audio/pcm') || mimeType.includes('audio/L16')) {
    const wav = convertPcmToWav(rawBuffer, mimeType);
    outputBuffer = wav.buffer;
    extension = 'wav';
    durationSeconds = estimateDurationSeconds(rawBuffer, wav.options);
  }

  return {
    buffer: outputBuffer,
    extension,
    mimeType,
    durationSeconds
  };
}

async function synthesizeWithRetry(ai, prompt, voice) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Retry ${attempt}/${RETRY_COUNT} for ${prompt.id} (${voice})`);
      }
      return await synthesize(ai, prompt, voice);
    } catch (error) {
      lastError = error;
      console.warn(`Attempt ${attempt} failed for ${prompt.id} (${voice}): ${error.message}`);
      if (attempt < RETRY_COUNT) {
        await sleep(500);
      }
    }
  }

  throw lastError;
}

function parseWavDuration(buffer) {
  if (buffer.length < 44) {
    return null;
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataSize = view.getUint32(40, true);
  const bytesPerSample = bitsPerSample / 8;
  if (!sampleRate || !numChannels || !bytesPerSample) {
    return null;
  }
  return dataSize / (sampleRate * numChannels * bytesPerSample);
}

async function writeManifestFromFiles() {
  const files = await fs.readdir(OUTPUT_DIR);
  const entries = [];

  for (const file of files) {
    if (!file.endsWith('.wav')) {
      continue;
    }
    const match = file.match(/^(sier-\d{2,3})-([a-z]+)\.wav$/i);
    if (!match) {
      continue;
    }
    const id = match[1];
    const voice = match[2].charAt(0).toUpperCase() + match[2].slice(1);
    const filePath = path.join(OUTPUT_DIR, file);
    const buffer = await fs.readFile(filePath);
    const durationSeconds = parseWavDuration(buffer);

    entries.push({
      id,
      voice,
      file,
      mimeType: 'audio/wav',
      bytes: buffer.length,
      durationSeconds: durationSeconds ? Number(durationSeconds.toFixed(2)) : null
    });
  }

  entries.sort((a, b) => {
    const idCompare = a.id.localeCompare(b.id);
    if (idCompare !== 0) {
      return idCompare;
    }
    return a.voice.localeCompare(b.voice);
  });

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(entries, null, 2));
  console.log(`Wrote manifest to ${manifestPath}`);
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const promptRaw = await fs.readFile(PROMPTS_PATH, 'utf8');
  const prompts = JSON.parse(promptRaw);
  const existingFiles = new Set(await fs.readdir(OUTPUT_DIR));

  const ai = new GoogleGenAI({
    apiKey
  });

  const tasks = [];
  for (const prompt of prompts) {
    for (const voice of VOICES) {
      const baseName = `${prompt.id}-${voice.toLowerCase()}`;
      const hasExisting = [...existingFiles].some((name) => name.startsWith(`${baseName}.`));
      if (SKIP_EXISTING && hasExisting) {
        console.log(`Skipping existing audio for ${prompt.id} (${voice})`);
        continue;
      }
      tasks.push({ prompt, voice, baseName });
    }
  }

  if (tasks.length === 0) {
    console.log('No new prompts to synthesize.');
    await writeManifestFromFiles();
    return;
  }

  console.log(`Starting TTS generation with concurrency=${CONCURRENCY} (${tasks.length} items).`);
  let taskIndex = 0;

  async function worker(workerId) {
    while (true) {
      const currentIndex = taskIndex++;
      if (currentIndex >= tasks.length) {
        return;
      }
      const { prompt, voice, baseName } = tasks[currentIndex];
      console.log(`[worker ${workerId}] Generating ${prompt.id} with ${voice}...`);
      try {
        const result = await synthesizeWithRetry(ai, prompt, voice);
        const fileName = `${baseName}.${result.extension}`;
        const filePath = path.join(OUTPUT_DIR, fileName);
        await fs.writeFile(filePath, result.buffer);
        existingFiles.add(fileName);

        const durationLabel = result.durationSeconds ? ` (${result.durationSeconds.toFixed(2)}s)` : '';
        console.log(`[worker ${workerId}] Saved ${fileName}${durationLabel}`);
      } catch (error) {
        console.error(`[worker ${workerId}] Failed to generate ${prompt.id} (${voice}): ${error.message}`);
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));

  await writeManifestFromFiles();
}

main().catch((error) => {
  console.error('TTS generation failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
