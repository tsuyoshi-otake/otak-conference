import { GoogleGenAI } from '@google/genai';
import { debugLog, debugWarn, debugError } from './debug-utils';

export interface RetranslationResult {
  retranslatedText: string;
  success: boolean;
  error?: string;
}

/**
 * Separate text re-translation service using Gemini Flash
 * This service is completely independent from Gemini Live Audio
 */
export class TextRetranslationService {
  private ai: GoogleGenAI;
  private apiKey: string;
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.ai = new GoogleGenAI({
      apiKey: apiKey,
    });
  }
  
  /**
   * Re-translate text back to speaker's language for confirmation
   * This does NOT interfere with the main translation pipeline
   */
  async retranslateToSpeakerLanguage(
    translatedText: string, 
    fromLanguage: string, // The language the text is currently in (target language)
    toLanguage: string    // Speaker's original language
  ): Promise<RetranslationResult> {
    return this.executeTranslation(translatedText, fromLanguage, toLanguage, 'Text Retranslation');
  }

  /**
   * Translate text from one language to another (fallback path)
   */
  async translateText(
    text: string,
    fromLanguage: string,
    toLanguage: string
  ): Promise<RetranslationResult> {
    return this.executeTranslation(text, fromLanguage, toLanguage, 'Text Translation');
  }

  private async executeTranslation(
    text: string,
    fromLanguage: string,
    toLanguage: string,
    logLabel: string
  ): Promise<RetranslationResult> {
    try {
      debugLog(`[${logLabel}] Translating from ${fromLanguage} to ${toLanguage}: "${text.substring(0, 50)}..."`);
      
      // Skip if same language
      if (fromLanguage === toLanguage) {
        return {
          retranslatedText: text,
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
      
      // Create simple, direct translation prompt
      const prompt = this.createTranslationPrompt(text, fromLanguage, toLanguage);
      
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
      
      debugLog(`[${logLabel}] Result: "${result.substring(0, 50)}..."`);
      
      return {
        retranslatedText: result.trim(),
        success: true
      };
      
    } catch (error) {
      debugError(`[${logLabel}] Error:`, error);
      
      return {
        retranslatedText: text, // Return original on error
        success: false,
        error: error instanceof Error ? error.message : 'Translation failed'
      };
    }
  }
  
  /**
   * Create a simple translation prompt
   */
  private createTranslationPrompt(text: string, fromLanguage: string, toLanguage: string): string {
    const languageNames = this.getLanguageNames(fromLanguage, toLanguage);
    
    return `Translate the following text from ${languageNames.from} to ${languageNames.to}. Preserve acronyms and product names exactly (e.g., GitHub Actions, CI/CD, CI, E2E, audit log, Step Functions, UnitTest). Output only the translated text, nothing else.

Text: ${text}`;
  }
  
  /**
   * Get human-readable language names
   */
  private getLanguageNames(fromLanguage: string, toLanguage: string): { from: string; to: string } {
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
      from: languageMap[fromLanguage] || fromLanguage,
      to: languageMap[toLanguage] || toLanguage
    };
  }
}

// Singleton instance management
let retranslationServiceInstance: TextRetranslationService | null = null;

/**
 * Get or create a text retranslation service instance
 */
export function getTextRetranslationService(apiKey: string): TextRetranslationService {
  if (!retranslationServiceInstance || retranslationServiceInstance['apiKey'] !== apiKey) {
    retranslationServiceInstance = new TextRetranslationService(apiKey);
  }
  return retranslationServiceInstance;
}
