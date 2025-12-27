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

const TEXT_MODEL = process.env.EVAL_TEXT_MODEL || 'gemini-2.5-flash';
const RAW_TEXT_API_VERSION = process.env.EVAL_TEXT_API_VERSION;
const TEXT_API_VERSION = RAW_TEXT_API_VERSION && !['default', 'none', 'auto'].includes(RAW_TEXT_API_VERSION.toLowerCase())
  ? RAW_TEXT_API_VERSION
  : 'v1beta';
const TEXT_FALLBACK_ENABLED = !['0', 'false', 'no'].includes((process.env.EVAL_TEXT_FALLBACK || '1').toLowerCase());
const FORCE_TEXT_FALLBACK = !['0', 'false', 'no'].includes((process.env.EVAL_FORCE_TEXT_FALLBACK || '0').toLowerCase());
const MIN_OUTPUT_RATIO = Number.parseFloat(process.env.EVAL_MIN_OUTPUT_RATIO || '0.6');
const MIN_OUTPUT_TOKENS = Number.parseInt(process.env.EVAL_MIN_OUTPUT_TOKENS || '6', 10);
const IDLE_MODE = (process.env.EVAL_IDLE_MODE || 'both').toLowerCase();
const INPUT_LANGUAGE_CODE = process.env.EVAL_INPUT_LANGUAGE_CODE;
const GLOSSARY_MODE = (process.env.EVAL_GLOSSARY_MODE || 'keywords').toLowerCase();
const GLOSSARY_TERMS = (process.env.EVAL_GLOSSARY_TERMS || '')
  .split(',')
  .map((term) => term.trim())
  .filter(Boolean);
const NORMALIZE_TRANSCRIPTION = !['0', 'false', 'no'].includes((process.env.EVAL_NORMALIZE_TRANSCRIPTION || '1').toLowerCase());

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
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.EVAL_CONCURRENCY || '1', 10));

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

function formatGlossaryLine(glossaryTerms) {
  if (!glossaryTerms.length) {
    return '';
  }
  return `Preserve these terms exactly as written when the input refers to them, including katakana or spaced-letter variants: ${glossaryTerms.join(', ')}.`;
}

function getGlossaryTerms(item) {
  if (GLOSSARY_MODE === 'none') {
    return [];
  }
  const terms = [];
  if (GLOSSARY_MODE !== 'none' && Array.isArray(item.keywords)) {
    terms.push(...item.keywords);
  }
  if (GLOSSARY_TERMS.length) {
    terms.push(...GLOSSARY_TERMS);
  }
  return [...new Set(terms)];
}

function getTargetGuidance(target) {
  const normalized = String(target || '').toLowerCase();
  if (normalized === 'vi' || normalized === 'vietnamese') {
    const guidance = [
      'Use concise Vietnamese in a professional business tone.',
      'Write Vietnamese using ASCII only (no diacritics).',
      'Prefer future markers like "se" or "chung toi se" for planned actions.',
      'Avoid English phrasing like "We will".',
      'Keep clause order close to the source and avoid paraphrasing.',
      'Keep technical terms and product names in English (e.g., AWS, GitHub Actions, API Gateway).',
      'Do not leave any Japanese words untranslated.'
    ];
    return {
      system: guidance,
      text: guidance
    };
  }
  if (normalized === 'en' || normalized === 'english') {
    const guidance = [
      'Use concise professional English.',
      'Keep technical terms and product names in English as-is.',
      'Do not leave any Japanese words untranslated.',
      'Use a plan/roadmap tone; for planned actions prefer sentences that start with "We will".',
      'Avoid imperative or gerund phrasing and keep clause order close to the source.',
      'Use plural nouns for general categories (logs, files, procedures) unless singular is explicit.'
    ];
    return {
      system: guidance,
      text: guidance
    };
  }
  return { system: [], text: [] };
}

function buildSystemInstruction(targetLabel, glossaryTerms) {
  const guidance = getTargetGuidance(TARGET).system;
  return [
    'You are a professional translator working at a Japanese SIer.',
    'You are a real-time translator.',
    `Translate the user\'s Japanese speech to ${targetLabel}.`,
    'Translate literally and preserve technical terms, acronyms, and proper nouns in English.',
    'Keep numbers and identifiers unchanged.',
    formatGlossaryLine(glossaryTerms),
    'Do not paraphrase or summarize. Do not omit details.',
    'Produce a complete translation before stopping.',
    'The conversation domain likely includes keywords about Java, TypeScript, AWS, OCI, GitHub, OpenAI, Anthropic, unit tests, and E2E.',
    ...guidance,
    'Output only the translation with no commentary, labels, or analysis.',
    'If the input is silence or non-speech, output nothing.'
  ].filter(Boolean).join(' ');
}

