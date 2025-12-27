const { GoogleGenAI, Modality } = require('@google/genai');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const ffmpegPath = require('ffmpeg-static');
require('dotenv').config();

const REAL_API_KEY = process.env.GEMINI_API_KEY || 'your-api-key-here';
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
const LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const RESPONSE_MODE = (process.env.LIVE_RESPONSE_MODE || 'audio+text').toLowerCase();
const RESPONSE_MODALITIES = RESPONSE_MODE === 'audio'
  ? [Modality.AUDIO]
  : RESPONSE_MODE === 'audio+text' || RESPONSE_MODE === 'text+audio'
    ? [Modality.AUDIO, Modality.TEXT]
    : [Modality.TEXT];
const EXPECT_AUDIO = RESPONSE_MODALITIES.includes(Modality.AUDIO);
const VERBOSE = process.env.LIVE_VERBOSE === '1';
const TOTAL_TURNS = Number.parseInt(process.env.LIVE_TOTAL_TURNS || '5', 10);

function findAudioFile() {
  const root = path.resolve(__dirname, '..', '..');
  const audioDir = path.join(root, 'tests', 'assets', 'audio');
  const argPath = process.argv[2];
  if (argPath) {
    return path.resolve(root, argPath);
  }

  const files = fs.existsSync(audioDir)
    ? fs.readdirSync(audioDir).filter((file) => /\.(mp3|wav)$/i.test(file))
    : [];
  if (files.length === 0) {
    throw new Error('No .mp3 or .wav files found in tests/assets/audio.');
  }

  return path.resolve(audioDir, files[0]);
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

function buildTestPatterns() {
  const chunkDurations = [0.25, 0.5];
  const chunkDelays = [80, 50];
  const silenceOptions = [1, 2];
  const idleOptions = [2000, 3000];
  const patterns = [];

  for (const chunkDurationSeconds of chunkDurations) {
    for (const chunkSendDelayMs of chunkDelays) {
      for (const silenceSeconds of silenceOptions) {
        for (const idleMs of idleOptions) {
          patterns.push({
            chunkDurationSeconds,
            chunkSendDelayMs,
            silenceSeconds,
            idleMs,
            label: `chunk=${chunkDurationSeconds}s delay=${chunkSendDelayMs}ms silence=${silenceSeconds}s idle=${idleMs}ms`
          });
        }
      }
    }
  }

  return patterns;
}

function average(values) {
  if (!values.length) {
    return null;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

function countKeywordMisses(turnSummaries) {
  let misses = 0;
  for (const summary of turnSummaries) {
    if (!summary.output) {
      continue;
    }
    const output = summary.output.toLowerCase();
    if (!output.includes('github actions') || !output.includes('oci')) {
      misses += 1;
    }
  }
  return misses;
}

async function runMp3LiveAudioTest() {
  console.log('Testing Gemini Live API with MP3 input...');
  console.log(`Response mode: ${RESPONSE_MODE}`);
  if (!EXPECT_AUDIO) {
    console.warn('Response mode does not include audio; this model may reject the request.');
  }
  const inputFile = findAudioFile();
  console.log(`Using audio file: ${inputFile}`);

  if (!REAL_API_KEY || REAL_API_KEY === 'your-api-key-here') {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const pcmData = await decodeAudioToPcm(inputFile);
  if (!pcmData.length) {
    throw new Error('Decoded PCM data is empty.');
  }

  const normalizedPcm = preparePcmForTranslation(pcmData);
  console.log(`Decoded PCM size: ${(pcmData.length / 1024).toFixed(2)}KB`);
  console.log(`Prepared PCM size: ${(normalizedPcm.length / 1024).toFixed(2)}KB`);
  const pcmStats = getPcmStats(normalizedPcm);
  console.log(`PCM stats - RMS: ${pcmStats.rms.toFixed(6)}, Peak: ${pcmStats.peak.toFixed(6)}`);

  const ai = new GoogleGenAI({
    apiKey: REAL_API_KEY,
    httpOptions: { apiVersion: 'v1alpha' }
  });
  const model = LIVE_MODEL;
  const systemInstruction = [
    'You are a professional translator working at a Japanese SIer.',
    'You are a real-time translator.',
    'Translate the user\'s Japanese speech to English.',
    'The conversation domain likely includes keywords about Java, TypeScript, AWS, OCI, GitHub, OpenAI, Anthropic, unit tests, and E2E.',
    'Respond using spoken English audio only.',
    'Do not emit thoughts, analysis, commentary, or labels.',
    'Translate the full content without omissions.',
    'If the input is silence or non-speech, output nothing.'
  ].join(' ');
  const config = {
    responseModalities: RESPONSE_MODALITIES,
    inputAudioTranscription: {},
    ...(EXPECT_AUDIO ? { outputAudioTranscription: {} } : {}),
    ...(EXPECT_AUDIO ? {
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr'
          }
        },
        languageCode: 'en-US'
      }
    } : {}),
    temperature: 0.2,
    topP: 0.8,
    maxOutputTokens: 256,
    systemInstruction: {
      parts: [{
        text: systemInstruction
      }]
    }
  };

  const patterns = buildTestPatterns();
  console.log(`Running ${patterns.length} patterns (${TOTAL_TURNS} turns each).`);
  const patternSummaries = [];

  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index];
    const summary = await runPattern({
      ai,
      model,
      config,
      normalizedPcm,
      pattern,
      totalTurns: TOTAL_TURNS,
      patternIndex: index,
      totalPatterns: patterns.length
    });
    patternSummaries.push(summary);
  }

  console.log('\n=== Pattern Summary ===');
  for (const summary of patternSummaries) {
    const avgFirstLabel = summary.avgFirstMs === null ? 'n/a' : `${summary.avgFirstMs.toFixed(0)}ms`;
    const avgLastLabel = summary.avgLastMs === null ? 'n/a' : `${summary.avgLastMs.toFixed(0)}ms`;
    console.log(`[${summary.label}] avg first ${avgFirstLabel}, avg last ${avgLastLabel}, missing ${summary.missingOutputs}/${summary.totalTurns}, keyword misses ${summary.keywordMisses}/${summary.totalTurns}`);
  }
}

