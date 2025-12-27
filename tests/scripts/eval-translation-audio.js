const { GoogleGenAI, Modality } = require('@google/genai');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const ffmpegPath = require('ffmpeg-static');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;

const MODEL = process.env.EVAL_MODEL || 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const RAW_API_VERSION = process.env.EVAL_API_VERSION;
const API_VERSION = RAW_API_VERSION && !['default', 'none', 'auto'].includes(RAW_API_VERSION.toLowerCase())
  ? RAW_API_VERSION
  : 'v1alpha';
const TARGET = (process.env.EVAL_TARGET || 'en').toLowerCase();
const RESPONSE_MODE = (process.env.EVAL_RESPONSE_MODE || 'audio+text').toLowerCase();
const RESPONSE_MODALITIES = RESPONSE_MODE === 'audio'
  ? [Modality.AUDIO]
  : RESPONSE_MODE === 'audio+text' || RESPONSE_MODE === 'text+audio'
    ? [Modality.AUDIO, Modality.TEXT]
    : [Modality.TEXT];
const EXPECT_AUDIO = RESPONSE_MODALITIES.includes(Modality.AUDIO);

const OUTPUT_VOICE = process.env.EVAL_OUTPUT_VOICE || 'Zephyr';
const VOICES = (process.env.EVAL_VOICES || 'Zephyr,Puck,Charon,Kore')
  .split(',')
  .map((voice) => voice.trim())
  .filter(Boolean);
const IDS = (process.env.EVAL_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const LIMIT = process.env.EVAL_LIMIT
  ? Number.parseInt(process.env.EVAL_LIMIT, 10)
  : 3;

const CHUNK_SECONDS = Number.parseFloat(process.env.EVAL_CHUNK_SECONDS || '0.25');
const CHUNK_DELAY_MS = Number.parseInt(process.env.EVAL_CHUNK_DELAY_MS || '80', 10);
const TRAILING_SILENCE_SEC = Number.parseFloat(process.env.EVAL_TRAILING_SILENCE_SEC || '2');
const IDLE_MS = Number.parseInt(process.env.EVAL_IDLE_MS || '4000', 10);
const MAX_WAIT_MS = Number.parseInt(process.env.EVAL_MAX_WAIT_MS || '30000', 10);
const SETUP_TIMEOUT_MS = Number.parseInt(process.env.EVAL_SETUP_TIMEOUT_MS || '5000', 10);
const SESSION_PER_ITEM = !['0', 'false', 'no'].includes((process.env.EVAL_SESSION_PER_ITEM || '1').toLowerCase());

const AUDIO_DIR = process.env.EVAL_AUDIO_DIR
  ? path.resolve(ROOT, process.env.EVAL_AUDIO_DIR)
  : path.join(ROOT, 'tests', 'assets', 'audio', 'tts');
const OUTPUT_DIR = process.env.EVAL_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.EVAL_OUTPUT_DIR)
  : path.join(ROOT, 'tests', 'evals', 'output');

const REAL_API_KEY = process.env.GEMINI_API_KEY;
const LANGUAGE_LABELS = {
  en: 'English',
  vi: 'Vietnamese'
};
const LANGUAGE_CODES = {
  en: 'en-US',
  vi: 'vi-VN'
};

function resolveEvalPath(target) {
  return path.join(ROOT, 'tests', 'evals', `translation-ja-${target}.json`);
}

function normalizeVoiceId(voice) {
  return voice.toLowerCase();
}

function resolveVoiceName(voice) {
  const lower = normalizeVoiceId(voice);
  if (lower === 'zephyr') return 'Zephyr';
  if (lower === 'puck') return 'Puck';
  if (lower === 'charon') return 'Charon';
  if (lower === 'kore') return 'Kore';
  return voice;
}

function buildSystemInstruction(targetLabel) {
  return [
    'You are a professional translator working at a Japanese SIer.',
    'You are a real-time translator.',
    `Translate the user\'s Japanese speech to ${targetLabel}.`,
    'Translate literally and preserve technical terms, acronyms, and proper nouns in English.',
    'Keep numbers and identifiers unchanged.',
    'Do not paraphrase or summarize. Do not omit details.',
    'Produce a complete translation before stopping.',
    'The conversation domain likely includes keywords about Java, TypeScript, AWS, OCI, GitHub, OpenAI, Anthropic, unit tests, and E2E.',
    'Output only the translation with no commentary, labels, or analysis.',
    'If the input is silence or non-speech, output nothing.'
  ].join(' ');
}

