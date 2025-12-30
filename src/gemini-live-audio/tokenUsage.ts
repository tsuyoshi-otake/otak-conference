import { debugLog } from '../debug-utils';
import type { GeminiLiveAudioState } from './state';

// Gemini 2.5 Flash Native Audio pricing (per 1M tokens) - Updated December 2024
const PRICING = {
  INPUT_AUDIO_PER_SECOND: 0.000003, // $3.00 per 1M tokens, ~1 token per second of audio
  OUTPUT_AUDIO_PER_SECOND: 0.000012, // $12.00 per 1M tokens, ~1 token per second of audio
  INPUT_TEXT_PER_TOKEN: 0.0000005, // $0.50 per 1M tokens (text)
  OUTPUT_TEXT_PER_TOKEN: 0.000002 // $2.00 per 1M tokens (text, including thinking tokens)
};

const calculateAudioTokens = (audioLengthSeconds: number): number => {
  // Approximate: 1 token per second of audio for Gemini Live Audio
  return Math.ceil(audioLengthSeconds);
};

const calculateTextTokens = (text: string): number => {
  // Approximate: 1 token per 4 characters for Japanese/English mixed text
  return Math.ceil(text.length / 4);
};

export const updateTokenUsage = (
  state: GeminiLiveAudioState,
  inputAudioSeconds: number = 0,
  outputAudioSeconds: number = 0,
  outputText: string = ''
): void => {
  const inputTokens = calculateAudioTokens(inputAudioSeconds);
  const outputAudioTokens = calculateAudioTokens(outputAudioSeconds);
  const outputTextTokens = calculateTextTokens(outputText);
  const totalOutputTokens = outputAudioTokens + outputTextTokens;

  // Calculate costs
  const inputCost = inputTokens * PRICING.INPUT_AUDIO_PER_SECOND;
  const outputAudioCost = outputAudioTokens * PRICING.OUTPUT_AUDIO_PER_SECOND;
  const outputTextCost = outputTextTokens * PRICING.OUTPUT_TEXT_PER_TOKEN;
  const totalCost = inputCost + outputAudioCost + outputTextCost;

  // Update session totals
  state.sessionInputTokens += inputTokens;
  state.sessionOutputTokens += totalOutputTokens;
  state.sessionCost += totalCost;

  // CPU最適化：ログ出力頻度を削減
  state.logCounter += 1;
  if (state.logCounter >= state.logInterval) {
    state.logCounter = 0;
    debugLog(`[Gemini Live Audio] Token usage - Input: ${inputTokens}, Output: ${totalOutputTokens}, Cost: $${totalCost.toFixed(6)}`);
    debugLog(`[Gemini Live Audio] Session total - Input: ${state.sessionInputTokens}, Output: ${state.sessionOutputTokens}, Cost: $${state.sessionCost.toFixed(6)}`);
  }

  // Notify callback
  state.config.onTokenUsage?.({
    inputTokens: state.sessionInputTokens,
    outputTokens: state.sessionOutputTokens,
    cost: state.sessionCost
  });
};