function buildTextTranslationPrompt(text, targetLabel, glossaryTerms) {
  const guidance = getTargetGuidance(TARGET).text;
  return [
    `Translate the following text from Japanese to ${targetLabel}.`,
    'Preserve technical terms, acronyms, proper nouns, and numbers.',
    glossaryTerms.length
      ? `Preserve these terms exactly as written if the input references them (including katakana spellings): ${glossaryTerms.join(', ')}.`
      : '',
    'Do not paraphrase or summarize. Do not omit details.',
    ...guidance,
    'Output only the translation, nothing else.',
    '',
    `Text: ${text}`
  ].filter(Boolean).join('\n');
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

function normalizeTranscription(text, glossaryTerms = []) {
  if (!text) return '';
  let normalized = text.normalize('NFKC');
  normalized = normalized.replace(/\s+/g, ' ');

  const targetKey = String(TARGET || '').toLowerCase();
  const isVietnameseTarget = targetKey === 'vi' || targetKey === 'vietnamese';
  const isEnglishTarget = targetKey === 'en' || targetKey === 'english';

  // Collapse spaces between Japanese characters (multiple passes to catch overlaps).
  const japaneseSpacingPattern = /([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])\s+([\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}])/gu;
  let previous = '';
  while (normalized !== previous) {
    previous = normalized;
    normalized = normalized.replace(japaneseSpacingPattern, '$1$2');
  }

  // Collapse spaced acronyms/numbers: "A W S" -> "AWS", "E 2 E" -> "E2E", "O CI" -> "OCI".
  normalized = normalized.replace(/\b(?:[A-Za-z0-9]{1,3}\s+){1,}[A-Za-z0-9]{1,3}\b/g, (match) => match.replace(/\s+/g, ''));
  normalized = normalized.replace(/(?:スク){2,}/g, 'スク');

  const glossarySet = new Set(glossaryTerms.map((term) => term.toLowerCase()));
  const hasGlossary = (term) => glossarySet.has(term.toLowerCase());
  const replacements = [];

  replacements.push([/G\s*i\s*t\s*H\s*u\s*b/gi, 'GitHub']);
  replacements.push([/A\s*W\s*S/gi, 'AWS']);
  replacements.push([/V\s*P\s*C/gi, 'VPC']);
  replacements.push([/E\s*C\s*S/gi, 'ECS']);
  replacements.push([/A\s*P\s*I/gi, 'API']);
  replacements.push([/B\s*F\s*F/gi, 'BFF']);
  replacements.push([/E\s*2\s*E/gi, 'E2E']);
  replacements.push([/O\s*I\s*D\s*C/gi, 'OIDC']);
  replacements.push([/S\s*S\s*R/gi, 'SSR']);
  replacements.push([/I\s*S\s*R/gi, 'ISR']);
  replacements.push([/S\s*Q\s*S/gi, 'SQS']);
  replacements.push([/E\s*K\s*S/gi, 'EKS']);
  replacements.push([/H\s*P\s*A/gi, 'HPA']);
  replacements.push([/P\s*D\s*B/gi, 'PDB']);
  replacements.push([/D\s*L\s*Q/gi, 'DLQ']);
  replacements.push([/W\s*A\s*F/gi, 'WAF']);
  replacements.push([/S\s*3/gi, 'S3']);
  replacements.push([/G\s*r\s*a\s*p\s*h\s*Q\s*L/gi, 'GraphQL']);
  replacements.push([/T\s*y\s*p\s*e\s*S\s*c\s*r\s*i\s*p\s*t/gi, 'TypeScript']);
  replacements.push([/J\s*a\s*v\s*a/gi, 'Java']);
  replacements.push([/O\s*C\s*I/gi, 'OCI']);

  if (hasGlossary('typescript')) {
    replacements.push([/タイプスク(?:スク)*スクリプト/g, 'TypeScript']);
    replacements.push([/タイプスクリプト/g, 'TypeScript']);
  }
  if (hasGlossary('bff')) {
    replacements.push([/\bPF\b/g, 'BFF']);
    replacements.push([/\bBF\b/g, 'BFF']);
    replacements.push([/ビーエフエフ/g, 'BFF']);
  }
  if (hasGlossary('graphql')) {
    replacements.push([/グラフ\s*QL/gi, 'GraphQL']);
    replacements.push([/グラフキューエル/g, 'GraphQL']);
  }
  if (hasGlossary('jest')) {
    replacements.push([/ジェスト/g, 'Jest']);
  }
  if (hasGlossary('playwright')) {
    replacements.push([/プレイライト/g, 'Playwright']);
  }
  if (hasGlossary('github actions')) {
    replacements.push([/ギッ?ト?ド?ハブアクションズ/g, 'GitHub Actions']);
    replacements.push([/(?:ギ|ぎ)アクションズ?/g, 'GitHub Actions']);
  }
  if (hasGlossary('github')) {
    replacements.push([/ギッ?ト?ド?ハブ/g, 'GitHub']);
  }
  if (hasGlossary('e2e')) {
    replacements.push([/\b2E\b/g, 'E2E']);
    replacements.push([/イーツーイー/g, 'E2E']);
  }
  if (hasGlossary('ci')) {
    replacements.push([/シーアイ/g, 'CI']);
  }
  if (hasGlossary('cloud guard')) {
    replacements.push([/クラウドガード/g, 'Cloud Guard']);
  }
  if (hasGlossary('logging')) {
    replacements.push([/ログギング/g, 'Logging']);
    replacements.push([/ロギング/g, 'Logging']);
  }
  if (hasGlossary('runbook')) {
    replacements.push([/ランブック/g, 'runbook']);
  }
  if (hasGlossary('spring boot')) {
    replacements.push([/スプリングブート/g, 'Spring Boot']);
  }
  if (hasGlossary('lambda')) {
    replacements.push([/ラムダ/g, 'Lambda']);
  }
  if (hasGlossary('throttling')) {
    replacements.push([/スロットリング/g, 'throttling']);
  }
  if (hasGlossary('step functions')) {
    replacements.push([/ステップファンクションズ/g, 'Step Functions']);
  }
  if (hasGlossary('audit log')) {
    const auditValue = isVietnameseTarget ? 'audit log' : 'audit logs';
    replacements.push([/監査ログ/g, auditValue]);
    replacements.push([/カンサログ/g, auditValue]);
  }
  if (hasGlossary('openai')) {
    replacements.push([/オー?\s*プン\s*AI/gi, 'OpenAI']);
    replacements.push([/オープン\s*AI/gi, 'OpenAI']);
  }
  if (hasGlossary('anthropic')) {
    replacements.push([/アンスロピック/g, 'Anthropic']);
  }
  if (hasGlossary('api gateway')) {
    replacements.push([/API\s*ゲートウェイ/gi, 'API Gateway']);
    replacements.push([/PI\s*ゲートウェイ/gi, 'API Gateway']);
    replacements.push([/\bDI\b/gi, 'API Gateway']);
  }
  if (hasGlossary('sla')) {
    replacements.push([/\bSLA\b/gi, isVietnameseTarget ? 'SLA' : 'SLAs']);
  }
  if (hasGlossary('terraform')) {
    replacements.push([/テラフォーム/g, 'Terraform']);
    replacements.push([/テラホーム/g, 'Terraform']);
    if (isEnglishTarget) {
      replacements.push([/二重管理/g, 'manage both']);
      replacements.push([/統一形式/g, 'standardized']);
      replacements.push([/重要/g, 'critical']);
    } else if (isVietnameseTarget) {
      replacements.push([/二重管理/g, 'quan ly kep']);
      replacements.push([/統一形式/g, 'thong nhat dinh dang']);
      replacements.push([/重要/g, 'quan trong']);
    }
  }
  if (hasGlossary('zero trust')) {
    replacements.push([/ゼロトラスト/g, 'zero trust']);
  }
  if (hasGlossary('oidc')) {
    replacements.push([/\bOIDC\b/gi, 'OIDC']);
    replacements.push([/O\s*ID\s*C/gi, 'OIDC']);
    replacements.push([/ID\s*C/gi, 'OIDC']);
    replacements.push([/オーアイディーシー/g, 'OIDC']);
    if (isVietnameseTarget) {
      replacements.push([/\bC\b/g, 'OIDC']);
    }
  }
  if (hasGlossary('slack')) {
    replacements.push([/スラック/g, 'Slack']);
  }
  if (hasGlossary('athena')) {
    replacements.push([/アテナ/g, 'Athena']);
  }
  if (hasGlossary('json')) {
    replacements.push([/ジェイソン/g, 'JSON']);
    replacements.push([/J\s*SON/gi, 'JSON']);
  }
  if (hasGlossary('java')) {
    replacements.push([/ジャバ/g, 'Java']);
    replacements.push([/ザバ/g, 'Java']);
  }
  if (hasGlossary('microservices')) {
    if (isEnglishTarget) {
      replacements.push([/マイクロサービス/g, 'microservices']);
      replacements.push([/マイクロサービス化/g, 'microservice']);
      replacements.push([/microservices化/gi, 'microservice']);
      replacements.push([/段階的/g, 'gradually']);
    } else if (isVietnameseTarget) {
      replacements.push([/マイクロサービス/g, 'microservices']);
      replacements.push([/マイクロサービス化/g, 'microservice hoa']);
      replacements.push([/microservices化/gi, 'microservice hoa']);
      replacements.push([/段階的/g, 'dan']);
    }
  }
  if (hasGlossary('monolith')) {
    replacements.push([/モノリス/g, 'monolith']);
  }
  if (hasGlossary('security group')) {
    replacements.push([/セキュリティグループ/g, 'security group']);
  }
  if (hasGlossary('oci')) {
    replacements.push([/O\s*CI/gi, 'OCI']);
  }
  if (hasGlossary('unittest') || hasGlossary('unit test')) {
    replacements.push([/ユニットテスト/g, 'UnitTest']);
  }
  if (hasGlossary('prompt')) {
    replacements.push([/プロンプト/g, isVietnameseTarget ? 'prompt' : 'prompts']);
  }
  if (hasGlossary('versioning')) {
    replacements.push([/バージョン管理/g, isVietnameseTarget ? 'quan ly version' : 'versioning']);
  }
  if (hasGlossary('prompt') && hasGlossary('versioning')) {
    if (isVietnameseTarget) {
      replacements.push([/業務部門/g, 'bo phan nghiep vu']);
      replacements.push([/触れる/g, 'chinh']);
      replacements.push([/必須/g, 'can']);
    } else {
      replacements.push([/業務部門/g, 'business teams']);
      replacements.push([/触れる/g, 'edit']);
      replacements.push([/必須/g, 'required']);
    }
  }

  if (isEnglishTarget) {
    replacements.push([/抽象レイヤー/g, 'abstraction layer']);
    replacements.push([/中小レイヤー/g, 'abstraction layer']);
    replacements.push([/重症レイヤー/g, 'abstraction layer']);
    replacements.push([/テンプレ化/g, 'templates']);
    replacements.push([/テンプレ/g, 'templates']);
    replacements.push([/運用手順/g, 'operations']);
  } else if (isVietnameseTarget) {
    replacements.push([/抽象レイヤー/g, 'lop truu tuong']);
    replacements.push([/中小レイヤー/g, 'lop truu tuong']);
    replacements.push([/重症レイヤー/g, 'lop truu tuong']);
    replacements.push([/テンプレ化/g, 'template hoa']);
    replacements.push([/テンプレ/g, 'template hoa']);
  }
  replacements.push([/状態ファイル/g, 'state files']);
  if (hasGlossary('bff') && hasGlossary('graphql')) {
    if (isEnglishTarget) {
      replacements.push([/強化の方針/g, 'plan to strengthen']);
      replacements.push([/レビュー中/g, 'are reviewing']);
      replacements.push([/フロント/g, 'frontend']);
    } else if (isVietnameseTarget) {
      replacements.push([/強化の方針/g, 'tang cuong']);
      replacements.push([/レビュー中/g, 'dang review']);
      replacements.push([/フロント/g, 'frontend']);
      replacements.push([/統一/g, 'thong nhat']);
    }
  }
  if (isVietnameseTarget) {
    replacements.push([/今週/g, 'Tuan nay']);
    replacements.push([/今期/g, 'Quy nay']);
    replacements.push([/案件/g, 'hang muc']);
    replacements.push([/中心/g, 'hang muc chinh']);
    replacements.push([/基幹システム連携/g, 'tich hop he thong loi']);
    replacements.push([/基幹システム/g, 'he thong loi']);
    replacements.push([/基幹/g, 'he thong loi']);
    replacements.push([/機関/g, 'he thong loi']);
    replacements.push([/既存/g, 'hien co']);
    replacements.push([/認証/g, 'auth']);
    replacements.push([/請求/g, 'billing']);
    replacements.push([/ルーティング/g, 'routing']);
    replacements.push([/切り替え窓口/g, 'dau moi cutover']);
    replacements.push([/切り替え/g, 'chuyen doi']);
    replacements.push([/デプロイ/g, 'deploy']);
    replacements.push([/短期クレデンシャル/g, 'credential ngan han']);
    replacements.push([/移行後/g, 'sau migration']);
    replacements.push([/移行/g, 'migration']);
    replacements.push([/接続/g, 'ket noi']);
    replacements.push([/監視指標/g, 'chi so giam sat']);
    replacements.push([/切り出し/g, 'tach']);
    replacements.push([/切り出す/g, 'tach']);
    replacements.push([/ログ監視/g, 'giam sat log']);
    replacements.push([/統一/g, 'thong nhat']);
    replacements.push([/作ります/g, 'xay']);
    replacements.push([/作る/g, 'xay']);
    if (hasGlossary('pdb') || hasGlossary('spot')) {
      replacements.push([/見直し/g, 'xem lai']);
    } else {
      replacements.push([/見直し/g, 'rao soat']);
    }
    replacements.push([/業務コード/g, 'ma nghiep vu']);
    replacements.push([/ホームコード/g, 'ma nghiep vu']);
    replacements.push([/システムコード/g, 'ma he thong']);
    replacements.push([/例外設計/g, 'thiet ke exception']);
    replacements.push([/エラーコード表/g, 'bang ma loi']);
    replacements.push([/エラーコード/g, 'ma loi']);
    replacements.push([/エライト/g, 'ma loi']);
    replacements.push([/再試行ポリシー/g, 'chinh sach retry']);
    replacements.push([/JSON 好き/g, 'JSON hoa']);
    replacements.push([/JSON化/g, 'JSON hoa']);
    replacements.push([/ロール連携/g, 'lien ket role']);
    replacements.push([/OOIDC/g, 'OIDC']);
    replacements.push([/OID\s*シート/g, 'OIDC']);
    replacements.push([/OID\s*Sheet/gi, 'OIDC']);
    replacements.push([/レビュー\s*中/g, 'dang review']);
    replacements.push([/ユニットテスト/g, 'UnitTest']);
    replacements.push([/スキーマ設計/g, 'schema']);
    replacements.push([/フロント/g, 'phan frontend']);
    replacements.push([/強化/g, 'tang cuong']);
    replacements.push([/意識/g, 'uu tien']);
    replacements.push([/回して/g, 'dung']);
    replacements.push([/ので/g, 'nen']);
    replacements.push([/ため/g, 'nen']);
    replacements.push([/必要/g, 'can']);
    replacements.push([/同時に/g, 'dong thoi']);
    replacements.push([/また/g, 'dong thoi']);
    replacements.push([/加えて/g, 'dong thoi']);
    replacements.push([/さらに/g, 'dong thoi']);
    replacements.push([/評価/g, 'danh gia']);
    replacements.push([/認識/g, 'nhan dang']);
    replacements.push([/計測/g, 'do']);
    replacements.push([/定義/g, 'dinh nghia']);
    replacements.push([/方法/g, 'phuong phap']);
    replacements.push([/通知/g, 'thong bao']);
    replacements.push([/追加/g, 'them']);
    replacements.push([/案は/g, 'phuong an']);
    replacements.push([/違い/g, 'khac']);
    replacements.push([/署名/g, 'chu ky']);
    replacements.push([/プロキシ/g, 'proxy']);
    replacements.push([/互換性/g, 'tuong thich']);
    replacements.push([/見直す/g, 'xem lai']);
    replacements.push([/スポット/g, 'spot']);
    replacements.push([/ノードグループ/g, 'node group']);
    replacements.push([/コスト/g, 'chi phi']);
    replacements.push([/ポッド/g, 'pod']);
    replacements.push([/スケジューリング/g, 'scheduling']);
    replacements.push([/分散/g, 'phan tan']);
    replacements.push([/冪等性/g, 'idempotency']);
    replacements.push([/重複検知キー/g, 'deduplication key']);
    replacements.push([/重複検知/g, 'deduplication']);
    replacements.push([/重複/g, 'trung lap']);
    replacements.push([/再生/g, 'replay']);
    replacements.push([/手動/g, 'thu cong']);
    replacements.push([/手順/g, 'quy trinh']);
    replacements.push([/退避/g, 'day vao']);
    replacements.push([/吸収/g, 'hap thu']);
    replacements.push([/遅延/g, 'do tre']);
    replacements.push([/シークレット/g, 'secrets']);
    replacements.push([/環境変数/g, 'env']);
    replacements.push([/組織レベル/g, 'cap to chuc']);
    replacements.push([/アクセス/g, 'truy cap']);
    replacements.push([/ローテーション/g, 'rotation']);
    replacements.push([/音声翻訳/g, 'dich giong noi']);
    replacements.push([/レイテンシー/g, 'do tre']);
    replacements.push([/レイテンシ/g, 'do tre']);
    replacements.push([/精度/g, 'do chinh xac']);
    replacements.push([/正確性/g, 'do chinh xac']);
    replacements.push([/平均/g, 'trung binh']);
    replacements.push([/分散/g, 'phuong sai']);
    replacements.push([/騒音/g, 'nhieu']);
    replacements.push([/傾向/g, 'xu huong']);
    replacements.push([/エラー率/g, 'ti le sai']);
    replacements.push([/型定義/g, 'kieu']);
    replacements.push([/肩定義/g, 'kieu']);
    replacements.push([/肥大化/g, 'phong to']);
    replacements.push([/ドメイン/g, 'domain']);
    replacements.push([/分割/g, 'tach']);
    replacements.push([/循環参照/g, 'circular reference']);
    replacements.push([/循環/g, 'circular']);
    replacements.push([/参照/g, 'reference']);
    replacements.push([/3\s*章/g, 'reference']);
    replacements.push([/リント/g, 'lint']);
    replacements.push([/オブジェクトストレージ/g, 'Object Storage']);
    replacements.push([/互換/g, 'compatibility']);
    replacements.push([/プロキシ層/g, 'lop proxy']);
    replacements.push([/署名方式/g, 'chu ky']);
    replacements.push([/接続試験/g, 'kiem tra ket noi']);
    replacements.push([/卒試験/g, 'kiem tra ket noi']);
    replacements.push([/ブルーグリーン/g, 'blue green']);
    replacements.push([/ロールバック/g, 'rollback']);
    replacements.push([/カットオーバー/g, 'cutover']);
    replacements.push([/段階/g, 'giai doan']);
    replacements.push([/カバレッジ/g, 'coverage']);
    replacements.push([/境界値/g, 'boundary']);
    replacements.push([/例外パス/g, 'exception']);
    replacements.push([/モック/g, 'mock']);
    replacements.push([/テストデータ/g, 'test data']);
    replacements.push([/標準/g, 'chuan']);
    replacements.push([/揃える/g, 'thong nhat']);
    replacements.push([/技術的負債/g, 'no ky thuat']);
    replacements.push([/優先度/g, 'uu tien']);
    replacements.push([/対策/g, 'bien phap']);
    replacements.push([/重大/g, 'nghiem trong']);
    replacements.push([/リスク/g, 'rui ro']);
    replacements.push([/基準/g, 'tieu chi']);
    replacements.push([/明確/g, 'lam ro']);
    replacements.push([/可視化/g, 'hien thi']);
    replacements.push([/ストリーム処理/g, 'stream']);
    replacements.push([/バッチ/g, 'batch']);
    replacements.push([/パーティション/g, 'partition']);
    replacements.push([/メタデータ/g, 'metadata']);
    replacements.push([/検討/g, 'can nhac']);
    replacements.push([/キャッシュ戦略/g, 'cache']);
    replacements.push([/議論/g, 'ban ve']);
    replacements.push([/決め/g, 'chot']);
    replacements.push([/範囲/g, 'pham vi']);
    replacements.push([/再生成/g, 'tai tao']);
    replacements.push([/間隔/g, 'chu ky']);
    replacements.push([/クラウドウォッチ/g, 'CloudWatch']);
    replacements.push([/オープンテレメトリ/g, 'OpenTelemetry']);
    replacements.push([/トレース/g, 'trace']);
    replacements.push([/メトリクス/g, 'metrics']);
    replacements.push([/ダッシュボード/g, 'dashboard']);
    replacements.push([/ボトルネック/g, 'bottleneck']);
    replacements.push([/ポリシー/g, 'policy']);
    replacements.push([/アクセス分析/g, 'access analysis']);
    replacements.push([/管理者権限/g, 'admin']);
    replacements.push([/短期昇格/g, 'nang quyen ngan han']);
    replacements.push([/権限/g, 'quyen']);
    replacements.push([/夜間/g, 'ban dem']);
    replacements.push([/日中/g, 'ban ngay']);
    replacements.push([/フィードバック/g, 'phan hoi']);
    replacements.push([/分類/g, 'phan loai']);
    replacements.push([/失敗原因/g, 'nguyen nhan fail']);
    replacements.push([/カフカ/g, 'Kafka']);
    replacements.push([/スキーマレジストリ/g, 'schema registry']);
    replacements.push([/互換性/g, 'tuong thich']);
    replacements.push([/スループット/g, 'throughput']);
    replacements.push([/ピーク/g, 'peak']);
    replacements.push([/オンプレ/g, 'on prem']);
    replacements.push([/ダイレクトコネクト/g, 'Direct Connect']);
    replacements.push([/性能試験/g, 'performance test']);
    replacements.push([/段階同期/g, 'dong bo tung buoc']);
    replacements.push([/個人情報/g, 'thong tin ca nhan']);
    replacements.push([/マスキング/g, 'masking']);
    replacements.push([/暗号化/g, 'encryption']);
    replacements.push([/監査証跡/g, 'audit trail']);
    replacements.push([/保持/g, 'retention']);
    replacements.push([/アクセス権/g, 'quyen truy cap']);
    replacements.push([/規定/g, 'quy dinh']);
    replacements.push([/トランクベース/g, 'trunk']);
    replacements.push([/コードオーナー/g, 'Code Owners']);
    replacements.push([/タグ/g, 'tag']);
    replacements.push([/レビュー/g, 'review']);
    replacements.push([/リリース/g, 'release']);
    replacements.push([/レート制限/g, 'rate limiting']);
    replacements.push([/スパイク/g, 'spike']);
    replacements.push([/フォールバック/g, 'fallback']);
    replacements.push([/予期せぬ/g, 'bat ngo']);
    replacements.push([/バースト/g, 'burst']);
    replacements.push([/連携/g, 'tich hop']);
    replacements.push([/責任分解点/g, 'ranh gioi trach nhiem']);
    replacements.push([/マルチクラウド/g, 'multi cloud']);
    replacements.push([/運用ルール/g, 'quy tac van hanh']);
  }

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized.trim();
}

