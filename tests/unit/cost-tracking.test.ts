// Unmock cost-tracking and log-utils for this test file
jest.unmock('../../cost-tracking');
jest.unmock('../../log-utils');

import { CostTrackingManager, CostTrackingStats, UsageMetrics } from '../../cost-tracking';

// Mock localStorage
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};
  
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('CostTrackingManager', () => {
  let manager: CostTrackingManager;

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    manager = new CostTrackingManager();
  });

  describe('Initialization', () => {
    it('should initialize with default stats when no stored data exists', () => {
      const stats = manager.getStats();
      
      expect(stats.requestCount).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.inputTokens.text).toBe(0);
      expect(stats.inputTokens.audio).toBe(0);
      expect(stats.outputTokens.text).toBe(0);
      expect(stats.outputTokens.audio).toBe(0);
      expect(stats.lastUpdated).toBeGreaterThan(0);
    });

    it('should load existing data from localStorage', () => {
      const existingData: CostTrackingStats = {
        requestCount: 5,
        totalCost: 1.25,
        inputTokens: { text: 100, audio: 50 },
        outputTokens: { text: 75, audio: 25 },
        lastUpdated: Date.now() - 1000
      };

      localStorageMock.setItem('otak-conference-cost-tracking', JSON.stringify(existingData));
      
      const newManager = new CostTrackingManager();
      const stats = newManager.getStats();
      
      expect(stats.requestCount).toBe(5);
      expect(stats.totalCost).toBe(1.25);
      expect(stats.inputTokens.text).toBe(100);
      expect(stats.inputTokens.audio).toBe(50);
    });

    it('should handle corrupted localStorage data gracefully', () => {
      localStorageMock.setItem('otak-conference-cost-tracking', 'invalid-json');
      
      const newManager = new CostTrackingManager();
      const stats = newManager.getStats();
      
      expect(stats.requestCount).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });

  describe('Adding Usage', () => {
    it('should correctly add usage metrics', () => {
      const metrics: UsageMetrics = {
        inputTokens: { text: 100, audio: 50 },
        outputTokens: { text: 75, audio: 25 }
      };

      manager.addUsage(metrics);
      const stats = manager.getStats();

      expect(stats.requestCount).toBe(1);
      expect(stats.inputTokens.text).toBe(100);
      expect(stats.inputTokens.audio).toBe(50);
      expect(stats.outputTokens.text).toBe(75);
      expect(stats.outputTokens.audio).toBe(25);
      expect(stats.totalCost).toBeGreaterThan(0);
    });

    it('should accumulate multiple usage calls', () => {
      const metrics1: UsageMetrics = {
        inputTokens: { text: 100, audio: 50 },
        outputTokens: { text: 75, audio: 25 }
      };

      const metrics2: UsageMetrics = {
        inputTokens: { text: 200, audio: 100 },
        outputTokens: { text: 150, audio: 50 }
      };

      manager.addUsage(metrics1);
      manager.addUsage(metrics2);
      
      const stats = manager.getStats();

      expect(stats.requestCount).toBe(2);
      expect(stats.inputTokens.text).toBe(300);
      expect(stats.inputTokens.audio).toBe(150);
      expect(stats.outputTokens.text).toBe(225);
      expect(stats.outputTokens.audio).toBe(75);
    });

    it('should accept direct cost values', () => {
      const metrics: UsageMetrics = {
        cost: 0.50
      };

      manager.addUsage(metrics);
      const stats = manager.getStats();

      expect(stats.requestCount).toBe(1);
      expect(stats.totalCost).toBe(0.50);
    });

    it('should save to localStorage after each addition', () => {
      const metrics: UsageMetrics = {
        inputTokens: { text: 100, audio: 50 },
        outputTokens: { text: 75, audio: 25 }
      };

      manager.addUsage(metrics);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'otak-conference-cost-tracking',
        expect.stringContaining('"requestCount":1')
      );
    });
  });

  describe('Cost Calculation', () => {
    it('should calculate costs correctly based on pricing', () => {
      const metrics: UsageMetrics = {
        inputTokens: { text: 1000, audio: 1000 },  // 1K tokens each
        outputTokens: { text: 1000, audio: 1000 }  // 1K tokens each
      };

      manager.addUsage(metrics);
      const stats = manager.getStats();

      // Expected costs per 1K tokens:
      // Input text: $0.15, Input audio: $0.25
      // Output text: $0.60, Output audio: $2.00
      // Total: $3.00
      expect(stats.totalCost).toBeCloseTo(3.00, 2);
    });

    it('should handle fractional token counts', () => {
      const metrics: UsageMetrics = {
        inputTokens: { text: 500, audio: 250 },   // 0.5K and 0.25K tokens
        outputTokens: { text: 750, audio: 125 }   // 0.75K and 0.125K tokens
      };

      manager.addUsage(metrics);
      const stats = manager.getStats();

      // Expected: (500/1000 * 0.15) + (250/1000 * 0.25) + (750/1000 * 0.60) + (125/1000 * 2.00)
      // = 0.075 + 0.0625 + 0.45 + 0.25 = 0.8375
      expect(stats.totalCost).toBeCloseTo(0.84, 2);
    });
  });

  describe('Data Management', () => {
    beforeEach(() => {
      // Add some test data
      manager.addUsage({
        inputTokens: { text: 100, audio: 50 },
        outputTokens: { text: 75, audio: 25 }
      });
    });

    it('should reset all data', () => {
      manager.reset();
      const stats = manager.getStats();

      expect(stats.requestCount).toBe(0);
      expect(stats.totalCost).toBe(0);
      expect(stats.inputTokens.text).toBe(0);
      expect(stats.inputTokens.audio).toBe(0);
      expect(stats.outputTokens.text).toBe(0);
      expect(stats.outputTokens.audio).toBe(0);
    });

    it('should clear localStorage data', () => {
      manager.clear();
      
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('otak-conference-cost-tracking');
      
      const stats = manager.getStats();
      expect(stats.requestCount).toBe(0);
      expect(stats.totalCost).toBe(0);
    });
  });

  describe('Utility Methods', () => {
    beforeEach(() => {
      manager.addUsage({
        inputTokens: { text: 1000, audio: 500 },
        outputTokens: { text: 750, audio: 250 }
      });
      manager.addUsage({
        inputTokens: { text: 500, audio: 250 },
        outputTokens: { text: 375, audio: 125 }
      });
    });

    it('should return correct request count', () => {
      expect(manager.getRequestCount()).toBe(2);
    });

    it('should return formatted total cost', () => {
      const cost = manager.getTotalCost();
      expect(cost).toMatch(/^\d+\.\d{2}$/); // Should be formatted to 2 decimal places
    });

    it('should provide usage breakdown', () => {
      const breakdown = manager.getUsageBreakdown();

      expect(breakdown.totalTokens).toBe(3750); // (1000+500+750+250) + (500+250+375+125) = 2500 + 1250
      expect(breakdown.inputTokens).toBe(2250); // (1000+500) + (500+250) = 1500 + 750
      expect(breakdown.outputTokens).toBe(1500); // (750+250) + (375+125) = 1000 + 500
      expect(breakdown.avgCostPerRequest).toBeGreaterThan(0);
    });
  });

  describe('Validation and Repair', () => {
    it('should validate and repair data integrity', () => {
      // Manually corrupt the data
      const stats = manager.getStats();
      stats.requestCount = -1;
      stats.totalCost = -0.50;
      stats.inputTokens.text = -100;

      const success = manager.validateAndRepair();

      expect(success).toBe(true);
      const repairedStats = manager.getStats();
      expect(repairedStats.requestCount).toBeGreaterThanOrEqual(0);
      expect(repairedStats.totalCost).toBeGreaterThanOrEqual(0);
      expect(repairedStats.inputTokens.text).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw error
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      expect(() => {
        manager.addUsage({
          inputTokens: { text: 100, audio: 50 },
          outputTokens: { text: 75, audio: 25 }
        });
      }).toThrow('Failed to save cost tracking data');
    });
  });
});