async function runPattern({ ai, model, config, normalizedPcm, pattern, totalTurns, patternIndex, totalPatterns }) {
  const testStartAt = performance.now();
  console.log(`\n=== Pattern ${patternIndex + 1}/${totalPatterns}: ${pattern.label} ===`);
  let sessionClosed = false;
  let firstSendAt = null;
  let firstOutputAt = null;
  let lastOutputAt = null;
  let firstTextAt = null;
  let lastTextAt = null;
  let setupComplete = false;
  let setupCompleteAt = null;
  let setupReadyAt = null;
  const inputTranscriptions = [];
  const outputTranscriptions = [];
  const textResponses = [];
  const turnSummaries = [];
  let activeTurn = null;
  const session = await ai.live.connect({
    model,
    callbacks: {
      onopen: function () {
        console.log('Connection opened successfully');
      },
      onmessage: function (message) {
        if (message.setupComplete) {
          console.log('[Setup Complete]');
          setupComplete = true;
          setupCompleteAt = performance.now();
        }
        if (message.serverContent?.inputTranscription?.text) {
          const inputText = message.serverContent.inputTranscription.text;
          console.log('[Input Transcription]', inputText);
          if (inputText && inputText.trim()) {
            inputTranscriptions.push(inputText.trim());
          }
        }
        if (message.serverContent?.outputTranscription?.text) {
          const signalAt = performance.now();
          if (!firstOutputAt) {
            firstOutputAt = signalAt;
          }
          lastOutputAt = signalAt;
          const outputText = message.serverContent.outputTranscription.text;
          console.log('[Output Transcription]', outputText);
          if (outputText && outputText.trim()) {
            outputTranscriptions.push(outputText.trim());
          }
          if (activeTurn) {
            if (!activeTurn.firstSignalAt) {
              activeTurn.firstSignalAt = signalAt;
            }
            activeTurn.lastSignalAt = signalAt;
          }
        }
        if (message.serverContent?.modelTurn?.parts) {
          for (const part of message.serverContent.modelTurn.parts) {
            if (part.text) {
              const label = part.thought ? '[Model Thought]' : '[Model Text]';
              console.log(label, part.text);
              if (!part.thought) {
                const signalAt = performance.now();
                if (!firstTextAt) {
                  firstTextAt = signalAt;
                }
                lastTextAt = signalAt;
                textResponses.push(part.text);
                if (activeTurn) {
                  if (!activeTurn.firstSignalAt) {
                    activeTurn.firstSignalAt = signalAt;
                  }
                  activeTurn.lastSignalAt = signalAt;
                }
              }
            }
            if (part.inlineData?.data) {
              console.log(`[Model Audio] ${part.inlineData.data.length} base64 chars`);
            }
          }
        }
        if (message.serverContent?.turnComplete) {
          console.log('[Turn Complete]');
        }
      },
      onerror: function (e) {
        console.error('Error:', e.message);
      },
      onclose: function (e) {
        sessionClosed = true;
        console.log('Connection closed:', e.reason);
      }
    },
    config
  });

  const setupWaitMs = await waitForSetupComplete({
    timeoutMs: 5000,
    isReady: () => setupComplete
  });
  if (setupWaitMs === null) {
    console.warn('Setup not complete after 5000ms, sending audio anyway.');
  } else {
    console.log(`Setup ready after ${setupWaitMs.toFixed(0)}ms`);
  }
  setupReadyAt = setupCompleteAt || performance.now();

  const chunkSize = Math.floor(SAMPLE_RATE * BYTES_PER_SAMPLE * pattern.chunkDurationSeconds);

  for (let turnIndex = 1; turnIndex <= totalTurns; turnIndex++) {
    const turnStartAt = performance.now();
    const sinceSetupMs = setupReadyAt ? turnStartAt - setupReadyAt : null;
    const sinceTestMs = turnStartAt - testStartAt;
    const setupLabel = sinceSetupMs === null ? 'n/a' : `${(sinceSetupMs / 1000).toFixed(2)}s`;
    console.log(`=== Turn ${turnIndex}/${totalTurns} (start +${setupLabel} since setup, +${(sinceTestMs / 1000).toFixed(2)}s since start) ===`);
    const turnInputStart = inputTranscriptions.length;
    const turnOutputStart = outputTranscriptions.length;
    const turnTextStart = textResponses.length;
    activeTurn = {
      index: turnIndex,
      startedAt: turnStartAt,
      firstSendAt: null,
      firstSignalAt: null,
      lastSignalAt: null
    };

    let chunksSent = 0;
    for (let offset = 0; offset < normalizedPcm.length; offset += chunkSize) {
      const chunk = normalizedPcm.slice(offset, Math.min(offset + chunkSize, normalizedPcm.length));
      const base64Audio = chunk.toString('base64');

      if (sessionClosed) {
        console.warn('Session already closed, stopping audio send.');
        break;
      }

      if (!activeTurn.firstSendAt) {
        activeTurn.firstSendAt = performance.now();
        if (!firstSendAt) {
          firstSendAt = activeTurn.firstSendAt;
        }
      }
      session.sendRealtimeInput({
        audio: {
          data: base64Audio,
          mimeType: `audio/pcm;rate=${SAMPLE_RATE}`
        }
      });

      chunksSent += 1;
      if (VERBOSE) {
        console.log(`Sent audio chunk: ${(chunk.length / 1024).toFixed(2)}KB`);
      }
      await sleep(pattern.chunkSendDelayMs);
    }

    if (!VERBOSE) {
      console.log(`Sent ${chunksSent} audio chunks (${pattern.chunkDurationSeconds}s)`);
    }

    const silenceSamples = SAMPLE_RATE * pattern.silenceSeconds;
    const silenceBuffer = Buffer.alloc(silenceSamples * BYTES_PER_SAMPLE, 0);
    const silenceBase64 = silenceBuffer.toString('base64');
    session.sendRealtimeInput({
      audio: {
        data: silenceBase64,
        mimeType: `audio/pcm;rate=${SAMPLE_RATE}`
      }
    });
    console.log(`Sent trailing silence (${pattern.silenceSeconds}s) to flush turn`);

    if (turnIndex === totalTurns) {
      await sleep(800);
      session.sendRealtimeInput({ audioStreamEnd: true });
      console.log('Sent audioStreamEnd');
    } else {
      await sleep(500);
    }

    await waitForOutputIdle({
      maxWaitMs: 20000,
      idleMs: pattern.idleMs,
      getLastSignalAt: () => activeTurn?.lastSignalAt ?? null,
      getFirstSendAt: () => activeTurn?.firstSendAt ?? null
    });

    const turnInput = inputTranscriptions.slice(turnInputStart).join(' ').replace(/\s+/g, ' ').trim();
    const turnOutput = outputTranscriptions.slice(turnOutputStart).join(' ').replace(/\s+/g, ' ').trim();
    const turnText = textResponses.slice(turnTextStart).join(' ').replace(/\s+/g, ' ').trim();
    turnSummaries.push({
      index: turnIndex,
      input: turnInput,
      output: turnOutput,
      text: turnText,
      startedAt: activeTurn.startedAt,
      firstSendAt: activeTurn.firstSendAt,
      firstSignalAt: activeTurn.firstSignalAt,
      lastSignalAt: activeTurn.lastSignalAt
    });

    activeTurn = null;

    if (turnIndex < totalTurns) {
      await sleep(1000);
    }
  }

  session.close();
  console.log('Pattern completed.');

  for (const summary of turnSummaries) {
    if (summary.input) {
      console.log(`[Turn ${summary.index} Input] ${summary.input}`);
    }
    if (summary.output) {
      console.log(`[Turn ${summary.index} Output] ${summary.output}`);
    } else if (summary.input) {
      console.log(`[Turn ${summary.index}] Output transcription missing; running text translation.`);
      const fallbackTranslation = await translateTextFallback(ai, summary.input);
      if (fallbackTranslation) {
        console.log(`[Turn ${summary.index} Fallback Translation] ${fallbackTranslation}`);
      }
    }
    if (summary.text) {
      console.log(`[Turn ${summary.index} Model Text] ${summary.text}`);
    }
    reportTurnLatency(summary, setupReadyAt, testStartAt);
  }

  reportLatency({
    firstSendAt,
    firstSignalAt: firstOutputAt || firstTextAt,
    lastSignalAt: lastOutputAt || lastTextAt
  });

  const firstLatencies = turnSummaries
    .filter((summary) => summary.firstSendAt && summary.firstSignalAt)
    .map((summary) => summary.firstSignalAt - summary.firstSendAt);
  const lastLatencies = turnSummaries
    .filter((summary) => summary.firstSendAt && summary.lastSignalAt)
    .map((summary) => summary.lastSignalAt - summary.firstSendAt);
  const missingOutputs = turnSummaries.filter((summary) => !summary.output).length;
  const keywordMisses = countKeywordMisses(turnSummaries);
  const avgFirstMs = average(firstLatencies);
  const avgLastMs = average(lastLatencies);

  console.log(`[Pattern ${patternIndex + 1}] avg first ${avgFirstMs === null ? 'n/a' : `${avgFirstMs.toFixed(0)}ms`}, avg last ${avgLastMs === null ? 'n/a' : `${avgLastMs.toFixed(0)}ms`}, missing ${missingOutputs}/${totalTurns}, keyword misses ${keywordMisses}/${totalTurns}`);

  return {
    label: pattern.label,
    avgFirstMs,
    avgLastMs,
    missingOutputs,
    keywordMisses,
    totalTurns
  };
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

async function translateTextFallback(ai, text) {
  try {
    const systemInstruction = [
      'You are a professional translator working at a Japanese SIer.',
      'You are a real-time translator.',
      'Translate the user\'s Japanese text to English.',
      'The conversation domain likely includes keywords about Java, TypeScript, AWS, OCI, GitHub, OpenAI, Anthropic, unit tests, and E2E.',
      'Respond using spoken English audio only.',
      'Do not emit thoughts, analysis, commentary, or labels.',
      'Translate the full content without omissions.',
      'If the input is silence or non-speech, output nothing.'
    ].join(' ');
    const config = {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr'
          }
        },
        languageCode: 'en-US'
      },
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 256,
      systemInstruction: {
        parts: [{
          text: systemInstruction
        }]
      }
    };

    let setupComplete = false;
    let sessionClosed = false;
    let firstSendAt = null;
    let lastOutputAt = null;
    const outputTranscriptions = [];

    const session = await ai.live.connect({
      model: LIVE_MODEL,
      callbacks: {
        onmessage: function (message) {
          if (message.setupComplete) {
            setupComplete = true;
          }
          if (message.serverContent?.outputTranscription?.text) {
            const outputText = message.serverContent.outputTranscription.text;
            if (outputText && outputText.trim()) {
              outputTranscriptions.push(outputText.trim());
              lastOutputAt = performance.now();
            }
          }
        },
        onerror: function (e) {
          console.error('[Fallback] Live session error:', e.message);
        },
        onclose: function () {
          sessionClosed = true;
        }
      },
      config
    });

    const setupWaitMs = await waitForSetupComplete({
      timeoutMs: 5000,
      isReady: () => setupComplete
    });
    if (setupWaitMs === null) {
      console.warn('[Fallback] Setup not complete after 5000ms, sending anyway.');
    }

    const prompt = `Translate the following text from Japanese to English. Output only the translated text, nothing else.\n\nText: ${text}`;
    if (!firstSendAt) {
      firstSendAt = performance.now();
    }
    session.sendClientContent({
      turns: [prompt]
    });

    await waitForOutputIdle({
      maxWaitMs: 10000,
      idleMs: 1500,
      getLastSignalAt: () => lastOutputAt,
      getFirstSendAt: () => firstSendAt
    });

    session.close();
    if (sessionClosed === false) {
      await sleep(100);
    }

    return outputTranscriptions.join(' ').replace(/\s+/g, ' ').trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Fallback] Text translation failed:', message);
    return '';
  }
}

