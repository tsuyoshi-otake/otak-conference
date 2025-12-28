const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.json');
const ANALYSIS_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'translation-ja-en.analysis.json');
const RESULTS_PATH = path.join(ROOT, 'tests', 'evals', 'output', 'audio-prep-tuning.json');

const LIMIT = Number.parseInt(process.env.TUNE_LIMIT || '40', 10);
const ITEM_CONCURRENCY = Number.parseInt(process.env.TUNE_ITEM_CONCURRENCY || '16', 10);
const CHUNK_SECONDS = process.env.TUNE_CHUNK_SECONDS || '0.25';
const CHUNK_DELAY_MS = process.env.TUNE_CHUNK_DELAY_MS || '250';

const combos = [
  { targetRms: 0.07, leadSilenceSec: 0.4 },
  { targetRms: 0.08, leadSilenceSec: 0.4 },
  { targetRms: 0.09, leadSilenceSec: 0.4 },
  { targetRms: 0.07, leadSilenceSec: 0.5 },
  { targetRms: 0.08, leadSilenceSec: 0.5 },
  { targetRms: 0.09, leadSilenceSec: 0.5 },
  { targetRms: 0.07, leadSilenceSec: 0.6 },
  { targetRms: 0.08, leadSilenceSec: 0.6 },
  { targetRms: 0.09, leadSilenceSec: 0.6 }
];

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
  if (a.summary.avgF1 !== b.summary.avgF1) {
    return b.summary.avgF1 - a.summary.avgF1;
  }
  if (a.summary.avgRecall !== b.summary.avgRecall) {
    return b.summary.avgRecall - a.summary.avgRecall;
  }
  if (a.analysis.lowInputCount !== b.analysis.lowInputCount) {
    return a.analysis.lowInputCount - b.analysis.lowInputCount;
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
    EVAL_CHUNK_DELAY_MS: CHUNK_DELAY_MS
  };

  const evalScript = path.join(ROOT, 'tests', 'scripts', 'eval-translation-audio.js');
  const analysisScript = path.join(ROOT, 'tests', 'scripts', 'analyze-eval-output.js');
  const results = [];

  for (const combo of combos) {
    const env = {
      ...baseEnv,
      EVAL_TARGET_RMS: String(combo.targetRms),
      EVAL_LEAD_SILENCE_SEC: String(combo.leadSilenceSec)
    };

    console.log(`\n=== Tuning combo: rms=${combo.targetRms} lead=${combo.leadSilenceSec}s ===`);
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
