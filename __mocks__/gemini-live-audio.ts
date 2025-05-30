export class GeminiLiveAudioStream {
  constructor(config: any) {}
  
  async start(mediaStream: MediaStream): Promise<void> {
    return Promise.resolve();
  }
  
  async stop(): Promise<void> {
    return Promise.resolve();
  }
  
  isActive(): boolean {
    return false;
  }
}

export async function playAudioData(audioData: ArrayBuffer): Promise<void> {
  return Promise.resolve();
}

export const GEMINI_LANGUAGE_MAP: Record<string, string> = {
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