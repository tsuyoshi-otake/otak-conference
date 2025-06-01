// Comprehensive multilingual system prompts for translation accuracy
// Ensures proper language detection and translation based on participant settings

import { debugWarn } from './debug-utils';

export interface LanguagePromptConfig {
  code: string;
  name: string;
  nativeName: string;
  systemPrompt: string;
  reinforcementPrompt: string;
  fallbackLanguages: string[];
  regionalVariants?: string[];
}

// Language-specific system prompts for the 3 supported languages
export const TRANSLATION_PROMPTS: Record<string, LanguagePromptConfig> = {
  // English
  english: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    systemPrompt: `CRITICAL: You are ONLY a real-time audio translator. Your SOLE function is to translate speech into ENGLISH.

STRICT TRANSLATION RULES:
1. NEVER respond to questions or engage in conversation
2. NEVER provide answers, explanations, or opinions  
3. ONLY translate the exact words spoken into ENGLISH
4. If someone asks "What is 2+2?", translate the question "What is 2+2?" into ENGLISH - do NOT answer "4"
5. If someone says "Hello, how are you?", translate "Hello, how are you?" into ENGLISH - do NOT respond "I'm fine"
6. Maintain the speaker's tone, emotion, and intent in translation
7. Keep translations natural and conversational in ENGLISH
8. Do NOT add any commentary, greetings, or extra words
9. TARGET LANGUAGE: ENGLISH - Never translate to any other language
10. You are a transparent translation bridge to ENGLISH, nothing more.`,
    reinforcementPrompt: 'TRANSLATE ONLY to ENGLISH. Convert the following audio to ENGLISH. Do NOT answer questions, just translate them to ENGLISH.',
    fallbackLanguages: ['en-US', 'en-GB', 'en-CA', 'en-AU']
  },

  // Japanese
  japanese: {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    systemPrompt: `重要: あなたは日本語専用のリアルタイム音声翻訳者です。あなたの唯一の機能は音声を日本語に翻訳することです。

厳格な翻訳ルール:
1. 質問に答えたり会話に参加したりしてはいけません
2. 回答、説明、意見を提供してはいけません
3. 話された言葉を正確に日本語に翻訳するだけです
4. 「2+2は何ですか？」と聞かれた場合、質問「2+2は何ですか？」を日本語に翻訳してください - 「4」と答えてはいけません
5. 「こんにちは、元気ですか？」と言われた場合、「こんにちは、元気ですか？」を日本語に翻訳してください - 「元気です」と答えてはいけません
6. 話者の口調、感情、意図を日本語翻訳で維持してください
7. 日本語で自然で会話的な翻訳を保ってください
8. コメント、挨拶、余分な言葉を追加してはいけません
9. 対象言語: 日本語 - 他の言語に翻訳してはいけません
10. あなたは日本語への透明な翻訳ブリッジです、それ以上でもそれ以下でもありません。`,
    reinforcementPrompt: '日本語のみに翻訳してください。以下の音声を日本語に変換してください。質問に答えるのではなく、日本語に翻訳するだけです。',
    fallbackLanguages: ['ja-JP'],
    regionalVariants: ['ja-JP']
  },

  // Vietnamese
  vietnamese: {
    code: 'vi',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    systemPrompt: `QUAN TRỌNG: Bạn CHỈ là một trình dịch âm thanh thời gian thực. Chức năng DUY NHẤT của bạn là dịch lời nói sang TIẾNG VIỆT.

QUY TẮC DỊCH NGHIÊM NGẶT:
1. KHÔNG BAO GIỜ trả lời câu hỏi hoặc tham gia cuộc trò chuyện
2. KHÔNG BAO GIỜ cung cấp câu trả lời, giải thích hoặc ý kiến
3. CHỈ dịch những từ được nói chính xác sang TIẾNG VIỆT
4. Nếu ai đó hỏi "2+2 bằng bao nhiêu?", hãy dịch câu hỏi "2+2 bằng bao nhiêu?" sang TIẾNG VIỆT - KHÔNG trả lời "4"
5. Nếu ai đó nói "Xin chào, bạn khỏe không?", hãy dịch "Xin chào, bạn khỏe không?" sang TIẾNG VIỆT - KHÔNG trả lời "Tôi khỏe"
6. Duy trì giọng điệu, cảm xúc và ý định của người nói trong bản dịch TIẾNG VIỆT
7. Giữ bản dịch tự nhiên và đàm thoại bằng TIẾNG VIỆT
8. KHÔNG thêm bất kỳ bình luận, lời chào hoặc từ ngữ thêm nào
9. NGÔN NGỮ ĐÍCH: TIẾNG VIỆT - Không bao giờ dịch sang ngôn ngữ khác
10. Bạn là một cầu nối dịch thuật minh bạch sang TIẾNG VIỆT, không gì khác.`,
    reinforcementPrompt: 'CHỈ DỊCH sang TIẾNG VIỆT. Chuyển đổi âm thanh sau đây sang TIẾNG VIỆT. KHÔNG trả lời câu hỏi, chỉ dịch chúng sang TIẾNG VIỆT.',
    fallbackLanguages: ['vi-VN'],
    regionalVariants: ['vi-VN']
  }
};

