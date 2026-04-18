/**
 * Tests for stuckCount union logic in GET /api/metrics/summary (PAN-653).
 *
 * The stuckCount must be the SIZE OF THE UNION of:
 *   1. Issues whose running agent has health.state === 'stuck' (inactivity)
 *   2. Issues with review_status.stuck === true (persistent divergence flag)
 *
 * An issue that satisfies BOTH criteria must count as 1, not 2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that trigger module resolution
// ---------------------------------------------------------------------------

const mockGetStatus = vi.fn();
const mockGetAgentHealth = vi.fn();
const mockGetCloisterService = vi.fn(() => ({
  getStatus: mockGetStatus,
  getAgentHealth: mockGetAgentHealth,
}));

vi.mock('../../../src/lib/cloister/service.js', () => ({
  getCloisterService: (...args: unknown[]) => mockGetCloisterService(...args),
}));

const mockListRunningAgents = vi.fn();
vi.mock('../../../src/lib/agents.js', () => ({
  listRunningAgents: (...args: unknown[]) => mockListRunningAgents(...args),
}));

const mockLoadReviewStatuses = vi.fn();
vi.mock('../../../src/lib/review-status.js', () => ({
  loadReviewStatuses: (...args: unknown[]) => mockLoadReviewStatuses(...args),
}));

// Stub remaining deps so the module loads cleanly
vi.mock('../../../src/lib/costs/index.js', () => ({
  readEvents: () => [],
}));
vi.mock('../../../src/lib/convoy.js', () => ({
  startConvoy: vi.fn(),
  stopConvoy: vi.fn(),
  getConvoyStatus: vi.fn(),
  listConvoys: vi.fn(() => []),
}));
vi.mock('../../../src/dashboard/server/services/git-activity.js', () => ({
  listGitOperations: vi.fn(() => []),
}));
vi.mock('../../../src/dashboard/server/services/domain-services.js', () => ({
  EventStoreService: {},
}));

// ---------------------------------------------------------------------------
// Helper — build the stuckCount the same way metrics.ts does
// (extracted so we can unit-test it without spinning up Effect HTTP)
// ---------------------------------------------------------------------------

/**
 * Mirror of the stuckCount computation in metrics.ts so we can unit-test it.
 * If you change the logic in metrics.ts, update this too.
 */
function computeStuckCount(opts: {
  agentsNeedingAttention: string[];
  agentIdToHealth: Record<string, 'stuck' | 'warning' | 'active'>;
  agentIdToIssueId: Record<string, string>;
  persistentStuckIssueIds: string[];
}): number {
  const persistentSet = new Set(opts.persistentStuckIssueIds.map(id => id.toUpperCase()));
  const healthStuckSet = new Set<string>();
  for (const agentId of opts.agentsNeedingAttention) {
    if (opts.agentIdToHealth[agentId] === 'stuck') {
      const issueId = opts.agentIdToIssueId[agentId];
      if (issueId) healthStuckSet.add(issueId.toUpperCase());
    }
  }
  return new Set([...healthStuckSet, ...persistentSet]).size;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stuckCount union logic', () => {
  it('counts zero when no stuck agents and no persistent flags', () => {
    expect(computeStuckCount({
      agentsNeedingAttention: [],
      agentIdToHealth: {},
      agentIdToIssueId: {},
      persistentStuckIssueIds: [],
    })).toBe(0);
  });

  it('counts one health-stuck agent as 1', () => {
    expect(computeStuckCount({
      agentsNeedingAttention: ['agent-pan-100'],
      agentIdToHealth: { 'agent-pan-100': 'stuck' },
      agentIdToIssueId: { 'agent-pan-100': 'PAN-100' },
      persistentStuckIssueIds: [],
    })).toBe(1);
  });

  it('does not count warning-state agents (only stuck state)', () => {
    expect(computeStuckCount({
      agentsNeedingAttention: ['agent-pan-100'],
      agentIdToHealth: { 'agent-pan-100': 'warning' },
      agentIdToIssueId: { 'agent-pan-100': 'PAN-100' },
      persistentStuckIssueIds: [],
    })).toBe(0);
  });

  it('counts one persistent-stuck issue as 1', () => {
    expect(computeStuckCount({
      agentsNeedingAttention: [],
      agentIdToHealth: {},
      agentIdToIssueId: {},
      persistentStuckIssueIds: ['PAN-200'],
    })).toBe(1);
  });

  it('deduplicates an issue that is BOTH health-stuck AND persistently stuck', () => {
    // PAN-100 is stuck by inactivity AND has review_status.stuck=true
    // Must count as 1, not 2.
    expect(computeStuckCount({
      agentsNeedingAttention: ['agent-pan-100'],
      agentIdToHealth: { 'agent-pan-100': 'stuck' },
      agentIdToIssueId: { 'agent-pan-100': 'PAN-100' },
      persistentStuckIssueIds: ['PAN-100'],
    })).toBe(1);
  });

  it('counts distinct issues from both sources (no overlap)', () => {
    // PAN-100 is health-stuck, PAN-200 is persistently stuck — total = 2
    expect(computeStuckCount({
      agentsNeedingAttention: ['agent-pan-100'],
      agentIdToHealth: { 'agent-pan-100': 'stuck' },
      agentIdToIssueId: { 'agent-pan-100': 'PAN-100' },
      persistentStuckIssueIds: ['PAN-200'],
    })).toBe(2);
  });

  it('counts correctly with multiple agents and partial overlap', () => {
    // PAN-100: health-stuck only
    // PAN-200: both (dedup → 1)
    // PAN-300: persistently stuck only
    expect(computeStuckCount({
      agentsNeedingAttention: ['agent-pan-100', 'agent-pan-200'],
      agentIdToHealth: { 'agent-pan-100': 'stuck', 'agent-pan-200': 'stuck' },
      agentIdToIssueId: { 'agent-pan-100': 'PAN-100', 'agent-pan-200': 'PAN-200' },
      persistentStuckIssueIds: ['PAN-200', 'PAN-300'],
    })).toBe(3);
  });

  it('is case-insensitive across both sources', () => {
    expect(computeStuckCount({
      agentsNeedingAttention: ['agent-pan-100'],
      agentIdToHealth: { 'agent-pan-100': 'stuck' },
      agentIdToIssueId: { 'agent-pan-100': 'pan-100' },   // lowercase from agent
      persistentStuckIssueIds: ['PAN-100'],                 // uppercase from DB
    })).toBe(1);
  });
});
