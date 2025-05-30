export class GoogleGenAI {
  constructor(config: any) {}
  
  models = {
    generateContent: jest.fn().mockResolvedValue({
      text: JSON.stringify({
        original: 'Test original text',
        translation: 'Test translated text'
      })
    })
  };

  getGenerativeModel() {
    return {
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => 'Mocked translation'
        }
      }),
      startChat: jest.fn().mockReturnValue({
        sendMessage: jest.fn().mockResolvedValue({
          response: {
            text: () => 'Mocked chat response'
          }
        })
      })
    };
  }

  live = {
    connect: jest.fn().mockResolvedValue({
      sendClientContent: jest.fn(),
      close: jest.fn()
    })
  };
}

export const HarmCategory = {
  HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
  HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT'
};

export const HarmBlockThreshold = {
  BLOCK_NONE: 'BLOCK_NONE'
};

export enum Modality {
  AUDIO = 'AUDIO',
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO'
}

export enum MediaResolution {
  MEDIA_RESOLUTION_LOW = 'MEDIA_RESOLUTION_LOW',
  MEDIA_RESOLUTION_MEDIUM = 'MEDIA_RESOLUTION_MEDIUM',
  MEDIA_RESOLUTION_HIGH = 'MEDIA_RESOLUTION_HIGH'
}

export interface LiveServerMessage {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        fileData?: {
          fileUri?: string;
        };
      }>;
    };
    turnComplete?: boolean;
  };
}

export interface LiveClientMessage {
  realtimeInput?: {
    mediaChunks?: Array<{
      mimeType: string;
      data: string;
    }>;
  };
}

export interface Session {
  sendClientContent: (params: any) => void;
  close: () => void;
}