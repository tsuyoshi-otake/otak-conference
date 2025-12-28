const { GoogleGenAI } = require('@google/genai');
const fs = require('fs/promises');
const path = require('path');

require('dotenv').config();

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_PATH = process.env.EVAL_OUTPUT_PATH
  ? path.resolve(ROOT, process.env.EVAL_OUTPUT_PATH)
  : path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.json');
const DATASET_PATH = process.env.EVAL_DATASET_PATH
  ? path.resolve(ROOT, process.env.EVAL_DATASET_PATH)
  : path.join(ROOT, 'tests', 'evals', 'translation-ja-en.json');
const PROMPT_PATH = process.env.EVAL_PROMPT_PATH
  ? path.resolve(ROOT, process.env.EVAL_PROMPT_PATH)
  : path.join(ROOT, 'tests', 'assets', 'audio', 'tts', 'prompts.json');
const OUTPUT_REPORT_PATH = process.env.EVAL_SEMANTIC_OUTPUT_PATH
  ? path.resolve(ROOT, process.env.EVAL_SEMANTIC_OUTPUT_PATH)
  : path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.semantic.json');

const MODEL = process.env.EVAL_SEMANTIC_MODEL || 'gemini-3-flash-preview';
const RAW_API_VERSION = process.env.EVAL_SEMANTIC_API_VERSION;
const API_VERSION = RAW_API_VERSION && !['default', 'none', 'auto'].includes(RAW_API_VERSION.toLowerCase())
  ? RAW_API_VERSION
  : 'v1beta';
const LIMIT = Number.parseInt(process.env.EVAL_SEMANTIC_LIMIT || '50', 10);
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.EVAL_SEMANTIC_CONCURRENCY || '4', 10));

function buildMap(list, key) {
  const map = new Map();
  for (const item of list) {
    map.set(item[key], item);
  }
  return map;
}

function buildPrompt({ source, reference, output }) {
  return [
    'You are a bilingual QA reviewer for Japanese-to-English technical translations.',
    'Judge semantic fidelity over literal wording. Do not penalize paraphrasing if meaning is preserved.',
    'Evaluate the candidate against the Japanese source and the reference.',
    'Focus on omissions, mistranslations, and technical term accuracy.',
    '',
    'Return JSON only with the following schema:',
    '{"adequacy":0-5,"fluency":0-5,"terminology":0-5,"overall":0-5,"verdict":"pass|minor|major","issues":["..."]}',
    '',
    'Scoring rubric:',
    '- adequacy: meaning coverage (5 = fully faithful, 0 = unrelated).',
    '- terminology: technical term accuracy (5 = all correct).',
    '- fluency: grammatical and natural English (5 = native).',
    '- overall: holistic quality (0-5).',
    '- verdict: pass = no important issues; minor = small issues; major = meaning error or major omission.',
    '- issues: 0-3 short phrases describing the biggest issues.',
    '',
    `Japanese source:\n${source}`,
    '',
    `Reference translation:\n${reference}`,
    '',
    `Candidate translation:\n${output}`
  ].join('\n');
}

async function runWithConcurrency(tasks, limit) {
  if (!tasks.length) return [];
  const results = new Array(tasks.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]();
    }
  });
  await Promise.all(workers);
  return results;
}

function safeParseJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  const withoutFences = trimmed.replace(/```json|```/gi, '').trim();
  const candidate = withoutFences.match(/\{[\s\S]*\}/);
  const payload = candidate ? candidate[0] : withoutFences;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function clampScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(5, num));
}

async function evaluateItem(ai, item) {
  const prompt = buildPrompt(item);
  const response = await ai.models.generateContentStream({
    model: MODEL,
    config: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      thinkingConfig: { includeThoughts: false, thinkingBudget: 0 }
    },
    contents: [{
      role: 'user',
      parts: [{ text: prompt }]
    }]
  });

  let combined = '';
  for await (const chunk of response) {
    if (!chunk) {
      continue;
    }
    if (chunk.text) {
      combined += chunk.text;
      continue;
    }
    const parts = chunk?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part && part.text) {
        combined += part.text;
      }
    }
  }

  const parsed = safeParseJson(combined);
  if (!parsed) {
    return {
      error: 'Failed to parse judge response',
      raw: combined.slice(0, 500)
    };
  }

  return {
    adequacy: clampScore(parsed.adequacy),
    fluency: clampScore(parsed.fluency),
    terminology: clampScore(parsed.terminology),
    overall: clampScore(parsed.overall),
    verdict: parsed.verdict,
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 3) : []
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const report = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
  const dataset = JSON.parse(await fs.readFile(DATASET_PATH, 'utf8'));
  const prompts = JSON.parse(await fs.readFile(PROMPT_PATH, 'utf8'));

  const datasetMap = buildMap(dataset, 'id');
  const promptMap = buildMap(prompts, 'id');
  const runs = report.runs || [];
  const selected = runs.slice(0, Math.min(LIMIT, runs.length));

  const ai = new GoogleGenAI({
    apiKey,
    ...(API_VERSION ? { httpOptions: { apiVersion: API_VERSION } } : {})
  });

  const tasks = selected.map((run) => async () => {
    const source = (promptMap.get(run.id) || {}).text || '';
    const reference = run.reference || (datasetMap.get(run.id) || {}).reference || '';
    const output = run.output || '';
    const evaluation = await evaluateItem(ai, { source, reference, output });
    return {
      id: run.id,
      source: source.slice(0, 200),
      reference: reference.slice(0, 200),
      output: output.slice(0, 200),
      evaluation
    };
  });

  const results = await runWithConcurrency(tasks, CONCURRENCY);
  const scored = results.filter((item) => item.evaluation && !item.evaluation.error);

  const summary = {
    totalRuns: results.length,
    scoredRuns: scored.length,
    avgAdequacy: average(scored.map((item) => item.evaluation.adequacy).filter((v) => v !== null)),
    avgFluency: average(scored.map((item) => item.evaluation.fluency).filter((v) => v !== null)),
    avgTerminology: average(scored.map((item) => item.evaluation.terminology).filter((v) => v !== null)),
    avgOverall: average(scored.map((item) => item.evaluation.overall).filter((v) => v !== null))
  };

  const verdictCounts = scored.reduce((acc, item) => {
    const verdict = item.evaluation.verdict || 'unknown';
    acc[verdict] = (acc[verdict] || 0) + 1;
    return acc;
  }, {});

  const worst = [...scored]
    .filter((item) => item.evaluation.overall !== null)
    .sort((a, b) => a.evaluation.overall - b.evaluation.overall)
    .slice(0, 6);

  const outputReport = {
    source: path.relative(ROOT, OUTPUT_PATH),
    model: MODEL,
    apiVersion: API_VERSION,
    limit: LIMIT,
    summary,
    verdictCounts,
    worstByOverall: worst,
    items: results
  };

  await fs.writeFile(OUTPUT_REPORT_PATH, JSON.stringify(outputReport, null, 2));
  console.log(JSON.stringify({ summary, verdictCounts }, null, 2));
  console.log(`Saved semantic eval: ${OUTPUT_REPORT_PATH}`);
}

main().catch((error) => {
  console.error('Semantic eval failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
