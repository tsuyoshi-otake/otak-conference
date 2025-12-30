import { debugLog } from '../debug-utils';
import { sendAudioStreamEnd, sendTrailingSilence } from './audioSend';
import { startStream, stopStream, updateOtherParticipantLanguages, updateTargetLanguage } from './lifecycle';
import type { GeminiLiveAudioConfig } from './types';
import { createGeminiLiveAudioState } from './state';
import { initializeWorker } from './worker';

export class GeminiLiveAudioStream {
  private state: ReturnType<typeof createGeminiLiveAudioState>;

  constructor(config: GeminiLiveAudioConfig) {
    this.state = createGeminiLiveAudioState(config);
    // Initialize Web Worker for parallel processing
    initializeWorker(this.state);
  }

  updateOtherParticipantLanguages(languages: string[]): void {
    updateOtherParticipantLanguages(this.state, languages);
  }

  async start(mediaStream: MediaStream): Promise<void> {
    await startStream(this.state, mediaStream);
  }

  async stop(): Promise<void> {
    await stopStream(this.state);
  }

  async updateTargetLanguage(newTargetLanguage: string): Promise<void> {
    await updateTargetLanguage(this.state, newTargetLanguage);
  }

  public setLocalPlaybackEnabled(enabled: boolean): void {
    this.state.localPlaybackEnabled = enabled;
    debugLog(`[Gemini Live Audio] Local playback ${enabled ? 'enabled' : 'disabled'}`);
  }

  public getLocalPlaybackEnabled(): boolean {
    return this.state.localPlaybackEnabled;
  }

  isActive(): boolean {
    return this.state.session !== null && this.state.sessionReady && this.state.isProcessing;
  }

  /**
   * Check if session is ready for operations (more lenient than isActive)
   */
  isSessionReady(): boolean {
    return this.state.session !== null && this.state.sessionReady;
  }

  public sendTrailingSilence(seconds: number = 1): void {
    sendTrailingSilence(this.state, seconds);
  }

  public sendAudioStreamEnd(): void {
    sendAudioStreamEnd(this.state);
  }

  /**
   * Get current target language
   */
  getCurrentTargetLanguage(): string {
    return this.state.config.targetLanguage;
  }

  /**
   * Update speed settings dynamically
   */
  updateSpeedSettings(sendInterval?: number, textBufferDelay?: number): void {
    if (sendInterval !== undefined && sendInterval > 0) {
      this.state.sendInterval = sendInterval;
      debugLog(`[Gemini Live Audio] Updated send interval to ${sendInterval}ms`);
    }
    if (textBufferDelay !== undefined && textBufferDelay > 0) {
      this.state.textBufferDelay = textBufferDelay;
      debugLog(`[Gemini Live Audio] Updated text buffer delay to ${textBufferDelay}ms`);
    }
  }

  /**
   * Get current speed settings
   */
  getSpeedSettings(): { sendInterval: number; textBufferDelay: number } {
    return {
      sendInterval: this.state.sendInterval,
      textBufferDelay: this.state.textBufferDelay
    };
  }
}
