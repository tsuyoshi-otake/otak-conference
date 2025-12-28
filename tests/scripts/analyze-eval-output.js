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

function normalizeForInputF1(text) {
  if (!text) return '';
  let normalized = text.normalize('NFKC');
  normalized = normalized.replace(/\s+/g, ' ');
  const jpSpacing = /([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])\s+([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])/gu;
  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(jpSpacing, '$1$2');
  }
  normalized = normalized.replace(/ー\s+([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])/gu, 'ー$1');
  normalized = normalized.replace(/([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])\s+ー/gu, '$1ー');

  const replacements = [
    [/GitHub\s*Actions?/gi, 'githubactions'],
    [/Git\s*Hub\s*Actions?/gi, 'githubactions'],
    [/ギッ?ト?ハブ\s*アクションズ?/g, 'githubactions'],
    [/ギットハブ\s*アクションズ?/g, 'githubactions'],
    [/\bCI\s*\/\s*CD\b/gi, 'cicd'],
    [/C\s*I\s*\/\s*C\s*D/gi, 'cicd'],
    [/シー\s*アイ\s*シー\s*ディー/g, 'cicd'],
    [/シーアイシーディー/g, 'cicd'],
    [/\bE\s*2\s*E\b/gi, 'e2e'],
    [/エンドツーエンド/g, 'e2e'],
    [/ユニットテスト/g, 'unittest'],
    [/unit\s*test/gi, 'unittest'],
    [/監査\s*ログ/g, 'auditlog'],
    [/監査ログ/g, 'auditlog'],
    [/オーディット\s*ログ/g, 'auditlog'],
    [/audit\s*log/gi, 'auditlog'],
    [/ステップ\s*ファンクションズ?/g, 'stepfunctions'],
    [/step\s*functions/gi, 'stepfunctions'],
    [/イッ?シューズ/g, 'issues'],
    [/イッ?シュー/g, 'issue'],
    [/issue\s*templates?/gi, 'issuetemplates'],
    [/レー\s*ベル/g, 'label'],
    [/レーベル/g, 'label'],
    [/ラベル/g, 'label'],
    [/マイルスト\s*ーン/g, 'milestone'],
    [/マイルストーン/g, 'milestone'],
    [/アサイニー/g, 'assignee'],
    [/アサイン/g, 'assignee'],
    [/カンバン/g, 'kanban'],
    [/看板/g, 'kanban'],
    [/プロジェクト/g, 'projects'],
    [/イシューテンプレート/g, 'issuetemplates'],
    [/イシュー\s*テンプレート/g, 'issuetemplates'],
    [/マイグレーション/g, 'migration'],
    [/マイグレ/g, 'migration'],
    [/移行/g, 'migration'],
    [/ステートレス/g, 'stateless'],
    [/ステートフル/g, 'stateful'],
    [/ステート/g, 'state'],
    [/イデンポテンシー/g, 'idempotency'],
    [/冪等性/g, 'idempotency'],
    [/重複排除/g, 'deduplication'],
    [/デデュープ/g, 'deduplication'],
    [/デデュープリケーション/g, 'deduplication'],
    [/音声翻訳/g, 'speechtranslation'],
    [/モック/g, 'mock'],
    [/テクニカルデット/g, 'technicaldebt'],
    [/技術的負債/g, 'technicaldebt'],
    [/エスカレーション/g, 'escalation'],
    [/キャッシュ/g, 'cache'],
    [/マスキング/g, 'masking'],
    [/暗号化/g, 'encryption'],
    [/単体テスト/g, 'unittest'],
    [/タイプ\s*スクリプト/g, 'typescript'],
    [/type\s*script/gi, 'typescript'],
    [/タイプ\s*アノテーション/g, 'typeannotation'],
    [/type\s*annotation/gi, 'typeannotation'],
    [/インターフェース/g, 'interface'],
    [/interface/gi, 'interface'],
    [/ジェネリックス/g, 'generics'],
    [/generics?/gi, 'generics'],
    [/ユーティリティ\s*タイプス?/g, 'utilitytypes'],
    [/utility\s*types?/gi, 'utilitytypes'],
    [/ジャヴ?ァ/g, 'java'],
    [/java/gi, 'java'],
    [/メイベ(?:ン)?/g, 'maven'],
    [/maven/gi, 'maven'],
    [/pom\s*\.?\s*xml/gi, 'pomxml'],
    [/ポム\s*\.?\s*xml/g, 'pomxml'],
    [/ボム\s*\.?\s*xml/g, 'pomxml'],
    [/スプリング\s*ブート/g, 'springboot'],
    [/spring\s*boot/gi, 'springboot'],
    [/スプリング\s*セキュリティ/g, 'springsecurity'],
    [/spring\s*security/gi, 'springsecurity'],
    [/スプリング\s*データ\s*jpa/gi, 'springdatajpa'],
    [/spring\s*data\s*jpa/gi, 'springdatajpa'],
    [/jpa/gi, 'jpa'],
    [/ジェイ\s*ピー\s*エー/g, 'jpa'],
    [/junit/gi, 'junit'],
    [/ジェイ\s*ユニット/g, 'junit'],
    [/mockito/gi, 'mockito'],
    [/モックイト/g, 'mockito'],
    [/sonar\s*qube/gi, 'sonarqube'],
    [/ソナー\s*キューブ/g, 'sonarqube'],
    [/checkstyle/gi, 'checkstyle'],
    [/チェック\s*スタイル/g, 'checkstyle'],
    [/spot\s*bugs?/gi, 'spotbugs'],
    [/スポット\s*バグズ?/g, 'spotbugs'],
    [/playwright/gi, 'playwright'],
    [/プレイ\s*ライト/g, 'playwright'],
    [/jest/gi, 'jest'],
    [/ジェスト/g, 'jest'],
    [/vitest/gi, 'vitest'],
    [/ヴィテスト/g, 'vitest'],
    [/ヴァイテスト/g, 'vitest'],
    [/cypress/gi, 'cypress'],
    [/サイプレス/g, 'cypress'],
    [/docker/gi, 'docker'],
    [/ドッカー/g, 'docker'],
    [/kubernetes/gi, 'kubernetes'],
    [/k8s/gi, 'k8s'],
    [/クーベネ(?:ティス|テス)/g, 'kubernetes'],
    [/クバネ(?:ティス|テス)/g, 'kubernetes'],
    [/branch\s*protection/gi, 'branchprotection'],
    [/ブランチ\s*プロテクション/g, 'branchprotection'],
    [/dependabot/gi, 'dependabot'],
    [/ディ?ペンダボット/g, 'dependabot'],
    [/secret\s*scanning/gi, 'secretscanning'],
    [/シークレット\s*スキャニング/g, 'secretscanning'],
    [/request\s*changes/gi, 'requestchanges'],
    [/リクエスト\s*チェンジ(?:ズ)?/g, 'requestchanges'],
    [/ベスト\s*チェンジ/g, 'requestchanges'],
    [/merge/gi, 'merge'],
    [/マージ/g, 'merge'],
    [/approve/gi, 'approve'],
    [/アプル?ーブ/g, 'approve'],
    [/pull\s*request/gi, 'pullrequest'],
    [/\bpr\b/gi, 'pr']
  ];
  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.toLowerCase();

  const issueContext = /(issue|issues|label|milestone|assignee|issuetemplates|projects|kanban|アサイン|アサイニー|イッ?シュー|ラベル|レーベル|マイルストーン)/i.test(normalized);
  if (issueContext) {
    normalized = normalized.replace(/一周/g, 'issue');
    normalized = normalized.replace(/1\s*周/g, 'issue');
    normalized = normalized.replace(/テンプレート/g, 'issuetemplates');
    normalized = normalized.replace(/テンプレ/g, 'issuetemplates');
    normalized = normalized.replace(/templates\s*ート/gi, 'issuetemplates');
    normalized = normalized.replace(/\btemplates\b/gi, 'issuetemplates');
  }

  normalized = normalized.replace(/[^\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}a-z0-9]+/gu, ' ');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

