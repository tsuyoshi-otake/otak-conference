const fs = require('fs');
const path = require('path');

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
const OUTPUT_REPORT_PATH = process.env.EVAL_ANALYSIS_PATH
  ? path.resolve(ROOT, process.env.EVAL_ANALYSIS_PATH)
  : OUTPUT_PATH.replace(/\.json$/i, '.analysis.json');

const SHORT_RATIO_THRESHOLD = Number.parseFloat(process.env.EVAL_SHORT_RATIO || '0.6');
const INPUT_F1_THRESHOLD = Number.parseFloat(process.env.EVAL_INPUT_F1 || '0.6');

function normalizeEnglish(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeEnglish(text) {
  const normalized = normalizeEnglish(text);
  return normalized ? normalized.split(' ') : [];
}

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

function buildMap(list, key) {
  const map = new Map();
  for (const item of list) {
    map.set(item[key], item);
  }
  return map;
}

function main() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`Eval output not found: ${OUTPUT_PATH}`);
  }

  const report = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  const dataset = fs.existsSync(DATASET_PATH)
    ? JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'))
    : [];
  const prompts = fs.existsSync(PROMPT_PATH)
    ? JSON.parse(fs.readFileSync(PROMPT_PATH, 'utf8'))
    : [];

  const datasetMap = buildMap(dataset, 'id');
  const promptMap = buildMap(prompts, 'id');

  const runs = report.runs.map((run) => {
    const reference = run.reference || (datasetMap.get(run.id) || {}).reference || '';
    const output = run.output || '';
    const refTokens = tokenizeEnglish(reference);
    const outTokens = tokenizeEnglish(output);
    const outputRatio = refTokens.length ? outTokens.length / refTokens.length : 0;

    const prompt = (promptMap.get(run.id) || {}).text || '';
    const inputText = run.inputTranscription || '';
    const inputF1 = prompt ? computeF1(tokenizeChars(prompt), tokenizeChars(inputText)) : null;

    const keywords = (datasetMap.get(run.id) || {}).keywords || [];
    const missingKeywords = keywords.filter((kw) => !normalizeEnglish(output).includes(normalizeEnglish(kw)));

    return {
      id: run.id,
      voice: run.voice,
      f1: run.metrics && typeof run.metrics.f1 === 'number' ? run.metrics.f1 : 0,
      outputRatio,
      inputF1,
      missingKeywords,
      output,
      reference,
      prompt,
      inputTranscription: inputText
    };
  });

  const shortOutputs = runs.filter((run) => run.outputRatio > 0 && run.outputRatio < SHORT_RATIO_THRESHOLD);
  const lowInput = runs.filter((run) => run.inputF1 !== null && run.inputF1 < INPUT_F1_THRESHOLD);
  const missingKeywordRuns = runs.filter((run) => run.missingKeywords.length > 0);

  const keywordCounts = {};
  for (const run of missingKeywordRuns) {
    for (const kw of run.missingKeywords) {
      keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
    }
  }
  const topMissingKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([keyword, count]) => ({ keyword, count }));

  const worstByF1 = [...runs].sort((a, b) => a.f1 - b.f1).slice(0, 6);
  const worstByInput = runs
    .filter((run) => run.inputF1 !== null)
    .sort((a, b) => (a.inputF1 || 0) - (b.inputF1 || 0))
    .slice(0, 6);

  const analysis = {
    source: path.relative(ROOT, OUTPUT_PATH),
    summary: {
      totalRuns: runs.length,
      shortOutputCount: shortOutputs.length,
      lowInputCount: lowInput.length,
      missingKeywordCount: missingKeywordRuns.length,
      topMissingKeywords
    },
    worstByF1: worstByF1.map((run) => ({
      id: run.id,
      voice: run.voice,
      f1: Number(run.f1.toFixed(3)),
      outputRatio: Number(run.outputRatio.toFixed(2)),
      missingKeywords: run.missingKeywords,
      output: run.output.slice(0, 180),
      reference: run.reference.slice(0, 180)
    })),
    worstInput: worstByInput.map((run) => ({
      id: run.id,
      voice: run.voice,
      inputF1: run.inputF1 === null ? null : Number(run.inputF1.toFixed(3)),
      prompt: run.prompt.slice(0, 140),
      inputTranscription: run.inputTranscription.slice(0, 140)
    }))
  };

  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(analysis, null, 2));
  console.log(JSON.stringify(analysis.summary, null, 2));
  console.log(`Saved analysis: ${OUTPUT_REPORT_PATH}`);
}

main();