// Language detection and fallback system
export class LanguagePromptManager {
  private static instance: LanguagePromptManager;
  
  static getInstance(): LanguagePromptManager {
    if (!LanguagePromptManager.instance) {
      LanguagePromptManager.instance = new LanguagePromptManager();
    }
    return LanguagePromptManager.instance;
  }

  /**
   * Get system prompt for a specific language with fallback support
   */
  getSystemPrompt(languageCode: string): string {
    // Direct match
    const directMatch = TRANSLATION_PROMPTS[languageCode];
    if (directMatch) {
      return directMatch.systemPrompt;
    }

    // Try to find by language code
    const byCode = Object.values(TRANSLATION_PROMPTS).find(
      lang => lang.code === languageCode || lang.fallbackLanguages.includes(languageCode)
    );
    if (byCode) {
      return byCode.systemPrompt;
    }

    // Try regional variants
    const baseLanguage = languageCode.split('-')[0];
    const byBaseLanguage = Object.values(TRANSLATION_PROMPTS).find(
      lang => lang.code.startsWith(baseLanguage) ||
              lang.fallbackLanguages.some(fallback => fallback.startsWith(baseLanguage))
    );
    if (byBaseLanguage) {
      return byBaseLanguage.systemPrompt;
    }

    // Default to English if no match found
    console.warn(`[Translation Prompts] No prompt found for language: ${languageCode}, defaulting to English`);
    return TRANSLATION_PROMPTS.english.systemPrompt;
  }

  /**
   * Get reinforcement prompt for a specific language
   */
  getReinforcementPrompt(languageCode: string): string {
    const config = this.getLanguageConfig(languageCode);
    return config.reinforcementPrompt;
  }

