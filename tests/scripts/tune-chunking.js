const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.json');
const ANALYSIS_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.analysis.json');
const RESULTS_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'audio-chunking-tuning.json');

const LIMIT = Number.parseInt(process.env.TUNE_LIMIT || '40', 10);
const ITEM_CONCURRENCY = Number.parseInt(process.env.TUNE_ITEM_CONCURRENCY || '16', 10);
const CHUNK_SECONDS_VALUES = (process.env.TUNE_CHUNK_SECONDS || '0.25,0.3,0.35')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const CHUNK_DELAY_VALUES = (process.env.TUNE_CHUNK_DELAY_MS || '80,120,160')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const combos = [];
for (const seconds of CHUNK_SECONDS_VALUES) {
  for (const delay of CHUNK_DELAY_VALUES) {
    combos.push({ chunkSeconds: Number.parseFloat(seconds), chunkDelayMs: Number.parseInt(delay, 10) });
  }
}

function runNode(scriptPath, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath], {
      env,
      stdio: 'inherit',
      cwd: ROOT
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${scriptPath} (exit ${code})`));
      }
    });
  });
}

function compareResults(a, b) {
  const aRaw = Number.isFinite(a.analysis.lowInputRawCount) ? a.analysis.lowInputRawCount : Number.POSITIVE_INFINITY;
  const bRaw = Number.isFinite(b.analysis.lowInputRawCount) ? b.analysis.lowInputRawCount : Number.POSITIVE_INFINITY;
  if (aRaw !== bRaw) {
    return aRaw - bRaw;
  }
  if (a.analysis.lowInputCount !== b.analysis.lowInputCount) {
    return a.analysis.lowInputCount - b.analysis.lowInputCount;
  }
  if (a.summary.avgF1 !== b.summary.avgF1) {
    return b.summary.avgF1 - a.summary.avgF1;
  }
  return a.summary.avgLatencyMs - b.summary.avgLatencyMs;
}

async function main() {
  const baseEnv = {
    ...process.env,
    EVAL_TARGET: 'en',
    EVAL_LIMIT: String(LIMIT),
    EVAL_VOICES: 'Zephyr',
    EVAL_ITEM_CONCURRENCY: String(ITEM_CONCURRENCY),
    EVAL_INPUT_LANGUAGE_CODE: 'ja-JP',
    EVAL_FORCE_TEXT_FALLBACK: '1'
  };

  const evalScript = path.join(ROOT, 'tests', 'scripts', 'eval-translation-audio.js');
  const analysisScript = path.join(ROOT, 'tests', 'scripts', 'analyze-eval-output.js');
  const results = [];

  for (const combo of combos) {
    const env = {
      ...baseEnv,
      EVAL_CHUNK_SECONDS: String(combo.chunkSeconds),
      EVAL_CHUNK_DELAY_MS: String(combo.chunkDelayMs)
    };

    console.log(`\n=== Tuning combo: chunk=${combo.chunkSeconds}s delay=${combo.chunkDelayMs}ms ===`);
    await runNode(evalScript, env);
    await runNode(analysisScript, env);

    const output = JSON.parse(await fs.readFile(OUTPUT_PATH, 'utf8'));
    const analysis = JSON.parse(await fs.readFile(ANALYSIS_PATH, 'utf8'));

    results.push({
      config: combo,
      summary: output.summary,
      analysis: analysis.summary
    });
  }

  results.sort(compareResults);
  await fs.writeFile(RESULTS_PATH, JSON.stringify(results, null, 2));

  const best = results[0];
  console.log('\n=== Best combo ===');
  console.log(JSON.stringify(best, null, 2));
  console.log(`Saved tuning results: ${RESULTS_PATH}`);
}

main().catch((error) => {
  console.error('Tuning failed:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
