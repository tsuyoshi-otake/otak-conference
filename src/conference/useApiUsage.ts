import { TokenUsage } from '../types';
import type { ConferenceState } from './useConferenceState';

type ApiUsageParams = Pick<ConferenceState, 'setApiUsageStats'>;

const calculateTokenCost = (
  inputTokens: { text: number; audio: number },
  outputTokens: { text: number; audio: number }
): number => {
  const INPUT_COST_TEXT = 0.50 / 1000000;
  const INPUT_COST_AUDIO = 3.00 / 1000000;
  const OUTPUT_COST_TEXT = 2.00 / 1000000;
  const OUTPUT_COST_AUDIO = 12.00 / 1000000;

  return (
    inputTokens.text * INPUT_COST_TEXT +
    inputTokens.audio * INPUT_COST_AUDIO +
    outputTokens.text * OUTPUT_COST_TEXT +
    outputTokens.audio * OUTPUT_COST_AUDIO
  );
};

export const useApiUsage = ({ setApiUsageStats }: ApiUsageParams) => {
  const updateApiUsage = (inputTokens: { text: number; audio: number }, outputTokens: { text: number; audio: number }) => {
    const cost = calculateTokenCost(inputTokens, outputTokens);

    setApiUsageStats(prev => {
      const newSessionUsage = {
        inputTokens: {
          text: prev.sessionUsage.inputTokens.text + inputTokens.text,
          audio: prev.sessionUsage.inputTokens.audio + inputTokens.audio
        },
        outputTokens: {
          text: prev.sessionUsage.outputTokens.text + outputTokens.text,
          audio: prev.sessionUsage.outputTokens.audio + outputTokens.audio
        },
        totalCost: prev.sessionUsage.totalCost + cost
      };

      const newTotalUsage = {
        inputTokens: {
          text: prev.totalUsage.inputTokens.text + inputTokens.text,
          audio: prev.totalUsage.inputTokens.audio + inputTokens.audio
        },
        outputTokens: {
          text: prev.totalUsage.outputTokens.text + outputTokens.text,
          audio: prev.totalUsage.outputTokens.audio + outputTokens.audio
        },
        totalCost: prev.totalUsage.totalCost + cost
      };

      localStorage.setItem('geminiApiUsage', JSON.stringify(newTotalUsage));

      return {
        sessionUsage: newSessionUsage,
        totalUsage: newTotalUsage,
        sessionCount: prev.sessionCount
      };
    });
  };

  const resetSessionUsage = () => {
    setApiUsageStats(prev => ({
      ...prev,
      sessionUsage: {
        inputTokens: { text: 0, audio: 0 },
        outputTokens: { text: 0, audio: 0 },
        totalCost: 0
      }
    }));
  };

  return { updateApiUsage, resetSessionUsage };
};

export type ApiUsageUpdater = ReturnType<typeof useApiUsage>;

export const createTokenUsageSnapshot = (): TokenUsage => ({
  inputTokens: { text: 0, audio: 0 },
  outputTokens: { text: 0, audio: 0 },
  totalCost: 0
});
