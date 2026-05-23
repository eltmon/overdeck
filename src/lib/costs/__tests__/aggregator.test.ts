/**
 * Aggregator Tests - Verify cache management and data aggregation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadCacheSync,
  saveCacheSync,
  updateCacheFromEventsSync,
  rebuildCacheSync,
  getCostsByIssueSync,
  getCostsForIssueSync,
  setIssueBudgetSync,
  getCacheStatus,
  CostCache
} from '../aggregator.js';
import { appendCostEventSync, CostEvent } from '../events.js';

let TEST_ROOT: string;
const originalHomedir = process.env.HOME;

beforeEach(() => {
  // Create unique test directory for each test
  TEST_ROOT = join(tmpdir(), `panopticon-agg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const costsDir = join(TEST_ROOT, '.panopticon', 'costs');
  mkdirSync(costsDir, { recursive: true });
  process.env.HOME = TEST_ROOT;
});

afterEach(() => {
  process.env.HOME = originalHomedir;
  if (TEST_ROOT && existsSync(TEST_ROOT)) {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  }
});

describe('Aggregator Cache Management', () => {
  describe('Cache Loading and Saving', () => {
    it('should create empty cache if none exists', () => {
      const cache = loadCacheSync();

      expect(cache.version).toBe(3);
      expect(cache.status).toBe('live');
      expect(cache.issues).toEqual({});
      expect(cache.lastEventLine).toBe(0);
    });

    it('should save and load cache', () => {
      const cache = loadCacheSync();
      cache.issues['TEST-1'] = {
        totalCost: 10.5,
        budgetWarning: false,
        inputTokens: 10000,
        outputTokens: 5000,
        cacheReadTokens: 1000,
        cacheWriteTokens: 500,
        models: {
          'claude-sonnet-4': { cost: 10.5, calls: 5, tokens: 16500 }
        },
        providers: {
          anthropic: 10.5,
          openai: 0,
          google: 0
        },
        stages: {
          implementation: { cost: 10.5, calls: 5, tokens: 16500 }
        },
        lastUpdated: new Date().toISOString()
      };

      saveCacheSync(cache);

      const loaded = loadCacheSync();
      expect(loaded.issues['TEST-1']).toBeDefined();
      expect(loaded.issues['TEST-1'].totalCost).toBe(10.5);
    });

    it('should handle cache version mismatch', () => {
      const cacheFile = join(TEST_ROOT, '.panopticon', 'costs', 'by-issue.json');
      writeFileSync(
        cacheFile,
        JSON.stringify({ version: 1, status: 'live', issues: {} })
      );

      const cache = loadCacheSync();

      // Should create new cache with correct version
      expect(cache.version).toBe(3);
      expect(cache.issues).toEqual({});
    });
  });

  describe('Event Aggregation', () => {
    it('should aggregate costs by issue', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-1',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 100,
          cacheWrite: 50,
          cost: 0.01
        },
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-1',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 2000,
          output: 1000,
          cacheRead: 200,
          cacheWrite: 100,
          cost: 0.02
        }
      ];

      const cache = updateCacheFromEventsSync(events);

      expect(cache.issues['TEST-1']).toBeDefined();
      expect(cache.issues['TEST-1'].totalCost).toBeCloseTo(0.03, 6);
      expect(cache.issues['TEST-1'].inputTokens).toBe(3000);
      expect(cache.issues['TEST-1'].outputTokens).toBe(1500);
    });

    it('should track per-model statistics', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-2',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.01
        },
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-2',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          input: 5000,
          output: 2500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.005
        }
      ];

      const cache = updateCacheFromEventsSync(events);

      expect(cache.issues['TEST-2'].models['claude-sonnet-4']).toBeDefined();
      expect(cache.issues['TEST-2'].models['claude-haiku-4-5']).toBeDefined();
      expect(cache.issues['TEST-2'].models['claude-sonnet-4'].calls).toBe(1);
      expect(cache.issues['TEST-2'].models['claude-haiku-4-5'].calls).toBe(1);
    });

    it('should track per-provider costs', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-3',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.01
        },
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-3',
          sessionType: 'implementation',
          provider: 'openai',
          model: 'gpt-5.4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.0125
        }
      ];

      const cache = updateCacheFromEventsSync(events);

      expect(cache.issues['TEST-3'].providers.anthropic).toBeCloseTo(0.01, 6);
      expect(cache.issues['TEST-3'].providers.openai).toBeCloseTo(0.0125, 6);
    });

    it('should handle case-insensitive issue IDs', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'test-4', // lowercase
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.01
        }
      ];

      const cache = updateCacheFromEventsSync(events);

      // Should be stored as uppercase
      expect(cache.issues['TEST-4']).toBeDefined();
      expect(cache.issues['test-4']).toBeUndefined();
    });
  });

  describe('Budget Tracking', () => {
    it('should set budget for issue', () => {
      // First add some cost
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-5',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 50.0
        }
      ];

      updateCacheFromEventsSync(events);

      // Set budget
      setIssueBudgetSync('TEST-5', 100.0);

      const cache = loadCacheSync();
      expect(cache.issues['TEST-5'].budget).toBe(100.0);
    });

    it('should trigger budget warning at 80% threshold', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-6',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 85.0
        }
      ];

      updateCacheFromEventsSync(events);
      setIssueBudgetSync('TEST-6', 100.0);

      const cache = loadCacheSync();
      expect(cache.issues['TEST-6'].budgetWarning).toBe(true);
    });

    it('should not warn below 80% threshold', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-7',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1000,
          output: 500,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 75.0
        }
      ];

      updateCacheFromEventsSync(events);
      setIssueBudgetSync('TEST-7', 100.0);

      const cache = loadCacheSync();
      expect(cache.issues['TEST-7'].budgetWarning).toBe(false);
    });
  });

  describe('Floating Point Precision', () => {
    it('should round costs to avoid floating point errors', () => {
      const events: CostEvent[] = [
        {
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-8',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 333,
          output: 666,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.0000123456789
        }
      ];

      const cache = updateCacheFromEventsSync(events);

      // Cost should be rounded to 6 decimal places
      const costStr = cache.issues['TEST-8'].totalCost.toString();
      if (costStr.includes('.')) {
        const decimals = costStr.split('.')[1].length;
        expect(decimals).toBeLessThanOrEqual(6);
      }
    });

    it('should handle accumulation of many small costs', () => {
      const events: CostEvent[] = [];

      // Add 1000 tiny events
      for (let i = 0; i < 1000; i++) {
        events.push({
          ts: new Date().toISOString(),
          type: 'cost',
          agentId: 'agent-1',
          issueId: 'TEST-9',
          sessionType: 'implementation',
          provider: 'anthropic',
          model: 'claude-sonnet-4',
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0.000001
        });
      }

      const cache = updateCacheFromEventsSync(events);

      // Should accumulate correctly without floating point errors
      expect(cache.issues['TEST-9'].totalCost).toBeCloseTo(0.001, 6);
    });
  });

  describe('Cache Sync', () => {
    it('should get correct cache status', () => {
      const status = getCacheStatus();

      expect(status.status).toBeDefined();
      expect(status.eventCount).toBeDefined();
      expect(status.issueCount).toBeDefined();
      expect(typeof status.needsSync).toBe('boolean');
    });

    it('should query costs by issue', () => {
      const event: CostEvent = {
        ts: new Date().toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-10',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      };

      // Write to events file - syncCache will pick it up
      appendCostEventSync(event);

      const issueData = getCostsForIssueSync('TEST-10');
      expect(issueData).toBeDefined();
      expect(issueData?.totalCost).toBeCloseTo(0.01, 6);
    });

    it('should handle case-insensitive issue lookup', () => {
      const event: CostEvent = {
        ts: new Date().toISOString(),
        type: 'cost',
        agentId: 'agent-1',
        issueId: 'TEST-11',
        sessionType: 'implementation',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        input: 1000,
        output: 500,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0.01
      };

      // Write to events file - syncCache will pick it up
      appendCostEventSync(event);

      // Should find with lowercase query
      const issueData = getCostsForIssueSync('test-11');
      expect(issueData).toBeDefined();
      expect(issueData?.totalCost).toBeCloseTo(0.01, 6);
    });
  });
});
