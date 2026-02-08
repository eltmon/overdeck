/**
 * Tests for cost.ts - Cost Tracking System
 */

import { describe, it, expect } from 'vitest';
import {
  calculateCost,
  getPricing,
  summarizeCosts,
  DEFAULT_PRICING,
  type TokenUsage,
  type CostEntry,
  type ModelPricing,
} from '../../src/lib/cost.js';
import { normalizeModelName } from '../../src/lib/cost-parsers/jsonl-parser.js';

describe('cost module', () => {
  describe('DEFAULT_PRICING - Pricing Accuracy', () => {
    it('should have correct pricing for claude-opus-4.5', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-opus-4.5');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.005);
      expect(pricing?.outputPer1k).toBe(0.025);
      expect(pricing?.cacheReadPer1k).toBe(0.0005);
      expect(pricing?.cacheWrite5mPer1k).toBe(0.00625);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.01);
    });

    it('should have correct pricing for claude-sonnet-4.5', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-sonnet-4.5');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.003);
      expect(pricing?.outputPer1k).toBe(0.015);
      expect(pricing?.cacheReadPer1k).toBe(0.0003);
      expect(pricing?.cacheWrite5mPer1k).toBe(0.00375);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.006);
    });

    it('should have correct pricing for claude-haiku-4.5', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-haiku-4.5');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.001);
      expect(pricing?.outputPer1k).toBe(0.005);
      expect(pricing?.cacheReadPer1k).toBe(0.0001);
      expect(pricing?.cacheWrite5mPer1k).toBe(0.00125);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.002);
    });

    it('should have correct pricing for claude-opus-4-1', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-opus-4-1');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.015);
      expect(pricing?.outputPer1k).toBe(0.075);
      expect(pricing?.cacheReadPer1k).toBe(0.0015);
      expect(pricing?.cacheWrite5mPer1k).toBe(0.01875);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.03);
    });

    it('should have correct pricing for claude-opus-4', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-opus-4');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.015);
      expect(pricing?.outputPer1k).toBe(0.075);
      expect(pricing?.cacheReadPer1k).toBe(0.0015); // Fixed from 0.00175
      expect(pricing?.cacheWrite5mPer1k).toBe(0.01875);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.03);
    });

    it('should have correct pricing for claude-sonnet-4', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-sonnet-4');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.003);
      expect(pricing?.outputPer1k).toBe(0.015);
      expect(pricing?.cacheReadPer1k).toBe(0.0003);
      expect(pricing?.cacheWrite5mPer1k).toBe(0.00375);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.006);
    });

    it('should have correct pricing for claude-haiku-3 (legacy)', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-haiku-3');
      expect(pricing).toBeDefined();
      expect(pricing?.inputPer1k).toBe(0.00025);
      expect(pricing?.outputPer1k).toBe(0.00125);
      expect(pricing?.cacheReadPer1k).toBe(0.00003);
      expect(pricing?.cacheWrite5mPer1k).toBe(0.0003);
      expect(pricing?.cacheWrite1hPer1k).toBe(0.0005);
    });

    it('should NOT have claude-haiku-3.5 (removed)', () => {
      const pricing = DEFAULT_PRICING.find(p => p.model === 'claude-haiku-3.5');
      expect(pricing).toBeUndefined();
    });

    it('should have dual cache TTL pricing for all Anthropic models', () => {
      const anthropicModels = DEFAULT_PRICING.filter(p => p.provider === 'anthropic');
      anthropicModels.forEach(model => {
        expect(model.cacheWrite5mPer1k).toBeDefined();
        expect(model.cacheWrite1hPer1k).toBeDefined();
        // Verify 1h is 2x input, 5m is 1.25x input (within rounding tolerance)
        expect(model.cacheWrite1hPer1k).toBeCloseTo(model.inputPer1k * 2, 4);
        expect(model.cacheWrite5mPer1k!).toBeCloseTo(model.inputPer1k * 1.25, 4);
      });
    });
  });

  describe('getPricing', () => {
    it('should get pricing by exact match', () => {
      const pricing = getPricing('anthropic', 'claude-sonnet-4');
      expect(pricing).toBeDefined();
      expect(pricing?.model).toBe('claude-sonnet-4');
    });

    it('should get pricing by partial match with date suffix', () => {
      const pricing = getPricing('anthropic', 'claude-sonnet-4-20250101');
      expect(pricing).toBeDefined();
      expect(pricing?.model).toBe('claude-sonnet-4');
    });

    it('should get pricing for 4.5 models with date suffix', () => {
      const pricing = getPricing('anthropic', 'claude-opus-4.5-20250929');
      expect(pricing).toBeDefined();
      expect(pricing?.model).toBe('claude-opus-4.5');
    });

    it('should fallback claude-haiku-3.5 to claude-haiku-3 via partial match', () => {
      // haiku-3.5 was removed, but getPricing does partial matching,
      // so "claude-haiku-3.5" matches "claude-haiku-3" (legacy fallback)
      const pricing = getPricing('anthropic', 'claude-haiku-3.5');
      expect(pricing).toBeDefined();
      expect(pricing?.model).toBe('claude-haiku-3');
    });

    it('should return null for unknown model', () => {
      const pricing = getPricing('anthropic', 'claude-unknown-model');
      expect(pricing).toBeNull();
    });
  });

  describe('calculateCost - Standard Calculation', () => {
    const pricing: ModelPricing = {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      inputPer1k: 0.003,
      outputPer1k: 0.015,
      cacheReadPer1k: 0.0003,
      cacheWrite5mPer1k: 0.00375,
      cacheWrite1hPer1k: 0.006,
      currency: 'USD',
    };

    it('should calculate cost for basic input/output tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
      };
      const cost = calculateCost(usage, pricing);
      // (10000/1000 * 0.003) + (5000/1000 * 0.015) = 0.03 + 0.075 = 0.105
      expect(cost).toBe(0.105);
    });

    it('should calculate cost with cache read tokens', () => {
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 20000,
      };
      const cost = calculateCost(usage, pricing);
      // 0.03 + 0.075 + (20000/1000 * 0.0003) = 0.105 + 0.006 = 0.111
      expect(cost).toBe(0.111);
    });

    it('should calculate cost with 5-minute cache write tokens (default)', () => {
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheWriteTokens: 8000,
      };
      const cost = calculateCost(usage, pricing);
      // 0.105 + (8000/1000 * 0.00375) = 0.105 + 0.03 = 0.135
      expect(cost).toBe(0.135);
    });

    it('should calculate cost with explicit 5-minute cache TTL', () => {
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheWriteTokens: 8000,
        cacheTTL: '5m',
      };
      const cost = calculateCost(usage, pricing);
      expect(cost).toBe(0.135);
    });

    it('should calculate cost with 1-hour cache TTL', () => {
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheWriteTokens: 8000,
        cacheTTL: '1h',
      };
      const cost = calculateCost(usage, pricing);
      // 0.105 + (8000/1000 * 0.006) = 0.105 + 0.048 = 0.153
      expect(cost).toBe(0.153);
    });

    it('should calculate cost with all token types', () => {
      const usage: TokenUsage = {
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 20000,
        cacheWriteTokens: 8000,
        cacheTTL: '1h',
      };
      const cost = calculateCost(usage, pricing);
      // 0.03 + 0.075 + 0.006 + 0.048 = 0.159
      expect(cost).toBe(0.159);
    });
  });

  describe('calculateCost - Long-Context Pricing', () => {
    const sonnet4Pricing: ModelPricing = {
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      inputPer1k: 0.003,
      outputPer1k: 0.015,
      currency: 'USD',
    };

    const sonnet45Pricing: ModelPricing = {
      provider: 'anthropic',
      model: 'claude-sonnet-4.5',
      inputPer1k: 0.003,
      outputPer1k: 0.015,
      currency: 'USD',
    };

    it('should NOT apply long-context pricing for <=200K tokens (sonnet-4)', () => {
      const usage: TokenUsage = {
        inputTokens: 200000,
        outputTokens: 10000,
      };
      const cost = calculateCost(usage, sonnet4Pricing);
      // (200000/1000 * 0.003) + (10000/1000 * 0.015) = 0.6 + 0.15 = 0.75
      expect(cost).toBe(0.75);
    });

    it('should apply long-context pricing for >200K tokens (sonnet-4)', () => {
      const usage: TokenUsage = {
        inputTokens: 250000,
        outputTokens: 10000,
      };
      const cost = calculateCost(usage, sonnet4Pricing);
      // (250000/1000 * 0.003 * 2) + (10000/1000 * 0.015 * 1.5)
      // = 1.5 + 0.225 = 1.725
      expect(cost).toBe(1.725);
    });

    it('should apply long-context pricing for >200K tokens (sonnet-4.5)', () => {
      const usage: TokenUsage = {
        inputTokens: 250000,
        outputTokens: 10000,
      };
      const cost = calculateCost(usage, sonnet45Pricing);
      expect(cost).toBe(1.725);
    });

    it('should include cache tokens in 200K threshold calculation', () => {
      const usage: TokenUsage = {
        inputTokens: 150000,
        outputTokens: 10000,
        cacheReadTokens: 30000,
        cacheWriteTokens: 30000,
      };
      const cost = calculateCost(usage, {
        ...sonnet4Pricing,
        cacheReadPer1k: 0.0003,
        cacheWrite5mPer1k: 0.00375,
      });
      // Total input: 150000 + 30000 + 30000 = 210000 (>200K, triggers long-context)
      // Input: 150000/1000 * 0.003 * 2 = 0.9
      // Output: 10000/1000 * 0.015 * 1.5 = 0.225
      // Cache read: 30000/1000 * 0.0003 = 0.009
      // Cache write: 30000/1000 * 0.00375 = 0.1125
      // Total: 0.9 + 0.225 + 0.009 + 0.1125 = 1.2465
      expect(cost).toBe(1.2465);
    });

    it('should NOT apply long-context pricing to opus models', () => {
      const opusPricing: ModelPricing = {
        provider: 'anthropic',
        model: 'claude-opus-4',
        inputPer1k: 0.015,
        outputPer1k: 0.075,
        currency: 'USD',
      };
      const usage: TokenUsage = {
        inputTokens: 250000,
        outputTokens: 10000,
      };
      const cost = calculateCost(usage, opusPricing);
      // No multiplier: (250000/1000 * 0.015) + (10000/1000 * 0.075) = 3.75 + 0.75 = 4.5
      expect(cost).toBe(4.5);
    });

    it('should NOT apply long-context pricing to haiku models', () => {
      const haikuPricing: ModelPricing = {
        provider: 'anthropic',
        model: 'claude-haiku-4.5',
        inputPer1k: 0.001,
        outputPer1k: 0.005,
        currency: 'USD',
      };
      const usage: TokenUsage = {
        inputTokens: 250000,
        outputTokens: 10000,
      };
      const cost = calculateCost(usage, haikuPricing);
      // No multiplier: (250000/1000 * 0.001) + (10000/1000 * 0.005) = 0.25 + 0.05 = 0.3
      expect(cost).toBe(0.3);
    });
  });

  describe('summarizeCosts', () => {
    const mockEntries: CostEntry[] = [
      {
        id: 'cost-1',
        timestamp: '2025-01-01T10:00:00Z',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        operation: 'test',
        usage: {
          inputTokens: 10000,
          outputTokens: 5000,
          cacheReadTokens: 2000,
          cacheWriteTokens: 1000,
        },
        cost: 0.15,
        currency: 'USD',
      },
      {
        id: 'cost-2',
        timestamp: '2025-01-01T11:00:00Z',
        provider: 'anthropic',
        model: 'claude-opus-4',
        issueId: 'issue-1',
        operation: 'test',
        usage: {
          inputTokens: 5000,
          outputTokens: 2000,
          cacheReadTokens: 1000,
          cacheWriteTokens: 500,
        },
        cost: 0.25,
        currency: 'USD',
      },
    ];

    it('should include cache tokens in totalTokens', () => {
      const summary = summarizeCosts(mockEntries);
      expect(summary.totalTokens.input).toBe(15000);
      expect(summary.totalTokens.output).toBe(7000);
      expect(summary.totalTokens.cacheRead).toBe(3000);
      expect(summary.totalTokens.cacheWrite).toBe(1500);
      expect(summary.totalTokens.total).toBe(26500); // All tokens included
    });

    it('should populate cache token fields', () => {
      const summary = summarizeCosts(mockEntries);
      expect(summary.totalTokens).toHaveProperty('cacheRead');
      expect(summary.totalTokens).toHaveProperty('cacheWrite');
      expect(summary.totalTokens.cacheRead).toBeGreaterThan(0);
      expect(summary.totalTokens.cacheWrite).toBeGreaterThan(0);
    });

    it('should calculate total cost correctly', () => {
      const summary = summarizeCosts(mockEntries);
      expect(summary.totalCost).toBe(0.4); // 0.15 + 0.25, rounded to 2 decimals
    });

    it('should handle entries without cache tokens', () => {
      const entries: CostEntry[] = [
        {
          id: 'cost-3',
          timestamp: '2025-01-01T12:00:00Z',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          operation: 'test',
          usage: {
            inputTokens: 10000,
            outputTokens: 5000,
          },
          cost: 0.1,
          currency: 'USD',
        },
      ];
      const summary = summarizeCosts(entries);
      expect(summary.totalTokens.cacheRead).toBe(0);
      expect(summary.totalTokens.cacheWrite).toBe(0);
      expect(summary.totalTokens.total).toBe(15000);
    });
  });

  describe('normalizeModelName', () => {
    it('should normalize opus-4.5 to claude-opus-4.5', () => {
      const result = normalizeModelName('claude-opus-4.5-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-opus-4.5');
    });

    it('should normalize opus-4-5 to claude-opus-4.5', () => {
      const result = normalizeModelName('claude-opus-4-5-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-opus-4.5');
    });

    it('should normalize opus-4.1 to claude-opus-4-1', () => {
      const result = normalizeModelName('claude-opus-4.1-20250101');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-opus-4-1');
    });

    it('should normalize opus-4-1 to claude-opus-4-1', () => {
      const result = normalizeModelName('claude-opus-4-1-20250101');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-opus-4-1');
    });

    it('should normalize opus-4 to claude-opus-4', () => {
      const result = normalizeModelName('claude-opus-4-20240620');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-opus-4');
    });

    it('should normalize sonnet-4.5 to claude-sonnet-4.5', () => {
      const result = normalizeModelName('claude-sonnet-4.5-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4.5');
    });

    it('should normalize sonnet-4 to claude-sonnet-4', () => {
      const result = normalizeModelName('claude-sonnet-4-20240620');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4');
    });

    it('should normalize haiku-4.5 to claude-haiku-4.5', () => {
      const result = normalizeModelName('claude-haiku-4.5-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4.5');
    });

    it('should normalize haiku-3 to claude-haiku-3', () => {
      const result = normalizeModelName('claude-haiku-3-20240307');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-3');
    });

    it('should normalize generic haiku to claude-haiku-4.5 (current)', () => {
      const result = normalizeModelName('claude-haiku-20250929');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-haiku-4.5');
    });

    it('should handle OpenAI models', () => {
      const result = normalizeModelName('gpt-4o-2024-08-06');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o-2024-08-06');
    });

    it('should handle Google models', () => {
      const result = normalizeModelName('gemini-1.5-pro');
      expect(result.provider).toBe('google');
      expect(result.model).toBe('gemini-1.5-pro');
    });

    it('should default to claude-sonnet-4 for unknown models', () => {
      const result = normalizeModelName('unknown-model');
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4');
    });
  });
});