function getPcmStats(pcmData) {
  const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, Math.floor(pcmData.length / 2));
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < int16.length; i += 4) {
    const value = int16[i] / 32768;
    const absValue = Math.abs(value);
    if (absValue > peak) {
      peak = absValue;
    }
    sumSquares += value * value;
  }

  const rms = int16.length > 0 ? Math.sqrt(sumSquares / Math.ceil(int16.length / 4)) : 0;
  return { rms, peak };
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

function applyGain(int16, gain) {
  const output = new Int16Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
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

function reportLatency({ firstSendAt, firstSignalAt, lastSignalAt }) {
  if (!firstSendAt || !firstSignalAt) {
    console.log('Latency: no output received.');
    return;
  }

  const firstLatencyMs = firstSignalAt - firstSendAt;
  const lastLatencyMs = lastSignalAt ? lastSignalAt - firstSendAt : null;
  console.log(`Latency to first transcription: ${firstLatencyMs.toFixed(0)}ms`);
  if (lastLatencyMs !== null) {
    console.log(`Latency to last transcription: ${lastLatencyMs.toFixed(0)}ms`);
  }
}

function reportTurnLatency(summary, setupReadyAt, testStartAt) {
  if (summary.startedAt) {
    const sinceSetupMs = setupReadyAt ? summary.startedAt - setupReadyAt : null;
    const sinceTestMs = testStartAt ? summary.startedAt - testStartAt : null;
    const setupLabel = sinceSetupMs === null ? 'n/a' : `${(sinceSetupMs / 1000).toFixed(2)}s`;
    const testLabel = sinceTestMs === null ? 'n/a' : `${(sinceTestMs / 1000).toFixed(2)}s`;
    console.log(`[Turn ${summary.index}] Start offset: +${setupLabel} since setup, +${testLabel} since start`);
  }

  if (!summary.firstSendAt || !summary.firstSignalAt) {
    console.log(`[Turn ${summary.index}] Latency: no output received.`);
    return;
  }

  const firstLatencyMs = summary.firstSignalAt - summary.firstSendAt;
  const lastLatencyMs = summary.lastSignalAt ? summary.lastSignalAt - summary.firstSendAt : null;
  console.log(`[Turn ${summary.index}] Latency to first transcription: ${firstLatencyMs.toFixed(0)}ms`);
  if (lastLatencyMs !== null) {
    console.log(`[Turn ${summary.index}] Latency to last transcription: ${lastLatencyMs.toFixed(0)}ms`);
  }
}

runMp3LiveAudioTest().catch((error) => {
  console.error('Test failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
