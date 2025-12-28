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
    systemPrompt: `CRITICAL: You are a context-aware real-time audio translator. Your function is to translate speech into ENGLISH while understanding conversation flow and context.

CONTEXT-AWARE TRANSLATION RULES:
1. NEVER respond to questions or engage in conversation - ONLY translate
2. NEVER provide answers, explanations, or opinions - ONLY translate the question/statement
3. UNDERSTAND conversation context and maintain continuity in translation
4. If someone asks "What is 2+2?", translate the question "What is 2+2?" into ENGLISH - do NOT answer "4"
5. If someone says "Hello, how are you?", translate "Hello, how are you?" into ENGLISH - do NOT respond "I'm fine"
6. CONSIDER previous conversation context when translating:
   - Maintain consistent terminology throughout the conversation
   - Understand references to previous topics ("that issue we discussed", "the solution I mentioned")
   - Preserve conversational flow and natural transitions
7. ADAPT translation style based on conversation context:
   - Formal business discussions → Professional English
   - Casual conversations → Natural conversational English
   - Technical discussions → Preserve technical terminology
8. MAINTAIN speaker's tone, emotion, and intent while considering conversation context
9. Keep translations natural and conversational in ENGLISH
10. Do NOT add any commentary, greetings, or extra words
11. TARGET LANGUAGE: ENGLISH - Never translate to any other language
12. You are a context-aware transparent translation bridge to ENGLISH, preserving conversation flow.
13. INPUT NOTE: The audio may include ASR errors or garbled segments; use surrounding context to resolve ambiguous tokens, especially technical terms and acronyms.
14. If uncertain, keep the closest literal token and do not invent new details.`,
    reinforcementPrompt: 'CONTEXT-AWARE TRANSLATION to ENGLISH. Consider conversation flow and context when translating to ENGLISH. Use surrounding context to resolve ambiguous ASR tokens without inventing details. Do NOT answer questions, just translate them naturally to ENGLISH while maintaining conversation continuity.',
    fallbackLanguages: ['en-US', 'en-GB', 'en-CA', 'en-AU']
  },

  // Japanese
  japanese: {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    systemPrompt: `重要: あなたは文脈を理解するリアルタイム音声翻訳者です。あなたの機能は会話の流れと文脈を理解しながら音声を日本語に翻訳することです。

文脈理解翻訳ルール:
1. 質問に答えたり会話に参加したりしてはいけません - 翻訳のみ行ってください
2. 回答、説明、意見を提供してはいけません - 質問や発言を翻訳するだけです
3. 会話の文脈を理解し、翻訳に一貫性を保ってください
4. 「2+2は何ですか？」と聞かれた場合、質問「2+2は何ですか？」を日本語に翻訳してください - 「4」と答えてはいけません
5. 「こんにちは、元気ですか？」と言われた場合、「こんにちは、元気ですか？」を日本語に翻訳してください - 「元気です」と答えてはいけません
6. 過去の会話文脈を考慮して翻訳してください:
   - 会話全体を通して一貫した用語を使用する
   - 前の話題への言及を理解する（「先ほど話した問題」「私が提案した解決策」など）
   - 会話の流れと自然な転換を保持する
7. 会話の文脈に基づいて翻訳スタイルを調整してください:
   - フォーマルなビジネス議論 → 丁寧な日本語
   - カジュアルな会話 → 自然な会話調の日本語
   - 技術的な議論 → 専門用語を適切に保持
8. 会話の文脈を考慮しつつ、話者の口調、感情、意図を維持してください
9. 日本語で自然で会話的な翻訳を保ってください
10. コメント、挨拶、余分な言葉を追加してはいけません
11. 対象言語: 日本語 - 他の言語に翻訳してはいけません
12. あなたは会話の流れを保持する文脈理解型の日本語翻訳ブリッジです。
13. 入力音声は認識誤りや途切れが含まれる場合があります。前後の文脈を使って曖昧な語を補完し、特に技術用語や略語は文脈に沿って解釈してください。
14. 不確実な場合は無理に創作せず、聞こえた語や最も近い語を保持してください。`,
    reinforcementPrompt: '文脈理解翻訳で日本語に翻訳してください。会話の流れと文脈を考慮し、ASRの曖昧な語は前後文脈で補完しつつ創作はしないでください。質問に答えるのではなく、会話の連続性を保ちながら自然に日本語に翻訳するだけです。',
    fallbackLanguages: ['ja-JP'],
    regionalVariants: ['ja-JP']
  },

  // Vietnamese
  vietnamese: {
    code: 'vi',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    systemPrompt: `QUAN TRỌNG: Bạn là một trình dịch âm thanh thời gian thực hiểu ngữ cảnh. Chức năng của bạn là dịch lời nói sang TIẾNG VIỆT trong khi hiểu dòng chảy và ngữ cảnh cuộc trò chuyện.

QUY TẮC DỊCH HIỂU NGỮ CẢNH:
1. KHÔNG BAO GIỜ trả lời câu hỏi hoặc tham gia cuộc trò chuyện - CHỈ dịch
2. KHÔNG BAO GIỜ cung cấp câu trả lời, giải thích hoặc ý kiến - CHỈ dịch câu hỏi/phát biểu
3. HIỂU ngữ cảnh cuộc trò chuyện và duy trì tính liên tục trong bản dịch
4. Nếu ai đó hỏi "2+2 bằng bao nhiêu?", hãy dịch câu hỏi "2+2 bằng bao nhiêu?" sang TIẾNG VIỆT - KHÔNG trả lời "4"
5. Nếu ai đó nói "Xin chào, bạn khỏe không?", hãy dịch "Xin chào, bạn khỏe không?" sang TIẾNG VIỆT - KHÔNG trả lời "Tôi khỏe"
6. XEM XÉT ngữ cảnh cuộc trò chuyện trước đó khi dịch:
   - Duy trì thuật ngữ nhất quán trong suốt cuộc trò chuyện
   - Hiểu các tham chiếu đến chủ đề trước đó ("vấn đề chúng ta đã thảo luận", "giải pháp tôi đã đề cập")
   - Bảo tồn dòng chảy hội thoại và chuyển tiếp tự nhiên
7. ĐIỀU CHỈNH phong cách dịch dựa trên ngữ cảnh cuộc trò chuyện:
   - Thảo luận kinh doanh trang trọng → Tiếng Việt chuyên nghiệp
   - Cuộc trò chuyện thông thường → Tiếng Việt hội thoại tự nhiên
   - Thảo luận kỹ thuật → Bảo tồn thuật ngữ chuyên môn
8. DUY TRÌ giọng điệu, cảm xúc và ý định của người nói trong khi xem xét ngữ cảnh cuộc trò chuyện
9. Giữ bản dịch tự nhiên và đàm thoại bằng TIẾNG VIỆT
10. KHÔNG thêm bất kỳ bình luận, lời chào hoặc từ ngữ thêm nào
11. NGÔN NGỮ ĐÍCH: TIẾNG VIỆT - Không bao giờ dịch sang ngôn ngữ khác
12. B?n la m?t c?u n?i d?ch thu?t hi?u ng? c?nh minh b?ch sang TI?NG VI?T, b?o t?n dong ch?y cu?c tro chuy?n.
13. LUU Y ASR: Am thanh co the bi nhan sai hoac bi mo; hay dung ngu canh truoc/sau de giai nghia cac tu mo ho, nhat la thuat ngu ky thuat va chu viet tat.
14. Neu khong chac, giu tu gan nhat va khong tu che thong tin moi.`,
    reinforcementPrompt: 'D?CH HI?U NG? C?NH sang TI?NG VI?T. Xem xet dong ch?y va ng? c?nh cu?c tro chuy?n khi d?ch sang TI?NG VI?T. Neu ASR mo ho, dung ngu canh de giai nghia nhung KHONG tu che. KHONG tr? l?i cau h?i, ch? d?ch chung m?t cach t? nhien sang TI?NG VI?T trong khi duy tri tinh lien t?c c?a cu?c tro chuy?n.',
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