function tokenizeChars(text) {
  const normalized = normalizeJapanese(text);
  return Array.from(normalized);
}

function tokenizeForInputF1(text) {
  const normalized = normalizeForInputF1(text);
  if (!normalized) {
    return [];
  }
  return normalized.match(/[a-z0-9]+|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) || [];
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
    const inputF1Raw = prompt ? computeF1(tokenizeChars(prompt), tokenizeChars(inputText)) : null;
    const inputF1 = prompt ? computeF1(tokenizeForInputF1(prompt), tokenizeForInputF1(inputText)) : null;
    const inputF1Normalized = inputF1;

    const keywords = (datasetMap.get(run.id) || {}).keywords || [];
    const missingKeywords = keywords.filter((kw) => !normalizeEnglish(output).includes(normalizeEnglish(kw)));

    return {
      id: run.id,
      voice: run.voice,
      f1: run.metrics && typeof run.metrics.f1 === 'number' ? run.metrics.f1 : 0,
      outputRatio,
      inputF1,
      inputF1Raw,
      inputF1Normalized,
      missingKeywords,
      output,
      reference,
      prompt,
      inputTranscription: inputText
    };
  });

  const shortOutputs = runs.filter((run) => run.outputRatio > 0 && run.outputRatio < SHORT_RATIO_THRESHOLD);
  const lowInput = runs.filter((run) => run.inputF1 !== null && run.inputF1 < INPUT_F1_THRESHOLD);
  const lowInputRaw = runs.filter((run) => run.inputF1Raw !== null && run.inputF1Raw < INPUT_F1_THRESHOLD);
  const lowInputNormalized = runs.filter((run) => run.inputF1Normalized !== null && run.inputF1Normalized < INPUT_F1_THRESHOLD);
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
      lowInputRawCount: lowInputRaw.length,
      lowInputNormalizedCount: lowInputNormalized.length,
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
      inputF1Raw: run.inputF1Raw === null ? null : Number(run.inputF1Raw.toFixed(3)),
      inputF1Normalized: run.inputF1Normalized === null ? null : Number(run.inputF1Normalized.toFixed(3)),
      prompt: run.prompt.slice(0, 140),
      inputTranscription: run.inputTranscription.slice(0, 140)
    }))
  };

  fs.writeFileSync(OUTPUT_REPORT_PATH, JSON.stringify(analysis, null, 2));
  console.log(JSON.stringify(analysis.summary, null, 2));
  console.log(`Saved analysis: ${OUTPUT_REPORT_PATH}`);
}

main();

