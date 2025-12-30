import { languagePromptManager } from './manager';

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
