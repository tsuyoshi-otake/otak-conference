import { GoogleGenAI } from '@google/genai';
import { debugLog, debugWarn, debugError } from './debug-utils';

export interface TranslationResult {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  success: boolean;
  error?: string;
}

export class GeminiTextTranslator {
  private ai: GoogleGenAI;
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({
      apiKey: apiKey,
    });
  }
  
  /**
   * Translate text from one language to another using Gemini Flash
   */
  async translateText(
    text: string, 
    sourceLanguage: string, 
    targetLanguage: string
  ): Promise<TranslationResult> {
    try {
      debugLog(`[Gemini Text] Translating from ${sourceLanguage} to ${targetLanguage}: "${text.substring(0, 50)}..."`);
      
      // Skip translation if source and target are the same
      if (sourceLanguage === targetLanguage) {
        return {
          translatedText: text,
          sourceLanguage,
          targetLanguage,
          success: true
        };
      }
      
      const model = 'gemini-2.5-flash-lite-preview-06-17';
      const config = {
        thinkingConfig: {
          thinkingBudget: 0,
        },
        responseMimeType: 'text/plain',
      };
      
      // Create translation prompt
      const prompt = this.createTranslationPrompt(text, sourceLanguage, targetLanguage);
      
      const contents = [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ];
      
      const response = await this.ai.models.generateContent({
        model,
        config,
        contents,
      });
      
      const result = response.text || '';
      
      debugLog(`[Gemini Text] Translation result: "${result.substring(0, 50)}..."`);
      
      return {
        translatedText: result.trim(),
        sourceLanguage,
        targetLanguage,
        success: true
      };
      
    } catch (error) {
      debugError('[Gemini Text] Translation error:', error);
      
      return {
        translatedText: text, // Return original text on error
        sourceLanguage,
        targetLanguage,
        success: false,
        error: error instanceof Error ? error.message : 'Translation failed'
      };
    }
  }
  
  /**
   * Create translation prompt based on language pair
   */
  private createTranslationPrompt(text: string, sourceLanguage: string, targetLanguage: string): string {
    const languageNames = this.getLanguageNames(sourceLanguage, targetLanguage);
    
    // Simple, direct translation prompt for best results
    return `Translate the following text from ${languageNames.source} to ${languageNames.target}. Output only the translated text, nothing else.

Text to translate: ${text}`;
  }
  
  /**
   * Get human-readable language names
   */
  private getLanguageNames(sourceLanguage: string, targetLanguage: string): { source: string; target: string } {
    const languageMap: Record<string, string> = {
      'english': 'English',
      'japanese': 'Japanese',
      'chinese': 'Chinese (Simplified)',
      'traditionalChinese': 'Chinese (Traditional)',
      'korean': 'Korean',
      'spanish': 'Spanish',
      'french': 'French',
      'german': 'German',
      'italian': 'Italian',
      'portuguese': 'Portuguese',
      'russian': 'Russian',
      'arabic': 'Arabic',
      'hindi': 'Hindi',
      'bengali': 'Bengali',
      'vietnamese': 'Vietnamese',
      'thai': 'Thai',
      'turkish': 'Turkish',
      'polish': 'Polish',
      'czech': 'Czech',
      'hungarian': 'Hungarian',
      'bulgarian': 'Bulgarian',
      'javanese': 'Javanese',
      'tamil': 'Tamil',
      'burmese': 'Burmese',
      'hebrew': 'Hebrew',
    };
    
    return {
      source: languageMap[sourceLanguage] || sourceLanguage,
      target: languageMap[targetLanguage] || targetLanguage
    };
  }
}

// Singleton instance management
let translatorInstance: GeminiTextTranslator | null = null;

/**
 * Get or create a Gemini text translator instance
 */
export function getGeminiTextTranslator(apiKey: string): GeminiTextTranslator {
  if (!translatorInstance || translatorInstance['apiKey'] !== apiKey) {
    translatorInstance = new GeminiTextTranslator(apiKey);
  }
  return translatorInstance;
}