import { debugWarn } from '../debug-utils';
import { buildPeerTranslationSystemPrompt, languagePromptManager } from './manager';

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
    'vietnamese-japanese': 'D?ch am thanh ti?ng Vi?t ??u vao sang ti?ng Nh?t. Ch? d?ch.',
    'vietnamese-english': 'D?ch am thanh ti?ng Vi?t ??u vao sang ti?ng Anh. Ch? d?ch.'
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
  return buildPeerTranslationSystemPrompt(languagePromptManager, fromLanguage, toLanguage);
}
