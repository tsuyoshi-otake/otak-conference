// Mock for emotion-recognition
export class EmotionRecognition {
  constructor(apiKey: string, onTokenUsageUpdate?: (inputTokens: number, outputTokens: number) => void) {}
  
  async analyzeEmotion(imageData: string): Promise<{ emotion: string; confidence: number } | null> {
    return { emotion: 'happy', confidence: 0.9 };
  }
}