  /**
   * Get complete language configuration
   */
  getLanguageConfig(languageCode: string): LanguagePromptConfig {
    // Direct match (case-insensitive)
    const lowerLanguageCode = languageCode.toLowerCase();
    const directMatch = TRANSLATION_PROMPTS[lowerLanguageCode];
    if (directMatch) {
      return directMatch;
    }

    // Try to find by language name (case-insensitive)
    const byName = Object.values(TRANSLATION_PROMPTS).find(
      lang => lang.name.toLowerCase() === lowerLanguageCode || 
              lang.nativeName.toLowerCase() === lowerLanguageCode
    );
    if (byName) {
      return byName;
    }

    // Try to find by language code
    const byCode = Object.values(TRANSLATION_PROMPTS).find(
      lang => lang.code === languageCode || lang.fallbackLanguages.includes(languageCode)
    );
    if (byCode) {
      return byCode;
    }

    // Try regional variants
    const baseLanguage = languageCode.split('-')[0];
    const byBaseLanguage = Object.values(TRANSLATION_PROMPTS).find(
      lang => lang.code.startsWith(baseLanguage) ||
              lang.fallbackLanguages.some(fallback => fallback.startsWith(baseLanguage))
    );
    if (byBaseLanguage) {
      return byBaseLanguage;
    }

    // Default to English
    return TRANSLATION_PROMPTS.english;
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages(): string[] {
    return Object.keys(TRANSLATION_PROMPTS);
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(languageCode: string): boolean {
    return this.getLanguageConfig(languageCode) !== TRANSLATION_PROMPTS.english ||
           languageCode === 'english' || languageCode === 'en';
  }

  /**
   * Get language name in native script
   */
  getNativeName(languageCode: string): string {
    const config = this.getLanguageConfig(languageCode);
    return config.nativeName;
  }

  /**
   * Create dynamic system prompt based on participant languages
   */
  createMultiParticipantPrompt(sourceLanguage: string, targetLanguages: string[]): string {
    const sourceConfig = this.getLanguageConfig(sourceLanguage);
    const primaryTarget = targetLanguages[0] || 'english';
    const targetConfig = this.getLanguageConfig(primaryTarget);

    return `CRITICAL MULTI-PARTICIPANT TRANSLATION SYSTEM:

SOURCE LANGUAGE: ${sourceConfig.nativeName} (${sourceConfig.code})
PRIMARY TARGET: ${targetConfig.nativeName} (${targetConfig.code})
ADDITIONAL TARGETS: ${targetLanguages.slice(1).map(lang => this.getNativeName(lang)).join(', ')}

ABSOLUTE RULES:
1. You are ONLY a translator - NEVER answer questions or provide information
2. ONLY translate speech from ${sourceConfig.nativeName} to ${targetConfig.nativeName}
3. If someone asks "What is 2+2?" translate the QUESTION to ${targetConfig.nativeName} - do NOT answer "4"
4. If someone says "Hello, how are you?" translate the GREETING to ${targetConfig.nativeName} - do NOT respond "I'm fine"
5. Maintain speaker's tone, emotion, and intent in ${targetConfig.nativeName}
6. Keep translations natural and conversational in ${targetConfig.nativeName}
7. NEVER add commentary, greetings, or extra words
8. You are a transparent translation bridge to ${targetConfig.nativeName}, nothing more

PARTICIPANT LANGUAGE DETECTION:
- Detect configured language preferences automatically
- Translate to each participant's configured target language
- Never default to English unless explicitly configured
- Respect regional language variants

CONSISTENCY REQUIREMENTS:
- Maintain translation accuracy across all participants
- Handle multiple target languages simultaneously
- Preserve context in multi-participant conversations
- Apply language-specific cultural adaptations`;
  }
}

// Export singleton instance
export const languagePromptManager = LanguagePromptManager.getInstance();

// Utility functions for language mapping
export function mapLanguageCodeToPrompt(languageCode: string): string {
  return languagePromptManager.getSystemPrompt(languageCode);
}

export function getLanguageSpecificPrompt(sourceLanguage: string, targetLanguage: string): string {
  const manager = languagePromptManager;
  const sourceConfig = manager.getLanguageConfig(sourceLanguage);
  const targetConfig = manager.getLanguageConfig(targetLanguage);
  
  return `TRANSLATION BRIDGE: ${sourceConfig.nativeName} → ${targetConfig.nativeName}

${targetConfig.systemPrompt}

SPECIFIC CONTEXT:
- Source: ${sourceConfig.nativeName} (${sourceConfig.code})
- Target: ${targetConfig.nativeName} (${targetConfig.code})
- Mode: Real-time audio translation only
- Behavior: Transparent translation bridge`;
}

/**
 * Generate translation prompt for peer-to-peer translation
 * Each participant translates their own speech to their peer's language
 */
export function generatePeerTranslationPrompt(fromLanguage: string, toLanguage: string): string {
  const translationPrompts: Record<string, string> = {
    // Japanese to other languages
    'japanese-english': '入力された日本語音声を英語に翻訳してください。翻訳のみ行ってください。',
    'japanese-vietnamese': '入力された日本語音声をベトナム語に翻訳してください。翻訳のみ行ってください。',

    // English to other languages
    'english-japanese': 'Translate input English audio to Japanese. Only translate.',
    'english-vietnamese': 'Translate input English audio to Vietnamese. Only translate.',

    // Vietnamese to other languages
    'vietnamese-japanese': 'Dịch âm thanh tiếng Việt đầu vào sang tiếng Nhật. Chỉ dịch.',
    'vietnamese-english': 'Dịch âm thanh tiếng Việt đầu vào sang tiếng Anh. Chỉ dịch.'
  };

  const key = `${fromLanguage}-${toLanguage}`;
  const prompt = translationPrompts[key];
  
  if (!prompt) {
    // Fallback to English-based translation
    debugWarn(`[Translation Prompts] No specific prompt found for ${key}, using fallback`);
    return `Translate input ${fromLanguage} audio to ${toLanguage}. Only translate, do not answer questions.`;
  }
  
  return prompt;
}

/**
 * Create comprehensive peer-to-peer translation system prompt
 * This includes the base translation prompt plus reinforcement rules
 */
export function createPeerTranslationSystemPrompt(fromLanguage: string, toLanguage: string): string {
  const manager = languagePromptManager;
  const fromConfig = manager.getLanguageConfig(fromLanguage);
  const toConfig = manager.getLanguageConfig(toLanguage);
  
  // Debug output to track language configuration issues
  console.log(`🔍 [Translation Debug] Creating prompt: ${fromLanguage} → ${toLanguage}`);
  console.log(`📱 From Config:`, { name: fromConfig.nativeName, code: fromConfig.code });
  console.log(`🎯 To Config:`, { name: toConfig.nativeName, code: toConfig.code });
  
  // Use the target language's system prompt as the base
  const targetLanguagePrompt = toConfig.systemPrompt;
  
  // Add specific translation context using the target language's prompt structure
  return `${targetLanguagePrompt}

SPECIFIC TRANSLATION CONTEXT:
- SOURCE LANGUAGE: ${fromConfig.nativeName} (${fromConfig.code})
- TARGET LANGUAGE: ${toConfig.nativeName} (${toConfig.code})
- MODE: Real-time audio translation only
- BEHAVIOR: Transparent translation bridge from ${fromConfig.nativeName} to ${toConfig.nativeName}

EXAMPLES:
- If input is a question in ${fromConfig.nativeName}, translate the QUESTION to ${toConfig.nativeName} - do NOT answer it
- If input is a greeting in ${fromConfig.nativeName}, translate the GREETING to ${toConfig.nativeName} - do NOT respond to it`;
}

/**
 * Update LanguagePromptManager to support peer translation
 */
declare module './translation-prompts' {
  interface LanguagePromptManager {
    createPeerTranslationPrompt(fromLanguage: string, toLanguage: string): string;
  }
}

// Add method to existing LanguagePromptManager class
LanguagePromptManager.prototype.createPeerTranslationPrompt = function(fromLanguage: string, toLanguage: string): string {
  return createPeerTranslationSystemPrompt(fromLanguage, toLanguage);
};

/**
 * Get all available language options for UI selection
 */
export function getAvailableLanguageOptions(): Array<{ value: string; label: string; nativeName: string }> {
  return [
    { value: 'english', label: 'English', nativeName: 'English' },
    { value: 'japanese', label: 'Japanese', nativeName: '日本語' },
    { value: 'vietnamese', label: 'Vietnamese', nativeName: 'Tiếng Việt' }
  ];
}

/**
 * Get language display name (native name with English label)
 */
export function getLanguageDisplayName(languageCode: string): string {
  const options = getAvailableLanguageOptions();
  const option = options.find(opt => opt.value === languageCode);
  return option ? `${option.nativeName} (${option.label})` : languageCode;
}