const { GoogleGenAI } = require('@google/genai');
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config();

const ROOT = path.resolve(__dirname, '..', '..');
const PROMPTS_PATH = path.join(ROOT, 'tests', 'assets', 'audio', 'tts', 'prompts.json');
const TARGET = (process.env.DATASET_TARGET || 'en').toLowerCase();
const DATASET_PATH = path.join(ROOT, 'tests', 'evals', `translation-ja-${TARGET}.json`);
const MODEL = process.env.DATASET_MODEL || 'gemini-2.0-flash';
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.DATASET_CONCURRENCY || '8', 10));
const RETRY_COUNT = Math.max(1, Number.parseInt(process.env.DATASET_RETRY_COUNT || '3', 10));
const SKIP_EXISTING = process.env.DATASET_SKIP_EXISTING !== '0';

const LANGUAGE_LABELS = {
  en: 'English',
  vi: 'Vietnamese'
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(text, targetLabel) {
  if (TARGET === 'vi') {
    return [
      'You are a professional translator working at a Japanese SIer.',
      `Translate the following text from Japanese to ${targetLabel}.`,
      'Use concise Vietnamese in a professional business tone.',
      'Write Vietnamese using ASCII only (no diacritics).',
      'Prefer future markers like "se" or "chung toi se" for planned actions.',
      'Avoid English phrasing like "We will".',
      'Keep clause order close to the source and avoid paraphrasing.',
      'Keep technical terms and product names in English (e.g., AWS, GitHub Actions, API Gateway).',
      'Do not leave any Japanese words untranslated.',
      'Do not paraphrase or summarize. Do not omit details.',
      'Output only the translation, nothing else.',
      '',
      `Text: ${text}`
    ].join('\n');
  }

  return [
    'You are a professional translator working at a Japanese SIer.',
    `Translate the following text from Japanese to ${targetLabel}.`,
    'Use concise professional English.',
    'Keep technical terms and product names in English as-is.',
    'Do not leave any Japanese words untranslated.',
    'Use a plan/roadmap tone; for planned actions prefer sentences that start with "We will".',
    'Avoid imperative or gerund phrasing and keep clause order close to the source.',
    'Use plural nouns for general categories (logs, files, procedures) unless singular is explicit.',
    'Do not paraphrase or summarize. Do not omit details.',
    'Output only the translation, nothing else.',
    '',
    `Text: ${text}`
  ].join('\n');
}

async function translateWithRetry(ai, text, targetLabel) {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      if (attempt > 1) {
        console.log(`Retry ${attempt}/${RETRY_COUNT}`);
      }
      const response = await ai.models.generateContent({
        model: MODEL,
        config: {
          temperature: 0,
          topP: 0.2,
          maxOutputTokens: 512,
          responseMimeType: 'text/plain'
        },
        contents: [{
          role: 'user',
          parts: [{ text: buildPrompt(text, targetLabel) }]
        }]
      });

      const output = (response.text || '').trim();
      if (!output) {
        throw new Error('Empty translation result.');
      }
      return output;
    } catch (error) {
      lastError = error;
      console.warn(`Translation failed: ${error.message}`);
      if (attempt < RETRY_COUNT) {
        await sleep(500);
      }
    }
  }

  throw lastError;
}

function parseIdNumber(id) {
  const match = String(id).match(/\\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const targetLabel = LANGUAGE_LABELS[TARGET] || TARGET;
  const promptRaw = await fs.readFile(PROMPTS_PATH, 'utf8');
  const prompts = JSON.parse(promptRaw);

  let dataset = [];
  try {
    const datasetRaw = await fs.readFile(DATASET_PATH, 'utf8');
    dataset = JSON.parse(datasetRaw);
  } catch {
    dataset = [];
  }

  const datasetMap = new Map(dataset.map((entry) => [entry.id, entry]));
  const tasks = [];

  for (const prompt of prompts) {
    if (SKIP_EXISTING && datasetMap.has(prompt.id)) {
      continue;
    }
    tasks.push(prompt);
  }

  if (!tasks.length) {
    console.log('No missing dataset entries to generate.');
    return;
  }

  console.log(`Generating ${tasks.length} translations for ${targetLabel} with concurrency=${CONCURRENCY}.`);
  const ai = new GoogleGenAI({ apiKey });
  let index = 0;

  async function worker(workerId) {
    while (true) {
      const currentIndex = index++;
      if (currentIndex >= tasks.length) {
        return;
      }
      const prompt = tasks[currentIndex];
      console.log(`[worker ${workerId}] Translating ${prompt.id}`);
      try {
        const reference = await translateWithRetry(ai, prompt.text, targetLabel);
        datasetMap.set(prompt.id, {
          id: prompt.id,
          reference,
          keywords: []
        });
        console.log(`[worker ${workerId}] Saved ${prompt.id}`);
      } catch (error) {
        console.error(`[worker ${workerId}] Failed ${prompt.id}: ${error.message}`);
      }
      await sleep(200);
    }
  }

  const workerCount = Math.min(CONCURRENCY, tasks.length);
  await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

  const merged = Array.from(datasetMap.values()).sort((a, b) => {
    const numA = parseIdNumber(a.id);
    const numB = parseIdNumber(b.id);
    if (numA !== numB) {
      return numA - numB;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  await fs.writeFile(DATASET_PATH, JSON.stringify(merged, null, 2));
  console.log(`Wrote dataset: ${DATASET_PATH} (${merged.length} items).`);
}

main().catch((error) => {
  console.error('Dataset generation failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