function decodeAudioToPcm(inputFilePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('ffmpeg-static path not found.'));
      return;
    }

    const args = [
      '-i', inputFilePath,
      '-f', 's16le',
      '-ac', String(CHANNELS),
      '-ar', String(SAMPLE_RATE),
      '-'
    ];

    const ffmpeg = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
        return;
      }

      resolve(Buffer.concat(stdoutChunks));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSetupComplete({ timeoutMs, isReady }) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (isReady()) {
      return performance.now() - start;
    }
    await sleep(50);
  }
  return null;
}

async function waitForOutputIdle({ maxWaitMs, idleMs, getLastSignalAt, getFirstSendAt }) {
  const start = performance.now();
  while (performance.now() - start < maxWaitMs) {
    const lastOutput = getLastSignalAt();
    const firstSend = getFirstSendAt();
    if (lastOutput && performance.now() - lastOutput >= idleMs) {
      return;
    }
    if (!lastOutput && firstSend && performance.now() - firstSend >= maxWaitMs) {
      return;
    }
    await sleep(200);
  }
}

function applyGain(int16, gain) {
  const output = new Int16Array(int16.length);
  for (let i = 0; i < int16.length; i += 1) {
    let value = int16[i] * gain;
    if (value > 32767) value = 32767;
    if (value < -32768) value = -32768;
    output[i] = value;
  }
  return output;
}

function addSilence(int16, seconds) {
  const silenceSamples = Math.floor(SAMPLE_RATE * seconds);
  const output = new Int16Array(silenceSamples + int16.length);
  output.set(int16, silenceSamples);
  return output;
}

function addTrailingSilence(int16, seconds) {
  const silenceSamples = Math.floor(SAMPLE_RATE * seconds);
  const output = new Int16Array(int16.length + silenceSamples);
  output.set(int16, 0);
  return output;
}

function duplicateAudio(int16) {
  const output = new Int16Array(int16.length * 2);
  output.set(int16, 0);
  output.set(int16, int16.length);
  return output;
}

function preparePcmForTranslation(pcmData) {
  const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, Math.floor(pcmData.length / 2));
  const durationSeconds = int16.length / SAMPLE_RATE;
  const gain = durationSeconds < 1.0 ? 1.4 : 1.15;
  const boosted = applyGain(int16, gain);
  const withLead = addSilence(boosted, 0.5);
  const withTail = addTrailingSilence(withLead, 1.0);
  if (durationSeconds < 0.9) {
    return Buffer.from(duplicateAudio(withTail).buffer);
  }
  return Buffer.from(withTail.buffer);
}

function normalizeText(text) {
  if (!text) return '';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

function computeF1(reference, output) {
  const refTokens = tokenize(reference);
  const outTokens = tokenize(output);
  if (!refTokens.length || !outTokens.length) {
    return { precision: 0, recall: 0, f1: 0 };
  }

  const refCounts = new Map();
  for (const token of refTokens) {
    refCounts.set(token, (refCounts.get(token) || 0) + 1);
  }
  let overlap = 0;
  for (const token of outTokens) {
    const count = refCounts.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      refCounts.set(token, count - 1);
    }
  }

  const precision = overlap / outTokens.length;
  const recall = overlap / refTokens.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function computeKeywordCoverage(output, keywords) {
  if (!keywords || keywords.length === 0) {
    return { hitCount: 0, total: 0 };
  }
  const normalizedOutput = normalizeText(output);
  let hits = 0;
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && normalizedOutput.includes(normalizedKeyword)) {
      hits += 1;
    }
  }
  return { hitCount: hits, total: keywords.length };
}

function appendTranscript(parts, nextText) {
  if (!nextText) {
    return;
  }
  const cleaned = nextText.trim();
  if (!cleaned) {
    return;
  }
  if (parts.length === 0) {
    parts.push(cleaned);
    return;
  }
  const last = parts[parts.length - 1];
  if (cleaned === last) {
    return;
  }
  if (cleaned.startsWith(last)) {
    parts[parts.length - 1] = cleaned;
    return;
  }
  if (last.startsWith(cleaned)) {
    return;
  }
  parts.push(cleaned);
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildConfig(targetLabel, languageCode) {
  return {
    responseModalities: RESPONSE_MODALITIES,
    inputAudioTranscription: {},
    ...(EXPECT_AUDIO ? { outputAudioTranscription: {} } : {}),
    ...(EXPECT_AUDIO ? {
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: OUTPUT_VOICE
          }
        },
        languageCode
      }
    } : {}),
    temperature: 0,
    topP: 0.2,
    maxOutputTokens: 512,
    systemInstruction: {
      parts: [{
        text: buildSystemInstruction(targetLabel)
      }]
    }
  };
}

