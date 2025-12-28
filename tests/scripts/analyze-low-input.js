const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_PATH = process.env.EVAL_OUTPUT_PATH
  ? path.resolve(ROOT, process.env.EVAL_OUTPUT_PATH)
  : path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.json');
const PROMPT_PATH = process.env.EVAL_PROMPT_PATH
  ? path.resolve(ROOT, process.env.EVAL_PROMPT_PATH)
  : path.join(ROOT, 'tests', 'assets', 'audio', 'tts', 'prompts.json');
const OUTPUT_REPORT_PATH = process.env.EVAL_LOW_INPUT_PATH
  ? path.resolve(ROOT, process.env.EVAL_LOW_INPUT_PATH)
  : path.join(ROOT, 'tests', 'evals', 'output', 'low-input-analysis.json');

const INPUT_F1_THRESHOLD = Number.parseFloat(process.env.EVAL_INPUT_F1 || '0.6');
const LONG_PROMPT_THRESHOLD = Number.parseInt(process.env.EVAL_LONG_PROMPT || '160', 10);

function normalizeJapanese(text) {
  return (text || '')
    .replace(/[^\u3040-\u30ff\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaffA-Za-z0-9]/g, '');
}

function tokenizeChars(text) {
  const normalized = normalizeJapanese(text);
  return Array.from(normalized);
}

function computeF1(referenceTokens, outputTokens) {
  if (!referenceTokens.length || !outputTokens.length) {
    return 0;
  }
  const refCounts = new Map();
  for (const token of referenceTokens) {
    refCounts.set(token, (refCounts.get(token) || 0) + 1);
  }
  let overlap = 0;
  for (const token of outputTokens) {
    const count = refCounts.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      refCounts.set(token, count - 1);
    }
  }
  const precision = overlap / outputTokens.length;
  const recall = overlap / referenceTokens.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function extractLatinTokens(text) {
  return (text || '').match(/[A-Za-z][A-Za-z0-9+._/-]*/g) || [];
}

function normalizeAscii(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildMap(list, key) {
  const map = new Map();
  for (const item of list) {
    map.set(item[key], item);
  }
  return map;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function main() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`Eval output not found: ${OUTPUT_PATH}`);
  }
  if (!fs.existsSync(PROMPT_PATH)) {
    throw new Error(`Prompt file not found: ${PROMPT_PATH}`);
  }

  const report = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const prompts = JSON.parse(fs.readFileSync(PROMPT_PATH, 'utf8'));
  const promptMap = buildMap(prompts, 'id');

  const missingTokenCounts = {};
  const lowInputRuns = [];
  const categoryCounts = {
    latinPresent: 0,
    latinHeavy: 0,
    digitPresent: 0,
    hasSlash: 0,
    hasHyphen: 0,
    longPrompt: 0,
    acronymPresent: 0
  };

  for (const run of report.runs || []) {
    const prompt = (promptMap.get(run.id) || {}).text || '';
    const inputText = run.inputTranscription || '';
    const inputF1 = prompt
      ? computeF1(tokenizeChars(prompt), tokenizeChars(inputText))
      : null;
    if (inputF1 === null || inputF1 >= INPUT_F1_THRESHOLD) {
      continue;
    }

    const latinTokens = extractLatinTokens(prompt);
    const digitCount = (prompt.match(/\d/g) || []).length;
    const hasSlash = prompt.includes('/');
    const hasHyphen = prompt.includes('-');
    const isLongPrompt = prompt.length >= LONG_PROMPT_THRESHOLD;
    const acronymTokens = latinTokens.filter((token) => /^[A-Z0-9]{2,}$/.test(token));
    const inputAscii = normalizeAscii(run.inputTranscriptionNormalized || inputText);

    if (latinTokens.length > 0) categoryCounts.latinPresent += 1;
    if (latinTokens.length >= 3) categoryCounts.latinHeavy += 1;
    if (digitCount > 0) categoryCounts.digitPresent += 1;
    if (hasSlash) categoryCounts.hasSlash += 1;
    if (hasHyphen) categoryCounts.hasHyphen += 1;
    if (isLongPrompt) categoryCounts.longPrompt += 1;
    if (acronymTokens.length > 0) categoryCounts.acronymPresent += 1;

    for (const token of latinTokens) {
      const compact = normalizeAscii(token);
      if (!compact) continue;
      if (!inputAscii.includes(compact)) {
        missingTokenCounts[compact] = (missingTokenCounts[compact] || 0) + 1;
      }
    }

    lowInputRuns.push({
      id: run.id,
      voice: run.voice,
      inputF1: Number(inputF1.toFixed(3)),
      promptLength: prompt.length,
      latinTokenCount: latinTokens.length,
      digitCount,
      hasSlash,
      hasHyphen,
      isLongPrompt,
      acronymTokens,
      prompt: prompt.slice(0, 180),
      inputTranscription: inputText.slice(0, 180)
    });
  }

  const inputF1Values = lowInputRuns.map((run) => run.inputF1).filter((v) => typeof v === 'number');
  const summary = {
    totalRuns: (report.runs || []).length,
    lowInputCount: lowInputRuns.length,
    threshold: INPUT_F1_THRESHOLD,
    avgInputF1: inputF1Values.length
      ? inputF1Values.reduce((sum, value) => sum + value, 0) / inputF1Values.length
      : null,
    medianInputF1: median(inputF1Values),
    longPromptThreshold: LONG_PROMPT_THRESHOLD,
    categories: categoryCounts
  };

  const topMissingTokens = Object.entries(missingTokenCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([token, count]) => ({ token, count }));

  const worstInputs = [...lowInputRuns]
    .sort((a, b) => a.inputF1 - b.inputF1)
    .slice(0, 10);

  const reportOut = {
    source: path.relative(ROOT, OUTPUT_PATH),
    summary,
    topMissingTokens,
    worstInputs
  };

  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(reportOut, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Saved low-input analysis: ${OUTPUT_REPORT_PATH}`);
}

main();
