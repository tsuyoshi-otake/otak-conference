const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.json');
const ANALYSIS_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.analysis.json');
const RESULTS_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'audio-normalization-tuning.json');

const LIMIT = Number.parseInt(process.env.TUNE_LIMIT || '40', 10);
const ITEM_CONCURRENCY = Number.parseInt(process.env.TUNE_ITEM_CONCURRENCY || '16', 10);
const CHUNK_SECONDS = process.env.TUNE_CHUNK_SECONDS || '0.25';
const CHUNK_DELAY_MS = process.env.TUNE_CHUNK_DELAY_MS || '250';
const LEAD_SILENCE_SEC = process.env.TUNE_LEAD_SILENCE_SEC || '0.5';
const MIN_GAIN = process.env.TUNE_MIN_GAIN || '0.6';

const RMS_VALUES = (process.env.TUNE_RMS_VALUES || '0.06,0.07,0.08,0.09')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_GAIN_VALUES = (process.env.TUNE_MAX_GAIN_VALUES || '1.6,1.8,2.0,2.2')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const combos = [];
for (const rms of RMS_VALUES) {
  for (const maxGain of MAX_GAIN_VALUES) {
    combos.push({ targetRms: Number.parseFloat(rms), maxGain: Number.parseFloat(maxGain) });
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
    EVAL_FORCE_TEXT_FALLBACK: '1',
    EVAL_CHUNK_SECONDS: CHUNK_SECONDS,
    EVAL_CHUNK_DELAY_MS: CHUNK_DELAY_MS,
    EVAL_LEAD_SILENCE_SEC: LEAD_SILENCE_SEC,
    EVAL_MIN_GAIN: MIN_GAIN
  };

  const evalScript = path.join(ROOT, 'tests', 'scripts', 'eval-translation-audio.js');
  const analysisScript = path.join(ROOT, 'tests', 'scripts', 'analyze-eval-output.js');
  const results = [];

  for (const combo of combos) {
    const env = {
      ...baseEnv,
      EVAL_TARGET_RMS: String(combo.targetRms),
      EVAL_MAX_GAIN: String(combo.maxGain)
    };

    console.log(`\n=== Tuning combo: rms=${combo.targetRms} maxGain=${combo.maxGain} ===`);
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
