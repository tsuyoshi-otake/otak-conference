import { GoogleGenAI, Session } from '@google/genai';
import type { GeminiLiveAudioConfig } from './types';

export type GeminiLiveAudioState = {
  session: Session | null;
  ai: GoogleGenAI;
  config: GeminiLiveAudioConfig;
  inputAudioContext: AudioContext | null;
  outputAudioContext: AudioContext | null;
  inputSampleRate: number;
  targetSampleRate: number;
  silenceGateThreshold: number;
  silenceGateHoldMs: number;
  silenceFlushSeconds: number;
  silenceFlushCooldownMs: number;
  hasSentSilenceFlush: boolean;
  lastSilenceFlushTime: number;
  inputTargetRms: number;
  inputMinGain: number;
  inputMaxGain: number;
  inputGainEpsilon: number;
  lastNonSilentTime: number;
  mediaStream: MediaStream | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  scriptProcessor: ScriptProcessorNode | null;
  inputNode: GainNode | null;
  outputNode: GainNode | null;
  nextStartTime: number;
  sources: Set<AudioBufferSourceNode>;
  isProcessing: boolean;
  sessionConnected: boolean;
  sessionReady: boolean;
  sessionReadyPromise: Promise<boolean> | null;
  sessionReadyResolver: ((ready: boolean) => void) | null;
  audioBuffer: Float32Array[];
  lastSendTime: number;
  sendInterval: number;
  maxBufferSize: number;
  speechDetected: boolean;
  silenceThreshold: number;
  lastSpeechTime: number;
  vadHistory: boolean[];
  energyHistory: number[];
  adaptiveInterval: number;
  speechPredicted: boolean;
  energyTrend: number;
  predictiveBuffer: Float32Array[];
  isPreemptiveSendEnabled: boolean;
  vadSkipCounter: number;
  vadSkipThreshold: number;
  audioWorker: Worker | null;
  workerRequestId: number;
  pendingRequests: Map<number, (result: any) => void>;
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionCost: number;
  logCounter: number;
  logInterval: number;
  lastInfoAudioSendTime: number;
  lastInfoAudioReceiveTime: number;
  lastInfoAudioChunkTime: number;
  infoLogIntervalMs: number;
  debugInterval: ReturnType<typeof setInterval> | null;
  inputFrameCount: number;
  lastInputFrameTime: number;
  lastInputFrameSize: number;
  lastInputSendTime: number;
  lastInputRms: number;
  lastInputSamples: number;
  lastInputSeconds: number;
  lastOutputTextTime: number;
  lastOutputAudioTime: number;
  lastSessionMessageTime: number;
  sessionOpenTime: number;
  sentAudioChunks: number;
  skippedSilentChunks: number;
  receivedAudioChunks: number;
  receivedTextChunks: number;
  lastSilenceLogTime: number;
  lastDebugSnapshotKey: string | null;
  lastDebugSnapshotTime: number;
  debugSnapshotMinIntervalMs: number;
  localPlaybackEnabled: boolean;
  audioChunks: string[];
  isCollectingAudio: boolean;
  audioMimeType: string | undefined;
  textBuffer: string[];
  lastTextTime: number;
  textBufferTimeout: NodeJS.Timeout | null;
  textBufferDelay: number;
};

const DEFAULT_SEND_INTERVAL = 80;
const DEFAULT_TEXT_BUFFER_DELAY = 2000;

export const createGeminiLiveAudioState = (config: GeminiLiveAudioConfig): GeminiLiveAudioState => {
  return {
    session: null,
    ai: new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: { apiVersion: 'v1alpha' }
    }),
    config,
    inputAudioContext: null,
    outputAudioContext: null,
    inputSampleRate: 16000,
    targetSampleRate: 16000,
    silenceGateThreshold: 0.0015,
    silenceGateHoldMs: 1000,
    silenceFlushSeconds: 0.6,
    silenceFlushCooldownMs: 1500,
    hasSentSilenceFlush: false,
    lastSilenceFlushTime: 0,
    inputTargetRms: 0.09,
    inputMinGain: 0.6,
    inputMaxGain: 2.2,
    inputGainEpsilon: 0.02,
    lastNonSilentTime: 0,
    mediaStream: null,
    sourceNode: null,
    scriptProcessor: null,
    inputNode: null,
    outputNode: null,
    nextStartTime: 0,
    sources: new Set<AudioBufferSourceNode>(),
    isProcessing: false,
    sessionConnected: false,
    sessionReady: false,
    sessionReadyPromise: null,
    sessionReadyResolver: null,
    audioBuffer: [],
    lastSendTime: 0,
    sendInterval: config.sendInterval ?? DEFAULT_SEND_INTERVAL,
    maxBufferSize: 10,
    speechDetected: false,
    silenceThreshold: 0.01,
    lastSpeechTime: 0,
    vadHistory: [],
    energyHistory: [],
    adaptiveInterval: DEFAULT_SEND_INTERVAL,
    speechPredicted: false,
    energyTrend: 0,
    predictiveBuffer: [],
    isPreemptiveSendEnabled: true,
    vadSkipCounter: 0,
    vadSkipThreshold: 3,
    audioWorker: null,
    workerRequestId: 0,
    pendingRequests: new Map<number, (result: any) => void>(),
    sessionInputTokens: 0,
    sessionOutputTokens: 0,
    sessionCost: 0,
    logCounter: 0,
    logInterval: 30,
    lastInfoAudioSendTime: 0,
    lastInfoAudioReceiveTime: 0,
    lastInfoAudioChunkTime: 0,
    infoLogIntervalMs: 5000,
    debugInterval: null,
    inputFrameCount: 0,
    lastInputFrameTime: 0,
    lastInputFrameSize: 0,
    lastInputSendTime: 0,
    lastInputRms: 0,
    lastInputSamples: 0,
    lastInputSeconds: 0,
    lastOutputTextTime: 0,
    lastOutputAudioTime: 0,
    lastSessionMessageTime: 0,
    sessionOpenTime: 0,
    sentAudioChunks: 0,
    skippedSilentChunks: 0,
    receivedAudioChunks: 0,
    receivedTextChunks: 0,
    lastSilenceLogTime: 0,
    lastDebugSnapshotKey: null,
    lastDebugSnapshotTime: 0,
    debugSnapshotMinIntervalMs: 30000,
    localPlaybackEnabled: config.localPlaybackEnabled ?? true,
    audioChunks: [],
    isCollectingAudio: false,
    audioMimeType: undefined,
    textBuffer: [],
    lastTextTime: 0,
    textBufferTimeout: null,
    textBufferDelay: config.textBufferDelay ?? DEFAULT_TEXT_BUFFER_DELAY
  };
};
