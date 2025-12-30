import { debugLog } from '../../debug-utils';
import type { TokenUsage } from '../../types';
import type { ConferenceState } from '../useConferenceState';

type UsageParams = Pick<ConferenceState, 'setApiUsageStats'>;

export const applyGeminiTokenUsageUpdate = (
  { setApiUsageStats }: UsageParams,
  usage: { inputTokens: number; outputTokens: number; cost: number }
) => {
  debugLog('?? [Token Usage] Update received:', {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: usage.cost
  });
  debugLog('[Conference] Token usage update:', usage);
  setApiUsageStats(prev => {
    const prevTotalUsage = prev.totalUsage || {
      inputTokens: { text: 0, audio: 0 },
      outputTokens: { text: 0, audio: 0 },
      totalCost: 0
    };

    const prevSessionUsage = prev.sessionUsage || {
      inputTokens: { text: 0, audio: 0 },
      outputTokens: { text: 0, audio: 0 },
      totalCost: 0
    };

    const newSessionUsage: TokenUsage = {
      inputTokens: {
        text: prevSessionUsage.inputTokens.text,
        audio: usage.inputTokens
      },
      outputTokens: {
        text: prevSessionUsage.outputTokens.text,
        audio: usage.outputTokens
      },
      totalCost: usage.cost
    };

    const sessionDelta = {
      inputTokens: newSessionUsage.inputTokens.audio - prevSessionUsage.inputTokens.audio,
      outputTokens: newSessionUsage.outputTokens.audio - prevSessionUsage.outputTokens.audio,
      cost: newSessionUsage.totalCost - prevSessionUsage.totalCost
    };

    const newTotalUsage: TokenUsage = {
      inputTokens: {
        text: prevTotalUsage.inputTokens.text,
        audio: prevTotalUsage.inputTokens.audio + sessionDelta.inputTokens
      },
      outputTokens: {
        text: prevTotalUsage.outputTokens.text,
        audio: prevTotalUsage.outputTokens.audio + sessionDelta.outputTokens
      },
      totalCost: prevTotalUsage.totalCost + sessionDelta.cost
    };

    debugLog('?? [Token Usage] Updated stats:', {
      sessionCost: newSessionUsage.totalCost,
      totalCost: newTotalUsage.totalCost,
      sessionDelta: sessionDelta
    });

    return {
      ...prev,
      sessionUsage: newSessionUsage,
      totalUsage: newTotalUsage
    };
  });
};
