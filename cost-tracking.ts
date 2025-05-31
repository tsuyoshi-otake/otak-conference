import { logWithTimestamp } from './log-utils';

// Cost tracking types
export interface CostTrackingStats {
  requestCount: number;
  totalCost: number;
  inputTokens: {
    text: number;
    audio: number;
  };
  outputTokens: {
    text: number;
    audio: number;
  };
  lastUpdated: number;
}

export interface UsageMetrics {
  inputTokens?: {
    text?: number;
    audio?: number;
  };
  outputTokens?: {
    text?: number;
    audio?: number;
  };
  cost?: number;
}

// Pricing configuration (per 1K tokens) - Based on Gemini 2.5 Flash pricing
const PRICING = {
  INPUT_TEXT: 0.15,        // $0.15 per 1K tokens
  INPUT_AUDIO: 0.25,       // $0.25 per 1K tokens
  OUTPUT_TEXT: 0.60,       // $0.60 per 1K tokens
  OUTPUT_AUDIO: 2.00,      // $2.00 per 1K tokens
};

const STORAGE_KEY = 'otak-conference-cost-tracking';

export class CostTrackingManager {
  private stats: CostTrackingStats;

  constructor() {
    this.stats = this.loadFromStorage();
  }

  /**
   * Load cost tracking data from localStorage
   */
  private loadFromStorage(): CostTrackingStats {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate the structure
        if (this.isValidStats(parsed)) {
          logWithTimestamp('[Cost Tracking] Loaded existing data from localStorage');
          return parsed;
        } else {
          logWithTimestamp('[Cost Tracking] Invalid stored data, initializing fresh');
        }
      }
    } catch (error) {
      logWithTimestamp('[Cost Tracking] Error loading from localStorage:', error);
    }

    // Return default stats if no valid data found
    return this.getDefaultStats();
  }

  /**
   * Validate stats structure
   */
  private isValidStats(stats: any): stats is CostTrackingStats {
    return (
      typeof stats === 'object' &&
      typeof stats.requestCount === 'number' &&
      typeof stats.totalCost === 'number' &&
      typeof stats.inputTokens === 'object' &&
      typeof stats.inputTokens.text === 'number' &&
      typeof stats.inputTokens.audio === 'number' &&
      typeof stats.outputTokens === 'object' &&
      typeof stats.outputTokens.text === 'number' &&
      typeof stats.outputTokens.audio === 'number' &&
      typeof stats.lastUpdated === 'number'
    );
  }

  /**
   * Get default stats structure
   */
  private getDefaultStats(): CostTrackingStats {
    return {
      requestCount: 0,
      totalCost: 0,
      inputTokens: { text: 0, audio: 0 },
      outputTokens: { text: 0, audio: 0 },
      lastUpdated: Date.now()
    };
  }

  /**
   * Save stats to localStorage
   */
  private saveToStorage(): void {
    try {
      this.stats.lastUpdated = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stats));
      logWithTimestamp('[Cost Tracking] Saved to localStorage');
    } catch (error) {
      logWithTimestamp('[Cost Tracking] Error saving to localStorage:', error);
      throw new Error(`Failed to save cost tracking data: ${error}`);
    }
  }

  /**
   * Calculate cost from token usage
   */
  private calculateCost(
    inputTextTokens: number,
    inputAudioTokens: number,
    outputTextTokens: number,
    outputAudioTokens: number
  ): number {
    const inputTextCost = (inputTextTokens / 1000) * PRICING.INPUT_TEXT;
    const inputAudioCost = (inputAudioTokens / 1000) * PRICING.INPUT_AUDIO;
    const outputTextCost = (outputTextTokens / 1000) * PRICING.OUTPUT_TEXT;
    const outputAudioCost = (outputAudioTokens / 1000) * PRICING.OUTPUT_AUDIO;

    return inputTextCost + inputAudioCost + outputTextCost + outputAudioCost;
  }

  /**
   * Add API request usage
   */
  public addUsage(metrics: UsageMetrics): void {
    try {
      // Increment request count
      this.stats.requestCount++;

      // Add token counts
      if (metrics.inputTokens) {
        this.stats.inputTokens.text += metrics.inputTokens.text || 0;
        this.stats.inputTokens.audio += metrics.inputTokens.audio || 0;
      }

      if (metrics.outputTokens) {
        this.stats.outputTokens.text += metrics.outputTokens.text || 0;
        this.stats.outputTokens.audio += metrics.outputTokens.audio || 0;
      }

      // Calculate and add cost
      let additionalCost = 0;
      if (metrics.cost !== undefined) {
        additionalCost = metrics.cost;
      } else {
        // Calculate cost from tokens
        additionalCost = this.calculateCost(
          metrics.inputTokens?.text || 0,
          metrics.inputTokens?.audio || 0,
          metrics.outputTokens?.text || 0,
          metrics.outputTokens?.audio || 0
        );
      }

      this.stats.totalCost += additionalCost;

      // Ensure precision
      this.stats.totalCost = Math.round(this.stats.totalCost * 100) / 100;

      // Save to storage
      this.saveToStorage();

      logWithTimestamp(
        `[Cost Tracking] Updated: Request #${this.stats.requestCount}, Cost: $${additionalCost.toFixed(4)}, Total: $${this.stats.totalCost.toFixed(2)}`
      );
    } catch (error) {
      logWithTimestamp('[Cost Tracking] Error adding usage:', error);
      throw error;
    }
  }

  /**
   * Get current stats
   */
  public getStats(): CostTrackingStats {
    return { ...this.stats };
  }

  /**
   * Get formatted request count
   */
  public getRequestCount(): number {
    return this.stats.requestCount;
  }

  /**
   * Get formatted total cost
   */
  public getTotalCost(): string {
    return this.stats.totalCost.toFixed(2);
  }

  /**
   * Reset all tracking data
   */
  public reset(): void {
    try {
      this.stats = this.getDefaultStats();
      this.saveToStorage();
      logWithTimestamp('[Cost Tracking] Data reset');
    } catch (error) {
      logWithTimestamp('[Cost Tracking] Error resetting data:', error);
      throw error;
    }
  }

  /**
   * Clear localStorage data
   */
  public clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      this.stats = this.getDefaultStats();
      logWithTimestamp('[Cost Tracking] Storage cleared');
    } catch (error) {
      logWithTimestamp('[Cost Tracking] Error clearing storage:', error);
      throw error;
    }
  }

  /**
   * Get detailed usage breakdown
   */
  public getUsageBreakdown(): {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    avgCostPerRequest: number;
  } {
    const totalInputTokens = this.stats.inputTokens.text + this.stats.inputTokens.audio;
    const totalOutputTokens = this.stats.outputTokens.text + this.stats.outputTokens.audio;
    const totalTokens = totalInputTokens + totalOutputTokens;
    const avgCostPerRequest = this.stats.requestCount > 0 ? this.stats.totalCost / this.stats.requestCount : 0;

    return {
      totalTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      avgCostPerRequest: Math.round(avgCostPerRequest * 10000) / 10000 // 4 decimal places
    };
  }

  /**
   * Validate and repair data integrity
   */
  public validateAndRepair(): boolean {
    try {
      // Ensure non-negative values
      this.stats.requestCount = Math.max(0, Math.floor(this.stats.requestCount));
      this.stats.totalCost = Math.max(0, this.stats.totalCost);
      this.stats.inputTokens.text = Math.max(0, Math.floor(this.stats.inputTokens.text));
      this.stats.inputTokens.audio = Math.max(0, Math.floor(this.stats.inputTokens.audio));
      this.stats.outputTokens.text = Math.max(0, Math.floor(this.stats.outputTokens.text));
      this.stats.outputTokens.audio = Math.max(0, Math.floor(this.stats.outputTokens.audio));

      // Recalculate total cost from tokens to ensure accuracy
      const recalculatedCost = this.calculateCost(
        this.stats.inputTokens.text,
        this.stats.inputTokens.audio,
        this.stats.outputTokens.text,
        this.stats.outputTokens.audio
      );

      // Only update if there's a significant difference (more than 1 cent)
      if (Math.abs(this.stats.totalCost - recalculatedCost) > 0.01) {
        logWithTimestamp(
          `[Cost Tracking] Cost mismatch detected. Stored: $${this.stats.totalCost.toFixed(2)}, Calculated: $${recalculatedCost.toFixed(2)}`
        );
        this.stats.totalCost = recalculatedCost;
      }

      this.saveToStorage();
      return true;
    } catch (error) {
      logWithTimestamp('[Cost Tracking] Error during validation and repair:', error);
      return false;
    }
  }
}