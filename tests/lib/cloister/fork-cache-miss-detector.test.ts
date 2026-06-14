import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkFirstRequestCacheMiss,
  checkTimingLikelyMiss,
  detectForkCacheMiss,
  PROACTIVE_MISS_THRESHOLD_MS,
} from '../../../src/lib/cloister/fork-cache-miss-detector.js';

// Mock the DB layer — tests must not touch SQLite.
vi.mock('../../../src/lib/database/cost-events-db.js', () => ({
  queryCostEvents: vi.fn(),
}));

import { queryCostEvents } from '../../../src/lib/database/cost-events-db.js';
const mockQueryCostEvents = vi.mocked(queryCostEvents);

/** Build a minimal CostEvent-shaped object */
function makeCostEvent(cacheRead: number) {
  return {
    ts: '2026-06-14T10:00:00.000Z',
    type: 'cost' as const,
    agentId: 'agent-test',
    issueId: 'PAN-1862',
    sessionType: 'review',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    input: 1000,
    output: 100,
    cacheRead,
    cacheWrite: 0,
    cost: 0.01,
  };
}

// Fixed ISO timestamps for timing tests — pure arithmetic, no Date.now().
const T0 = '2026-06-14T10:00:00.000Z'; // discoveryReadyAt
/** 269 s after T0 — just under the 270 s proactive threshold */
const T_BELOW_THRESHOLD = '2026-06-14T10:04:29.000Z';
/** Exactly 270 s after T0 — at the threshold */
const T_AT_THRESHOLD = '2026-06-14T10:04:30.000Z';
/** 300 s after T0 — at the TTL boundary */
const T_AT_TTL = '2026-06-14T10:05:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkFirstRequestCacheMiss', () => {
  it('returns null when no cost events are recorded for the agent', () => {
    mockQueryCostEvents.mockReturnValue([]);
    expect(checkFirstRequestCacheMiss('agent-test')).toBeNull();
  });

  it('returns true when the first cost event has cacheRead == 0', () => {
    mockQueryCostEvents.mockReturnValue([makeCostEvent(0)]);
    expect(checkFirstRequestCacheMiss('agent-test')).toBe(true);
  });

  it('returns false when the first cost event has cacheRead > 0', () => {
    mockQueryCostEvents.mockReturnValue([makeCostEvent(5000)]);
    expect(checkFirstRequestCacheMiss('agent-test')).toBe(false);
  });

  it('passes agentId and limit:1 to queryCostEvents', () => {
    mockQueryCostEvents.mockReturnValue([]);
    checkFirstRequestCacheMiss('agent-pan-1862-review-security');
    expect(mockQueryCostEvents).toHaveBeenCalledWith({ agentId: 'agent-pan-1862-review-security', limit: 1 });
  });
});

describe('checkTimingLikelyMiss', () => {
  it('returns false when gap is below the proactive threshold (269 s)', () => {
    expect(checkTimingLikelyMiss(T0, T_BELOW_THRESHOLD)).toBe(false);
  });

  it('returns true when gap is exactly at the threshold (270 s)', () => {
    expect(checkTimingLikelyMiss(T0, T_AT_THRESHOLD)).toBe(true);
  });

  it('returns true when gap is at the full TTL boundary (300 s)', () => {
    expect(checkTimingLikelyMiss(T0, T_AT_TTL)).toBe(true);
  });

  it('threshold is 270 s (exported constant matches 270 000 ms)', () => {
    expect(PROACTIVE_MISS_THRESHOLD_MS).toBe(270_000);
  });
});

describe('detectForkCacheMiss', () => {
  describe('non-claude-code harnesses', () => {
    it('returns detected:false for pi harness (D9: Pi never forks)', () => {
      const result = detectForkCacheMiss('agent-test', 'pi');
      expect(result.detected).toBe(false);
      expect(result.reasons).toEqual([]);
      expect(result.detail).toContain('not applicable');
    });

    it('returns detected:false for codex harness', () => {
      const result = detectForkCacheMiss('agent-test', 'codex');
      expect(result.detected).toBe(false);
    });

    it('does NOT call queryCostEvents for non-claude-code harnesses', () => {
      detectForkCacheMiss('agent-test', 'pi');
      expect(mockQueryCostEvents).not.toHaveBeenCalled();
    });
  });

  describe('claude-code harness — first-request signal', () => {
    it('returns detected:false with unknown detail when no cost events yet', () => {
      mockQueryCostEvents.mockReturnValue([]);
      const result = detectForkCacheMiss('agent-test', 'claude-code');
      expect(result.detected).toBe(false);
      expect(result.reasons).toEqual([]);
      expect(result.detail).toContain('unknown');
    });

    it('returns detected:true with first_request_cache_miss when cacheRead==0', () => {
      mockQueryCostEvents.mockReturnValue([makeCostEvent(0)]);
      const result = detectForkCacheMiss('agent-test', 'claude-code');
      expect(result.detected).toBe(true);
      expect(result.reasons).toContain('first_request_cache_miss');
    });

    it('returns detected:false when cacheRead > 0 and no timing concern', () => {
      mockQueryCostEvents.mockReturnValue([makeCostEvent(8000)]);
      const result = detectForkCacheMiss('agent-test', 'claude-code', T0, T_BELOW_THRESHOLD);
      expect(result.detected).toBe(false);
      expect(result.detail).toContain('cache warm');
    });
  });

  describe('claude-code harness — timing signal', () => {
    it('returns detected:true with timing_likely_miss when gap >= 270 s', () => {
      mockQueryCostEvents.mockReturnValue([]); // no cost events yet
      const result = detectForkCacheMiss('agent-test', 'claude-code', T0, T_AT_THRESHOLD);
      expect(result.detected).toBe(true);
      expect(result.reasons).toContain('timing_likely_miss');
    });

    it('does NOT flag timing_likely_miss when only one timestamp provided', () => {
      mockQueryCostEvents.mockReturnValue([]);
      const resultOnly = detectForkCacheMiss('agent-test', 'claude-code', T0, undefined);
      expect(resultOnly.reasons).not.toContain('timing_likely_miss');
    });
  });

  describe('claude-code harness — both signals', () => {
    it('accumulates both reasons when first request misses AND timing exceeds threshold', () => {
      mockQueryCostEvents.mockReturnValue([makeCostEvent(0)]);
      const result = detectForkCacheMiss('agent-test', 'claude-code', T0, T_AT_TTL);
      expect(result.detected).toBe(true);
      expect(result.reasons).toContain('first_request_cache_miss');
      expect(result.reasons).toContain('timing_likely_miss');
    });

    it('detail message mentions both reasons when both are present', () => {
      mockQueryCostEvents.mockReturnValue([makeCostEvent(0)]);
      const result = detectForkCacheMiss('agent-test', 'claude-code', T0, T_AT_TTL);
      expect(result.detail).toContain('first_request_cache_miss');
      expect(result.detail).toContain('timing_likely_miss');
    });
  });
});
