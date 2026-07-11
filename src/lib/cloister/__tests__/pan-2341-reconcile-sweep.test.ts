import { describe, expect, it, vi } from 'vitest';
import {
  markAdvancingSessionStopped,
  parseAdvancingIssueId,
  reconcileInFlightJournals,
  type AdvancingSelfHealDeps,
} from '../advancing-selfheal.js';
import type { AgentState } from '../../agents.js';
import type { ReviewStatus } from '../../review-status.js';

function status(fields: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-2341',
    reviewStatus: 'reviewing',
    testStatus: 'pending',
    updatedAt: '2026-07-07T00:00:00.000Z',
    readyForMerge: false,
    ...fields,
  } as ReviewStatus;
}

function deps(overrides: Partial<AdvancingSelfHealDeps> = {}): AdvancingSelfHealDeps {
  return {
    loadReviewStatuses: vi.fn(() => ({})),
    getReviewStatusSync: vi.fn(() => null),
    listSessionNames: vi.fn(async () => []),
    getAgentStateSync: vi.fn(() => null),
    saveAgentStateSync: vi.fn(),
    markAgentStoppedState: vi.fn((state) => ({ ...state, status: 'stopped' as const })),
    warn: vi.fn(),
    ...overrides,
  };
}

function agent(fields: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-2341-review',
    issueId: 'PAN-2341',
    workspace: '/tmp/workspace',
    role: 'review',
    model: 'test-model',
    status: 'running',
    startedAt: '2026-07-07T00:00:00.000Z',
    ...fields,
  };
}

describe('reconcileInFlightJournals', () => {
  it('PAN-2524: reconciles a durable passed verdict and ready-for-merge derivation after its signal dies', async () => {
    const before = status({ reviewStatus: 'reviewing', testStatus: 'passed', readyForMerge: false });
    const after = status({
      reviewStatus: 'passed',
      testStatus: 'passed',
      readyForMerge: true,
      updatedAt: '2026-07-07T00:01:00.000Z',
    });
    const d = deps({
      loadReviewStatuses: vi.fn(() => ({ 'PAN-2524': before })),
      getReviewStatusSync: vi.fn(() => after),
    });

    await expect(reconcileInFlightJournals(d)).resolves.toEqual([
      'Reconciled journaled advancing verdict for PAN-2524',
    ]);
    expect(d.getReviewStatusSync).toHaveBeenCalledWith('PAN-2524');
  });

  it('calls getReviewStatusSync for in-flight rows and reports rows advanced from the journal', async () => {
    const before = status({ reviewStatus: 'reviewing', updatedAt: '2026-07-07T00:00:00.000Z' });
    const after = status({ reviewStatus: 'passed', updatedAt: '2026-07-07T00:01:00.000Z' });
    const d = deps({
      loadReviewStatuses: vi.fn(() => ({ 'PAN-2341': before })),
      getReviewStatusSync: vi.fn(() => after),
    });

    await expect(reconcileInFlightJournals(d)).resolves.toEqual([
      'Reconciled journaled advancing verdict for PAN-2341',
    ]);
    expect(d.getReviewStatusSync).toHaveBeenCalledWith('PAN-2341');
  });

  it('reconciles in-flight review rows when tests are skipped', async () => {
    const before = status({
      reviewStatus: 'reviewing',
      testStatus: 'skipped',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });
    const after = status({
      reviewStatus: 'passed',
      testStatus: 'skipped',
      updatedAt: '2026-07-07T00:01:00.000Z',
    });
    const d = deps({
      loadReviewStatuses: vi.fn(() => ({ 'PAN-2341': before })),
      getReviewStatusSync: vi.fn(() => after),
    });

    await expect(reconcileInFlightJournals(d)).resolves.toEqual([
      'Reconciled journaled advancing verdict for PAN-2341',
    ]);
    expect(d.getReviewStatusSync).toHaveBeenCalledWith('PAN-2341');
  });

  it('enumerates tmux-alive advancing sessions with no DB row and skips merged issues', async () => {
    const d = deps({
      loadReviewStatuses: vi.fn(() => ({
        'PAN-3002': status({ issueId: 'PAN-3002', mergeStatus: 'merged' }),
      })),
      listSessionNames: vi.fn(async () => [
        'agent-pan-3001-review',
        'agent-pan-3002-test',
        'agent-pan-3003',
      ]),
      getReviewStatusSync: vi.fn((issueId) => issueId === 'PAN-3001'
        ? status({ issueId, reviewStatus: 'passed', updatedAt: '2026-07-07T00:02:00.000Z' })
        : null),
    });

    await expect(reconcileInFlightJournals(d)).resolves.toEqual([
      'Reconciled journaled advancing verdict for PAN-3001',
    ]);
    expect(d.getReviewStatusSync).toHaveBeenCalledTimes(1);
    expect(d.getReviewStatusSync).toHaveBeenCalledWith('PAN-3001');
  });

  it('parses only advancing-role session names', () => {
    expect(parseAdvancingIssueId('agent-pan-3001-review')).toBe('PAN-3001');
    expect(parseAdvancingIssueId('agent-pan-3001-review-correctness')).toBe('PAN-3001');
    expect(parseAdvancingIssueId('agent-pan-3001-test')).toBe('PAN-3001');
    expect(parseAdvancingIssueId('agent-pan-3001-ship')).toBe('PAN-3001');
    expect(parseAdvancingIssueId('agent-pan-3001')).toBeNull();
    expect(parseAdvancingIssueId('specialist-overdeck-pan-3001-review')).toBeNull();
  });

  it('marks only running advancing sessions stopped', () => {
    const running = agent({ status: 'running' });
    const d = deps({
      getAgentStateSync: vi.fn(() => running),
    });

    expect(markAdvancingSessionStopped('agent-pan-2341-review', d)).toBe(true);
    expect(d.markAgentStoppedState).toHaveBeenCalledWith(running);
    expect(d.saveAgentStateSync).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));

    const stopped = deps({
      getAgentStateSync: vi.fn(() => agent({ status: 'stopped' })),
    });
    expect(markAdvancingSessionStopped('agent-pan-2341-review', stopped)).toBe(false);
    expect(stopped.saveAgentStateSync).not.toHaveBeenCalled();
  });
});
