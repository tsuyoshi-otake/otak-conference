// Comprehensive multilingual system prompts for translation accuracy
// Ensures proper language detection and translation based on participant settings

export type { LanguagePromptConfig } from './types';
export { TRANSLATION_PROMPTS } from './prompts';
export {
  LanguagePromptManager,
  languagePromptManager,
  buildPeerTranslationSystemPrompt
} from './manager';
export {
  generatePeerTranslationPrompt,
  createPeerTranslationSystemPrompt
} from './peer';
export { mapLanguageCodeToPrompt, getLanguageSpecificPrompt } from './utils';
export { getAvailableLanguageOptions, getLanguageDisplayName } from './options';
