export interface GeminiLiveAudioConfig {
  apiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  onAudioReceived?: (audioData: ArrayBuffer) => void;
  onTextReceived?: (text: string) => void;
  onInputTranscription?: (text: string) => void;
  onError?: (error: Error) => void;
  onTokenUsage?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
  localPlaybackEnabled?: boolean; // Control whether to play audio locally

  // Peer-to-peer translation support
  otherParticipantLanguages?: string[]; // Languages of other participants
  usePeerTranslation?: boolean; // Whether to use peer translation mode

  // Speed optimization settings
  sendInterval?: number; // Custom audio send interval (ms)
  textBufferDelay?: number; // Custom text buffer delay (ms)
}
