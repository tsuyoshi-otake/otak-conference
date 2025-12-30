import { TRANSLATION_PROMPTS } from './prompts';
import type { LanguagePromptConfig } from './types';

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

  /**
   * Create comprehensive peer-to-peer translation system prompt
   */
  createPeerTranslationPrompt(fromLanguage: string, toLanguage: string): string {
    return buildPeerTranslationSystemPrompt(this, fromLanguage, toLanguage);
  }
}

export const buildPeerTranslationSystemPrompt = (
  manager: LanguagePromptManager,
  fromLanguage: string,
  toLanguage: string
): string => {
  const fromConfig = manager.getLanguageConfig(fromLanguage);
  const toConfig = manager.getLanguageConfig(toLanguage);

  // Debug output to track language configuration issues
  console.log(`?? [Translation Debug] Creating prompt: ${fromLanguage} → ${toLanguage}`);
  console.log(`?? From Config:`, { name: fromConfig.nativeName, code: fromConfig.code });
  console.log(`?? To Config:`, { name: toConfig.nativeName, code: toConfig.code });

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
};

// Export singleton instance
export const languagePromptManager = LanguagePromptManager.getInstance();