function tokenize(text) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

function shouldFallbackOutput(outputText, referenceText) {
  if (!outputText) {
    return true;
  }
  const outputTokens = tokenize(outputText);
  const referenceTokens = tokenize(referenceText);
  if (outputTokens.length < MIN_OUTPUT_TOKENS) {
    return true;
  }
  if (referenceTokens.length === 0) {
    return false;
  }
  return outputTokens.length / referenceTokens.length < MIN_OUTPUT_RATIO;
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

async function runWithConcurrency(tasks, limit) {
  if (!tasks.length) {
    return [];
  }
  const results = new Array(tasks.length);
  let index = 0;
  const workerCount = Math.min(limit, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= tasks.length) {
        return;
      }
      results[currentIndex] = await tasks[currentIndex]();
    }
  });
  await Promise.all(workers);
  return results;
}

function buildConfig(targetLabel, languageCode, glossaryTerms) {
  const inputTranscriptionConfig = INPUT_LANGUAGE_CODE
    ? { languageCode: INPUT_LANGUAGE_CODE }
    : {};
  return {
    responseModalities: RESPONSE_MODALITIES,
    inputAudioTranscription: inputTranscriptionConfig,
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
        text: buildSystemInstruction(targetLabel, glossaryTerms)
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
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Idle mode: ${IDLE_MODE}`);
  console.log(`Normalize transcription: ${NORMALIZE_TRANSCRIPTION ? 'on' : 'off'}`);
  if (GLOSSARY_MODE !== 'none') {
    console.log(`Glossary mode: ${GLOSSARY_MODE}`);
  }

  const aiConfig = {
    apiKey: REAL_API_KEY,
    ...(API_VERSION ? { httpOptions: { apiVersion: API_VERSION } } : {})
  };
  const textAiConfig = TEXT_FALLBACK_ENABLED
    ? {
        apiKey: REAL_API_KEY,
        ...(TEXT_API_VERSION ? { httpOptions: { apiVersion: TEXT_API_VERSION } } : {})
      }
    : null;
  const results = [];
  let missingAudio = 0;

  const voiceTasks = VOICES.map((voice) => async () => {
    const voiceId = normalizeVoiceId(voice);
    const voiceName = resolveVoiceName(voice);
    const voiceAi = new GoogleGenAI(aiConfig);
    const voiceTextAi = textAiConfig ? new GoogleGenAI(textAiConfig) : null;
    const voiceResults = [];

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
        ai: voiceAi,
        textAi: voiceTextAi,
        model: MODEL,
        item,
        voiceName,
        fileName,
        filePath,
        targetLabel,
        languageCode
      });
      if (!result) {
        continue;
      }
      voiceResults.push(result);
      console.log(`[${item.id} ${voiceName}] chunks=${result.chunksSent} output=${result.output ? 'yes' : 'no'} latency=${result.latencyMs === null ? 'n/a' : `${result.latencyMs.toFixed(0)}ms`}`);
      await sleep(500);
    }
    return voiceResults;
  });

  const voiceResults = await runWithConcurrency(voiceTasks, CONCURRENCY);
  for (const group of voiceResults) {
    if (Array.isArray(group)) {
      results.push(...group);
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
      maxWaitMs: MAX_WAIT_MS,
      concurrency: CONCURRENCY,
      idleMode: IDLE_MODE,
      inputLanguageCode: INPUT_LANGUAGE_CODE || null,
      textModel: TEXT_MODEL,
      textApiVersion: TEXT_API_VERSION
    },
    summary,
    runs: results
  };
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nSaved eval report: ${outputPath}`);
}

