export interface LanguagePromptConfig {
  code: string;
  name: string;
  nativeName: string;
  systemPrompt: string;
  reinforcementPrompt: string;
  fallbackLanguages: string[];
  regionalVariants?: string[];
}
