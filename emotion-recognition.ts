import { GoogleGenAI } from '@google/genai';

export interface EmotionResult {
  emotion: string;
  confidence: number;
  description: string;
  timestamp: number;
}

export class EmotionRecognition {
  private genAI: GoogleGenAI;
  private isAnalyzing: boolean = false;
  private lastAnalysisTime: number = 0;
  private analysisInterval: number = 3000; // 3秒間隔で分析

  constructor(apiKey: string) {
    this.genAI = new GoogleGenAI({
      apiKey: apiKey,
    });
  }

  // カメラから画像をキャプチャして感情を分析
  async analyzeEmotion(videoElement: HTMLVideoElement): Promise<EmotionResult | null> {
    if (this.isAnalyzing || Date.now() - this.lastAnalysisTime < this.analysisInterval) {
      return null;
    }

    this.isAnalyzing = true;
    this.lastAnalysisTime = Date.now();

    try {
      // ビデオからキャンバスに画像をキャプチャ
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        throw new Error('Canvas context not available');
      }

      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0);

      // 画像をbase64に変換
      const imageData = canvas.toDataURL('image/jpeg', 0.8);
      const base64Data = imageData.split(',')[1];

      // Gemini APIで感情分析
      const prompt = `
この画像の人物の感情を分析してください。以下の形式でJSONレスポンスを返してください：

{
  "emotion": "主要な感情（happy, sad, angry, surprised, neutral, fearful, disgusted）",
  "confidence": 0.0-1.0の信頼度,
  "description": "感情の詳細な説明（日本語）"
}

顔が検出されない場合は、emotion: "no_face", confidence: 0, description: "顔が検出されませんでした" を返してください。
`;

      // Configure the request with JSON schema
      const config = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            emotion: { type: 'string' },
            confidence: { type: 'number' },
            description: { type: 'string' },
          },
          required: ['emotion', 'confidence', 'description'],
        },
      };

      // Prepare the contents
      const contents = [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data,
              },
            },
          ],
        },
      ];

      // Generate the content stream
      const response = await this.genAI.models.generateContentStream({
        model: 'gemini-2.5-flash-preview-05-20',
        config,
        contents,
      });

      // Process the response
      let responseText = '';
      for await (const chunk of response) {
        responseText += chunk.text;
      }

      // Parse the JSON response
      const emotionData = JSON.parse(responseText);
      
      return {
        emotion: emotionData.emotion,
        confidence: emotionData.confidence,
        description: emotionData.description,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error('Error analyzing emotion:', error);
      return null;
    } finally {
      this.isAnalyzing = false;
    }
  }

  // 感情に基づいた色を取得
  getEmotionColor(emotion: string): string {
    const emotionColors: Record<string, string> = {
      happy: '#10B981', // green
      sad: '#3B82F6', // blue
      angry: '#EF4444', // red
      surprised: '#F59E0B', // amber
      neutral: '#6B7280', // gray
      fearful: '#8B5CF6', // purple
      disgusted: '#84CC16', // lime
      no_face: '#374151' // dark gray
    };
    
    return emotionColors[emotion] || '#6B7280';
  }

  // 感情に基づいた絵文字を取得
  getEmotionEmoji(emotion: string): string {
    const emotionEmojis: Record<string, string> = {
      happy: '😊',
      sad: '😢',
      angry: '😠',
      surprised: '😲',
      neutral: '😐',
      fearful: '😨',
      disgusted: '🤢',
      no_face: '❓'
    };
    
    return emotionEmojis[emotion] || '❓';
  }

  // 分析間隔を設定
  setAnalysisInterval(interval: number) {
    this.analysisInterval = interval;
  }
}