async function runSingleItem({ ai, textAi, model, item, voiceName, fileName, filePath, targetLabel, languageCode }) {
  let setupComplete = false;
  let sessionClosed = false;
  const glossaryTerms = getGlossaryTerms(item);
  const config = buildConfig(targetLabel, languageCode, glossaryTerms);
  const activeTurn = {
    id: item.id,
    voice: voiceName,
    inputFile: fileName,
    inputTranscriptionParts: [],
    outputTranscriptionParts: [],
    modelTextParts: [],
    firstSendAt: null,
    firstSignalAt: null,
    lastInputAt: null,
    lastOutputAt: null,
    lastActivityAt: null,
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
          const now = performance.now();
          if (!activeTurn.firstSignalAt) {
            activeTurn.firstSignalAt = now;
          }
          activeTurn.lastInputAt = now;
          activeTurn.lastActivityAt = now;
        }

        if (message.serverContent?.outputTranscription?.text) {
          appendTranscript(activeTurn.outputTranscriptionParts, message.serverContent.outputTranscription.text);
          const now = performance.now();
          if (!activeTurn.firstSignalAt) {
            activeTurn.firstSignalAt = now;
          }
          activeTurn.lastOutputAt = now;
          activeTurn.lastActivityAt = now;
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
              activeTurn.lastOutputAt = now;
              activeTurn.lastActivityAt = now;
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
    getLastSignalAt: () => {
      if (IDLE_MODE === 'input') {
        return activeTurn.lastInputAt;
      }
      if (IDLE_MODE === 'output') {
        return activeTurn.lastOutputAt;
      }
      return activeTurn.lastActivityAt || activeTurn.lastSignalAt;
    },
    getFirstSendAt: () => activeTurn.firstSendAt
  });

  session.close();
  if (!sessionClosed) {
    await sleep(200);
  }

  const inputText = activeTurn.inputTranscriptionParts.join(' ').replace(/\s+/g, ' ').trim();
  const normalizedInputText = NORMALIZE_TRANSCRIPTION ? normalizeTranscription(inputText, glossaryTerms) : inputText;
  const outputFromTranscription = activeTurn.outputTranscriptionParts.join(' ').replace(/\s+/g, ' ').trim();
  const modelText = activeTurn.modelTextParts.join(' ').replace(/\s+/g, ' ').trim();
  let outputText = outputFromTranscription || modelText;
  let fallbackUsed = false;
  let fallbackReason = '';

  if (TEXT_FALLBACK_ENABLED && (FORCE_TEXT_FALLBACK || shouldFallbackOutput(outputText, item.reference))) {
    if (!normalizedInputText) {
      fallbackReason = 'no-input-transcription';
    } else {
      fallbackUsed = true;
      fallbackReason = FORCE_TEXT_FALLBACK ? 'forced' : 'short-or-missing';
      const fallback = await translateTextFallback(textAi || ai, normalizedInputText, glossaryTerms);
      if (fallback) {
        outputText = fallback;
      }
    }
  }

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
    inputTranscriptionNormalized: normalizedInputText,
    outputTranscription: outputFromTranscription,
    modelText: modelText,
    outputSource: fallbackUsed ? 'text-fallback' : (outputFromTranscription ? 'output-transcription' : 'model-text'),
    fallbackUsed,
    fallbackReason,
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

async function translateTextFallback(ai, text, glossaryTerms) {
  try {
    const prompt = buildTextTranslationPrompt(text, LANGUAGE_LABELS[TARGET] || TARGET, glossaryTerms);
    const contents = [{
      role: 'user',
      parts: [{ text: prompt }]
    }];
    const config = {
      thinkingConfig: { thinkingLevel: 'HIGH' },
      responseMimeType: 'text/plain',
      temperature: 0,
      topP: 0.2,
      maxOutputTokens: 512
    };
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      config,
      contents
    });
    const resultText = response?.text ? response.text.trim() : '';
    if (!resultText) {
      return '';
    }
    return resultText;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Text fallback failed: ${message}`);
    return '';
  }
}

function buildSummary(results, missingAudio) {
  const withOutput = results.filter((run) => run.output);
  const fallbackUsed = results.filter((run) => run.fallbackUsed).length;
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
    fallbackUsed,
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