async function runEval() {
  if (!REAL_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const evalPath = resolveEvalPath(TARGET);
  if (!fs.existsSync(evalPath)) {
    throw new Error(`Eval dataset not found: ${evalPath}`);
  }

  if (!fs.existsSync(AUDIO_DIR)) {
    throw new Error(`Audio directory not found: ${AUDIO_DIR}`);
  }

  const targetLabel = LANGUAGE_LABELS[TARGET] || TARGET;
  const languageCode = LANGUAGE_CODES[TARGET] || 'en-US';
  const evalItems = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
  const filteredItems = evalItems.filter((item) => !IDS.length || IDS.includes(item.id));
  const selectedItems = LIMIT > 0 ? filteredItems.slice(0, LIMIT) : filteredItems;
  if (!selectedItems.length) {
    throw new Error('No eval items selected.');
  }

  console.log(`Running audio eval for Japanese -> ${targetLabel}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Audio dir: ${AUDIO_DIR}`);
  console.log(`Response mode: ${RESPONSE_MODE}`);
  console.log(`API version: ${API_VERSION || 'default'}`);
  console.log(`Voices: ${VOICES.join(', ')}`);
  console.log(`Items: ${selectedItems.length}`);

  const aiConfig = {
    apiKey: REAL_API_KEY,
    ...(API_VERSION ? { httpOptions: { apiVersion: API_VERSION } } : {})
  };
  const ai = new GoogleGenAI(aiConfig);
  const config = buildConfig(targetLabel, languageCode);

  const results = [];
  let missingAudio = 0;

  for (const voice of VOICES) {
    const voiceId = normalizeVoiceId(voice);
    const voiceName = resolveVoiceName(voice);
    console.log(`\n=== Voice: ${voiceName} ===`);
    for (let index = 0; index < selectedItems.length; index += 1) {
      const item = selectedItems[index];
      const fileName = `${item.id}-${voiceId}.wav`;
      const filePath = path.join(AUDIO_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        missingAudio += 1;
        console.warn(`Missing audio file: ${fileName}`);
        continue;
      }

      const result = await runSingleItem({
        ai,
        model: MODEL,
        config,
        item,
        voiceName,
        fileName,
        filePath
      });
      if (!result) {
        continue;
      }
      results.push(result);
      console.log(`[${item.id} ${voiceName}] chunks=${result.chunksSent} output=${result.output ? 'yes' : 'no'} latency=${result.latencyMs === null ? 'n/a' : `${result.latencyMs.toFixed(0)}ms`}`);
      await sleep(500);
    }
  }

  ensureDirectory(OUTPUT_DIR);
  const outputPath = path.join(OUTPUT_DIR, `translation-ja-${TARGET}.json`);
  const summary = buildSummary(results, missingAudio);
  const report = {
    target: TARGET,
    model: MODEL,
    responseMode: RESPONSE_MODE,
    voices: VOICES.map(resolveVoiceName),
    config: {
      chunkSeconds: CHUNK_SECONDS,
      chunkDelayMs: CHUNK_DELAY_MS,
      trailingSilenceSeconds: TRAILING_SILENCE_SEC,
      idleMs: IDLE_MS,
      maxWaitMs: MAX_WAIT_MS
    },
    summary,
    runs: results
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved eval report: ${outputPath}`);
}

async function runSingleItem({ ai, model, config, item, voiceName, fileName, filePath }) {
  let setupComplete = false;
  let sessionClosed = false;
  const activeTurn = {
    id: item.id,
    voice: voiceName,
    inputFile: fileName,
    inputTranscriptionParts: [],
    outputTranscriptionParts: [],
    modelTextParts: [],
    firstSendAt: null,
    firstSignalAt: null,
    lastSignalAt: null
  };

  const session = await ai.live.connect({
    model,
    callbacks: {
      onopen: function () {
        if (SESSION_PER_ITEM) {
          console.log('Session opened.');
        }
      },
      onmessage: function (message) {
        if (message.setupComplete) {
          setupComplete = true;
        }

        if (message.serverContent?.inputTranscription?.text) {
          appendTranscript(activeTurn.inputTranscriptionParts, message.serverContent.inputTranscription.text);
        }

        if (message.serverContent?.outputTranscription?.text) {
          appendTranscript(activeTurn.outputTranscriptionParts, message.serverContent.outputTranscription.text);
          const now = performance.now();
          if (!activeTurn.firstSignalAt) {
            activeTurn.firstSignalAt = now;
          }
          activeTurn.lastSignalAt = now;
        }

        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.text && !part.thought) {
              appendTranscript(activeTurn.modelTextParts, part.text);
              const now = performance.now();
              if (!activeTurn.firstSignalAt) {
                activeTurn.firstSignalAt = now;
              }
              activeTurn.lastSignalAt = now;
            }
          }
        }
      },
      onerror: function (e) {
        console.error('Session error:', e.message);
      },
      onclose: function (e) {
        sessionClosed = true;
        if (SESSION_PER_ITEM) {
          console.log('Session closed:', e.reason);
        }
      }
    },
    config
  });

  const setupWaitMs = await waitForSetupComplete({
    timeoutMs: SETUP_TIMEOUT_MS,
    isReady: () => setupComplete
  });
  if (setupWaitMs === null) {
    console.warn('Setup not complete before timeout, sending audio anyway.');
  }

  const pcmData = await decodeAudioToPcm(filePath);
  const preparedPcm = preparePcmForTranslation(pcmData);
  const chunkSize = Math.max(1, Math.floor(SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_SECONDS));

  let chunksSent = 0;
  for (let offset = 0; offset < preparedPcm.length; offset += chunkSize) {
    if (sessionClosed) {
      console.warn('Session closed unexpectedly, stopping.');
      break;
    }
    const chunk = preparedPcm.slice(offset, Math.min(offset + chunkSize, preparedPcm.length));
    const base64Audio = chunk.toString('base64');
    if (!activeTurn.firstSendAt) {
      activeTurn.firstSendAt = performance.now();
    }
    session.sendRealtimeInput({
      audio: {
        data: base64Audio,
        mimeType: `audio/pcm;rate=${SAMPLE_RATE}`
      }
    });
    chunksSent += 1;
    await sleep(CHUNK_DELAY_MS);
  }

  const silenceSamples = SAMPLE_RATE * TRAILING_SILENCE_SEC;
  const silenceBuffer = Buffer.alloc(silenceSamples * BYTES_PER_SAMPLE, 0);
  session.sendRealtimeInput({
    audio: {
      data: silenceBuffer.toString('base64'),
      mimeType: `audio/pcm;rate=${SAMPLE_RATE}`
    }
  });

  await sleep(800);
  session.sendRealtimeInput({ audioStreamEnd: true });

  await waitForOutputIdle({
    maxWaitMs: MAX_WAIT_MS,
    idleMs: IDLE_MS,
    getLastSignalAt: () => activeTurn.lastSignalAt,
    getFirstSendAt: () => activeTurn.firstSendAt
  });

  session.close();
  if (!sessionClosed) {
    await sleep(200);
  }

  const inputText = activeTurn.inputTranscriptionParts.join(' ').replace(/\s+/g, ' ').trim();
  const outputFromTranscription = activeTurn.outputTranscriptionParts.join(' ').replace(/\s+/g, ' ').trim();
  const modelText = activeTurn.modelTextParts.join(' ').replace(/\s+/g, ' ').trim();
  const outputText = outputFromTranscription || modelText;
  const metrics = computeF1(item.reference, outputText);
  const keywordCoverage = computeKeywordCoverage(outputText, item.keywords);
  const latencyMs = activeTurn.firstSendAt && activeTurn.firstSignalAt
    ? activeTurn.firstSignalAt - activeTurn.firstSendAt
    : null;

  return {
    id: item.id,
    voice: voiceName,
    inputFile: fileName,
    reference: item.reference,
    output: outputText,
    inputTranscription: inputText,
    outputTranscription: outputFromTranscription,
    modelText: modelText,
    chunksSent,
    latencyMs,
    metrics: {
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      keywordHits: keywordCoverage.hitCount,
      keywordTotal: keywordCoverage.total
    }
  };
}

function buildSummary(results, missingAudio) {
  const withOutput = results.filter((run) => run.output);
  const avg = (values) => {
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const avgPrecision = avg(withOutput.map((run) => run.metrics.precision));
  const avgRecall = avg(withOutput.map((run) => run.metrics.recall));
  const avgF1 = avg(withOutput.map((run) => run.metrics.f1));
  const latencyValues = results
    .map((run) => run.latencyMs)
    .filter((value) => typeof value === 'number');
  const avgLatencyMs = avg(latencyValues);
  const keywordHits = results.reduce((sum, run) => sum + run.metrics.keywordHits, 0);
  const keywordTotal = results.reduce((sum, run) => sum + run.metrics.keywordTotal, 0);

  return {
    totalRuns: results.length,
    outputsReceived: withOutput.length,
    missingOutputs: results.length - withOutput.length,
    missingAudio,
    avgPrecision,
    avgRecall,
    avgF1,
    avgLatencyMs,
    keywordHitRate: keywordTotal ? keywordHits / keywordTotal : null
  };
}

runEval().catch((error) => {
  console.error('Eval failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
