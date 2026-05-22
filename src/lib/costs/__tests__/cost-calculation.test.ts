/**
 * Cost Calculation Tests - Verify financial accuracy
 *
 * CRITICAL: These tests ensure money calculations are correct
 */

import { describe, it, expect } from 'vitest';
import { calculateCostSync, getPricingSync, TokenUsage, ModelPricing } from '../../cost.js';

describe('Cost Calculation Accuracy', () => {
  describe('Anthropic Models', () => {
    it('should calculate claude-sonnet-4 costs correctly', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');
      expect(pricing).toBeDefined();

      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 2000,
        cacheWriteTokens: 1000,
        cacheTTL: '5m'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Sonnet-4: input $3/MTok, output $15/MTok, cache read $0.30/MTok, cache write $3.75/MTok (5m)
      // (10000/1M)*3 + (5000/1M)*15 + (2000/1M)*0.30 + (1000/1M)*3.75
      // = 0.03 + 0.075 + 0.0006 + 0.00375 = 0.10935
      expect(cost).toBeCloseTo(0.10935, 6);
    });

    it('should calculate claude-opus-4 costs correctly', () => {
      const pricing = getPricingSync('anthropic', 'claude-opus-4');
      expect(pricing).toBeDefined();

      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      // Opus-4: input $15/MTok, output $75/MTok
      // (10000/1M)*15 + (5000/1M)*75 = 0.15 + 0.375 = 0.525
      expect(cost).toBeCloseTo(0.525, 6);
    });

    it('should calculate claude-haiku-4-5 costs correctly', () => {
      const pricing = getPricingSync('anthropic', 'claude-haiku-4-5');
      expect(pricing).toBeDefined();

      const usage: TokenUsage = {
        inputTokens: 100000,
        outputTokens: 50000,
        cacheReadTokens: 10000,
        cacheWriteTokens: 5000,
        cacheTTL: '5m'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Haiku-4.5: input $1/MTok, output $5/MTok, cache read $0.10/MTok, cache write $1.25/MTok (5m)
      // (100000/1M)*1 + (50000/1M)*5 + (10000/1M)*0.10 + (5000/1M)*1.25
      // = 0.1 + 0.25 + 0.001 + 0.00625 = 0.35725
      expect(cost).toBeCloseTo(0.35725, 6);
    });
  });

  describe('Cache TTL Pricing', () => {
    it('should use correct pricing for 5-minute cache', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 10000,
        cacheTTL: '5m'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Sonnet-4 5m cache write: $3.75/MTok
      // (10000/1M)*3.75 = 0.0375
      expect(cost).toBeCloseTo(0.0375, 6);
    });

    it('should use correct pricing for 1-hour cache', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 10000,
        cacheTTL: '1h'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Sonnet-4 1h cache write: $6/MTok
      // (10000/1M)*6 = 0.06
      expect(cost).toBeCloseTo(0.06, 6);
    });

    it('should default to 5-minute cache if TTL not specified', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 10000
        // No cacheTTL specified - should default to '5m'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Should use 5m pricing
      expect(cost).toBeCloseTo(0.0375, 6);
    });
  });

  describe('Long-Context Pricing', () => {
    it('should apply long-context multiplier for Sonnet-4 with >200K input tokens', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 250000,
        outputTokens: 50000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      // Long-context: input 2x ($6/MTok), output 1.5x ($22.50/MTok)
      // (250000/1M)*6 + (50000/1M)*22.50 = 1.5 + 1.125 = 2.625
      expect(cost).toBeCloseTo(2.625, 6);
    });

    it('should include cache tokens in long-context threshold calculation', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      // Total input = 150K + 40K + 20K = 210K > 200K threshold
      const usage: TokenUsage = {
        inputTokens: 150000,
        outputTokens: 50000,
        cacheReadTokens: 40000,
        cacheWriteTokens: 20000,
        cacheTTL: '5m'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Should apply long-context multiplier
      // Input: (150000/1M)*6 = 0.9
      // Output: (50000/1M)*22.50 = 1.125
      // Cache read (NOT multiplied): (40000/1M)*0.30 = 0.012
      // Cache write: (20000/1M)*3.75 = 0.075
      // Total = 0.9 + 1.125 + 0.012 + 0.075 = 2.112
      expect(cost).toBeCloseTo(2.112, 6);
    });

    it('should NOT apply long-context multiplier below 200K threshold', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 150000,
        outputTokens: 50000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      // Standard pricing: input $3/MTok, output $15/MTok
      // (150000/1M)*3 + (50000/1M)*15 = 0.45 + 0.75 = 1.2
      expect(cost).toBeCloseTo(1.2, 6);
    });

    it('should NOT apply long-context multiplier to Opus or Haiku', () => {
      const opusPricing = getPricingSync('anthropic', 'claude-opus-4');
      const haikuPricing = getPricingSync('anthropic', 'claude-haiku-4-5');

      const usage: TokenUsage = {
        inputTokens: 250000,
        outputTokens: 50000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const opusCost = calculateCostSync(usage, opusPricing!);
      const haikuCost = calculateCostSync(usage, haikuPricing!);

      // Opus: (250000/1M)*15 + (50000/1M)*75 = 3.75 + 3.75 = 7.5
      expect(opusCost).toBeCloseTo(7.5, 6);

      // Haiku: (250000/1M)*1 + (50000/1M)*5 = 0.25 + 0.25 = 0.5
      expect(haikuCost).toBeCloseTo(0.5, 6);
    });
  });

  describe('Model Name Matching', () => {
    it('should match exact model names', () => {
      expect(getPricingSync('anthropic', 'claude-sonnet-4')).toBeDefined();
      expect(getPricingSync('anthropic', 'claude-opus-4')).toBeDefined();
      expect(getPricingSync('anthropic', 'claude-haiku-4-5')).toBeDefined();
    });

    it('should match model names with date suffixes', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4-20250101');
      expect(pricing).toBeDefined();
      expect(pricing?.model).toBe('claude-sonnet-4');
    });

    it('should return null for unknown models', () => {
      expect(getPricingSync('anthropic', 'unknown-model')).toBeNull();
      expect(getPricingSync('openai', 'claude-sonnet-4')).toBeNull();
    });
  });

  describe('Floating Point Precision', () => {
    it('should round to 6 decimal places', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 333,
        outputTokens: 666,
        cacheReadTokens: 111,
        cacheWriteTokens: 222,
        cacheTTL: '5m'
      };

      const cost = calculateCostSync(usage, pricing!);

      // Cost should be rounded to 6 decimals
      expect(cost.toString().split('.')[1]?.length).toBeLessThanOrEqual(6);
    });

    it('should handle very small costs without underflow', () => {
      const pricing = getPricingSync('anthropic', 'claude-haiku-4-5');

      const usage: TokenUsage = {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeCloseTo(0.000006, 6); // $0.000001 + $0.000005
    });

    it('should handle very large costs without overflow', () => {
      const pricing = getPricingSync('anthropic', 'claude-opus-4');

      const usage: TokenUsage = {
        inputTokens: 10000000, // 10M tokens
        outputTokens: 5000000,  // 5M tokens
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      // (10M/1M)*15 + (5M/1M)*75 = 150 + 375 = 525
      expect(cost).toBeCloseTo(525, 6);
      expect(Number.isFinite(cost)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero tokens', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      expect(cost).toBe(0);
    });

    it('should handle missing cache tokens (undefined)', () => {
      const pricing = getPricingSync('anthropic', 'claude-sonnet-4');

      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500
        // No cache tokens specified
      };

      const cost = calculateCostSync(usage, pricing!);

      // Should calculate without errors
      expect(cost).toBeGreaterThan(0);
      expect(Number.isFinite(cost)).toBe(true);
    });

    it('should handle models without cache pricing', () => {
      // gpt-5.2 has no cache pricing in our table — used here to verify the
      // calculator correctly skips cache tokens when no cache rate exists.
      const pricing = getPricingSync('openai', 'gpt-5.2');
      expect(pricing).toBeDefined();

      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100,
        cacheWriteTokens: 50
      };

      const cost = calculateCostSync(usage, pricing!);

      // Should only calculate input/output, ignore cache tokens
      // (1000/1M)*1.25 + (500/1M)*10 = 0.00125 + 0.005 = 0.00625
      expect(cost).toBeCloseTo(0.00625, 6);
    });
  });

  describe('Multi-Provider Support', () => {
    it('should have pricing for OpenAI models', () => {
      expect(getPricingSync('openai', 'gpt-5.4')).toBeDefined();
      expect(getPricingSync('openai', 'gpt-5.4-mini')).toBeDefined();
      expect(getPricingSync('openai', 'o3')).toBeDefined();
    });

    it('should have pricing for Google models', () => {
      expect(getPricingSync('google', 'gemini-3.1-pro-preview')).toBeDefined();
      expect(getPricingSync('google', 'gemini-3-flash-preview')).toBeDefined();
    });

    it('should calculate OpenAI costs correctly', () => {
      const pricing = getPricingSync('openai', 'gpt-5.4');

      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      // GPT-5.4: input $2.50/MTok, output $15/MTok
      // (10000/1M)*2.5 + (5000/1M)*15 = 0.025 + 0.075 = 0.1
      expect(cost).toBeCloseTo(0.1, 6);
    });

    it('should calculate Google costs correctly', () => {
      const pricing = getPricingSync('google', 'gemini-3.1-pro-preview');

      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0
      };

      const cost = calculateCostSync(usage, pricing!);

      // Gemini 3.1 Pro: input $2/MTok, output $12/MTok
      // (10000/1M)*2 + (5000/1M)*12 = 0.02 + 0.06 = 0.08
      expect(cost).toBeCloseTo(0.08, 6);
    });
  });
});
