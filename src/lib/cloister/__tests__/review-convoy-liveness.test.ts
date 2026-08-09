import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateReviewConvoyLiveness } from '../review-convoy-liveness.js';

const mocks = vi.hoisted(() => ({
  getAgentEffectiveLastActivityMs: vi.fn(),
}));

vi.mock('../agent-idle.js', () => ({
  getAgentEffectiveLastActivityMs: mocks.getAgentEffectiveLastActivityMs,
}));

const now = Date.parse('2026-07-15T16:00:00.000Z');

describe('evaluateReviewConvoyLiveness', () => {
  beforeEach(() => {
    mocks.getAgentEffectiveLastActivityMs.mockReset();
    mocks.getAgentEffectiveLastActivityMs.mockReturnValue(null);
  });

  it('keeps the current convoy active when effective runtime activity is fresh', () => {
    const runId = 'agent-pan-3411-review-abcdef12';
    mocks.getAgentEffectiveLastActivityMs.mockImplementation((agentId: string) =>
      agentId.endsWith('-correctness') ? now - 60_000 : null,
    );

    const result = evaluateReviewConvoyLiveness('PAN-3411', {
      reviewSpawnedAt: now - 16 * 60 * 1000,
      updatedAt: '2026-07-15T15:44:00.000Z',
    }, [
      { id: 'agent-pan-3411-review', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: runId },
      { id: 'agent-pan-3411-review-security', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: runId },
      { id: 'agent-pan-3411-review-performance', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: runId },
      { id: 'agent-pan-3411-review-requirements', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: runId },
      { id: 'agent-pan-3411-review-correctness', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: runId },
    ], now);

    expect(result).toEqual({ active: true, reason: 'active review agent agent-pan-3411-review-correctness' });
  });

  it('ignores fresh activity from a reviewer belonging to an earlier run', () => {
    const currentRunId = 'agent-pan-3411-review-abcdef12';
    mocks.getAgentEffectiveLastActivityMs.mockImplementation((agentId: string) =>
      agentId.endsWith('-correctness') ? now - 60_000 : null,
    );

    const result = evaluateReviewConvoyLiveness('PAN-3411', {
      reviewSpawnedAt: now - 16 * 60 * 1000,
      updatedAt: '2026-07-15T15:44:00.000Z',
    }, [
      { id: 'agent-pan-3411-review', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: currentRunId },
      { id: 'agent-pan-3411-review-correctness', issueId: 'PAN-3411', role: 'review', status: 'running', lastActivity: '2026-07-15T15:44:00.000Z', reviewRunId: 'agent-pan-3411-review-deadbeef' },
    ], now);

    expect(result).toEqual({ active: false, reason: 'all review agents stale' });
  });

  it('expires a numeric epoch-millis review timestamp', () => {
    const result = evaluateReviewConvoyLiveness('PAN-2735', {
      reviewSpawnedAt: now - 46 * 60 * 1000,
      updatedAt: '2026-07-15T15:59:00.000Z',
    }, [{
      id: 'agent-pan-2735-review',
      issueId: 'PAN-2735',
      role: 'review',
      status: 'running',
      lastActivity: '2026-07-15T15:59:00.000Z',
    }], now);

    expect(result).toEqual({ active: false, reason: 'review watchdog expired' });
  });

  it('treats a stopped coordinator as authoritative over running sub-reviewers', () => {
    const result = evaluateReviewConvoyLiveness('PAN-2735', {
      reviewSpawnedAt: '2026-07-15T15:55:00.000Z',
      updatedAt: '2026-07-15T15:55:00.000Z',
    }, [
      { id: 'agent-pan-2735-review', issueId: 'PAN-2735', role: 'review', status: 'stopped' },
      { id: 'agent-pan-2735-review-security', issueId: 'PAN-2735', role: 'review', status: 'running' },
    ], now);

    expect(result).toEqual({ active: false, reason: 'coordinator stopped' });
  });
});
