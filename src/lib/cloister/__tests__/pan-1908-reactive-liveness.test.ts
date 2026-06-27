/**
 * Tests for PAN-1908 reactive agent liveness: handleAgentStoppedEvent and
 * handleAgentHeartbeatDeadEvent replace the directory-scan patrol steps.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockGetAgentStateSync = vi.fn();
const mockSaveAgentState = vi.fn();
const mockSaveAgentStateSync = vi.fn();
const mockResumeAgent = vi.fn();
const mockRecordAgentFailure = vi.fn();
const mockResetAgentFailureCount = vi.fn();
const mockMarkAgentRunningState = vi.fn();
const mockSessionExists = vi.fn();
const mockSessionExistsSync = vi.fn();
const mockKillSession = vi.fn();
const mockListPaneValues = vi.fn();
const mockGetReviewStatusSync = vi.fn();
const mockGetAgentRuntimeStateSync = vi.fn();
const mockWorkResumeSlotsAvailable = vi.fn();
const mockCountRunningAgents = vi.fn();
const mockGetConcurrencyLimits = vi.fn();
const mockIsIssueClosed = vi.fn();

vi.mock('effect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('effect')>();
  return { ...actual };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      if (path === '/tmp/workspace') return true;
      if (path.startsWith('/tmp/agents/')) return false;
      return actual.existsSync(path);
    },
  };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: actual,
    loadavg: () => [0.5, 0.5, 0.5],
    cpus: () => Array.from({ length: 8 }, () => ({}) as ReturnType<typeof actual.cpus>[number]),
  };
});

vi.mock('../../../lib/agents.js', () => ({
  getAgentStateSync: (...args: unknown[]) => mockGetAgentStateSync(...args),
  getAgentState: (...args: unknown[]) => Effect.succeed(mockGetAgentStateSync(...args)),
  saveAgentState: (...args: unknown[]) => mockSaveAgentState(...args),
  saveAgentStateSync: (...args: unknown[]) => mockSaveAgentStateSync(...args),
  resumeAgent: (...args: unknown[]) => mockResumeAgent(...args),
  recordAgentFailure: (...args: unknown[]) => mockRecordAgentFailure(...args),
  resetAgentFailureCount: (...args: unknown[]) => mockResetAgentFailureCount(...args),
  markAgentRunningState: (...args: unknown[]) => mockMarkAgentRunningState(...args),
  getAgentRuntimeStateSync: (...args: unknown[]) => mockGetAgentRuntimeStateSync(...args),
  getAgentDir: (id: string) => `/tmp/agents/${id}`,
  normalizeAgentId: (id: string) => id,
}));

vi.mock('../../../lib/tmux.js', () => ({
  sessionExists: (...args: unknown[]) => Effect.succeed(mockSessionExists(...args)),
  sessionExistsSync: (...args: unknown[]) => mockSessionExistsSync(...args),
  killSession: (...args: unknown[]) => Effect.succeed(mockKillSession(...args)),
  killSessionSync: (...args: unknown[]) => mockKillSession(...args),
  listPaneValues: (...args: unknown[]) => Effect.succeed(mockListPaneValues(...args)),
}));

vi.mock('../../../lib/review-status.js', () => ({
  getReviewStatusSync: (...args: unknown[]) => mockGetReviewStatusSync(...args),
  loadReviewStatuses: () => ({}),
}));

vi.mock('../../../lib/cloister/concurrency.js', () => ({
  workResumeSlotsAvailable: (...args: unknown[]) => mockWorkResumeSlotsAvailable(...args),
  countRunningAgents: () => mockCountRunningAgents(),
  getConcurrencyLimits: () => mockGetConcurrencyLimits(),
  resetPatrolDispatchBudget: vi.fn(),
  tryReserveAdvancingSlot: () => true,
  canDispatchAdvancing: () => true,
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: (...args: unknown[]) => mockIsIssueClosed(...args),
}));

vi.mock('../../../lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

vi.mock('../../../lib/persistent-logger.js', () => ({
  logDeaconEvent: vi.fn(),
  logDeaconEventSync: vi.fn(),
  logAgentLifecycle: vi.fn(),
  logAgentLifecycleSync: vi.fn(),
}));

vi.mock('../../../lib/database/agents-db.js', () => ({
  listAllAgents: vi.fn(() => []),
}));

vi.mock('../no-resume-mode.js', () => ({
  getNoResumeMode: () => ({ active: false, since: null }),
}));

import {
  handleAgentStoppedEvent,
  handleAgentHeartbeatDeadEvent,
} from '../deacon.js';

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-pan-1908',
    issueId: 'PAN-1908',
    workspace: '/tmp/workspace',
    harness: 'claude-code',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'stopped',
    startedAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('PAN-1908 reactive liveness handlers', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'pan-1908-liveness-'));
    mockGetAgentStateSync.mockReturnValue(null);
    mockSaveAgentState.mockReturnValue(Effect.void);
    mockResumeAgent.mockResolvedValue({ success: true });
    mockRecordAgentFailure.mockReturnValue(Effect.succeed(null));
    mockResetAgentFailureCount.mockReturnValue(undefined);
    mockMarkAgentRunningState.mockImplementation((s: any) => { s.status = 'running'; });
    mockSessionExists.mockResolvedValue(false);
    mockSessionExistsSync.mockReturnValue(false);
    mockKillSession.mockResolvedValue(undefined);
    mockListPaneValues.mockResolvedValue(['0']);
    mockGetReviewStatusSync.mockReturnValue(undefined);
    mockGetAgentRuntimeStateSync.mockReturnValue(null);
    mockWorkResumeSlotsAvailable.mockReturnValue(6);
    mockCountRunningAgents.mockReturnValue({ work: 0, advancing: 0, total: 0 });
    mockGetConcurrencyLimits.mockReturnValue({ maxWorkAgents: 6, reservedAdvancingSlots: 3, totalCeiling: 9 });
    mockIsIssueClosed.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('handleAgentStoppedEvent', () => {
    it('returns null and skips non-existent agents', async () => {
      mockGetAgentStateSync.mockReturnValue(null);
      const result = await handleAgentStoppedEvent('agent-pan-1908');
      expect(result).toBeNull();
      expect(mockResumeAgent).not.toHaveBeenCalled();
    });

    it('resumes a stopped work agent with pending review feedback', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState());
      mockGetReviewStatusSync.mockReturnValue({
        issueId: 'PAN-1908',
        reviewStatus: 'blocked',
        testStatus: 'pending',
        verificationStatus: 'pending',
        readyForMerge: false,
      });

      const result = await handleAgentStoppedEvent('agent-pan-1908');

      expect(result).toBe('agent-pan-1908');
      expect(mockResumeAgent).toHaveBeenCalledWith('agent-pan-1908');
    });

    it('does not resume a deliberately killed agent without completed marker', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState({ stoppedByUser: true }));
      mockGetReviewStatusSync.mockReturnValue({
        issueId: 'PAN-1908',
        reviewStatus: 'blocked',
        testStatus: 'pending',
      });

      const result = await handleAgentStoppedEvent('agent-pan-1908');

      expect(result).toBeNull();
      expect(mockResumeAgent).not.toHaveBeenCalled();
    });

    it('defers when concurrency slots are exhausted', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState());
      mockGetReviewStatusSync.mockReturnValue({ reviewStatus: 'blocked' });
      mockWorkResumeSlotsAvailable.mockReturnValue(0);

      const result = await handleAgentStoppedEvent('agent-pan-1908');

      expect(result).toBeNull();
      expect(mockResumeAgent).not.toHaveBeenCalled();
    });
  });

  describe('handleAgentHeartbeatDeadEvent', () => {
    it('marks a running work agent stopped and records failure', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState({ status: 'running' }));

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908');

      expect(actions.length).toBeGreaterThan(0);
      expect(mockSaveAgentState).toHaveBeenCalled();
      const saved = mockSaveAgentState.mock.calls[0][0];
      expect(saved.status).toBe('stopped');
      expect(mockRecordAgentFailure).toHaveBeenCalled();
    });

    // PAN-1718: a work agent that orphans before its kickoff was delivered never
    // came up healthy. The reconciler re-dispatches it as a fresh start, so the
    // failure counter must ACCUMULATE (not reset) across cycles — otherwise it
    // oscillates 1→0→1 and never trips the troubled gate, crash-looping forever.
    it('accumulates (does not reset) failures for a pre-kickoff work-agent launch crash', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState({ status: 'running', kickoffDelivered: false }));

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908');

      expect(actions.length).toBeGreaterThan(0);
      expect(mockRecordAgentFailure).toHaveBeenCalled();
      expect(mockRecordAgentFailure.mock.calls[0][1]).toContain('launch crash');
      expect(mockResetAgentFailureCount).not.toHaveBeenCalled();
    });

    // The complement: a work agent that DID deliver its kickoff and later orphans
    // is a healthy run that died — it should get a clean retry (counter reset).
    it('resets failures for a normal work-agent orphan that already delivered its kickoff', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState({ status: 'running', kickoffDelivered: true }));

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908');

      expect(actions.length).toBeGreaterThan(0);
      expect(mockResetAgentFailureCount).toHaveBeenCalled();
      expect(mockRecordAgentFailure.mock.calls[0][1]).toContain('orphaned: tmux session missing');
    });

    it('marks a review sub-role with a completed report stopped without recording orphan failure', async () => {
      const outputPath = join(tempDir, 'security.md');
      writeFileSync(outputPath, '## Findings\n\nNone.\n');
      mockGetAgentStateSync.mockReturnValue(makeState({
        id: 'agent-pan-1908-review-security',
        role: 'review',
        status: 'running',
        startedAt: '2026-06-15T00:00:00.000Z',
        reviewSubRole: 'security',
        reviewRunId: 'agent-pan-1908-review-abcd1234',
        reviewOutputPath: outputPath,
        reviewSynthesisAgentId: 'agent-pan-1908-review',
      }));

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908-review-security');

      expect(actions.length).toBeGreaterThan(0);
      expect(mockSaveAgentState).toHaveBeenCalled();
      const saved = mockSaveAgentState.mock.calls[0][0];
      expect(saved.status).toBe('stopped');
      expect(mockRecordAgentFailure).not.toHaveBeenCalled();
      expect(mockResetAgentFailureCount).not.toHaveBeenCalled();
    });

    it('marks a review synthesis agent with synthesis.md stopped without recording orphan failure', async () => {
      const workspace = join(tempDir, 'workspace');
      const reviewRunId = 'agent-pan-1908-review-abcd1234';
      const reviewDir = join(workspace, '.pan', 'review', reviewRunId);
      mkdirSync(reviewDir, { recursive: true });
      writeFileSync(join(reviewDir, 'synthesis.md'), '## Verdict: APPROVED\n\nReady.\n');
      mockGetAgentStateSync.mockReturnValue(makeState({
        id: 'agent-pan-1908-review',
        role: 'review',
        status: 'running',
        workspace,
        startedAt: '2026-06-15T00:00:00.000Z',
        reviewRunId,
      }));

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908-review');

      expect(actions.length).toBeGreaterThan(0);
      expect(mockSaveAgentState).toHaveBeenCalled();
      const saved = mockSaveAgentState.mock.calls[0][0];
      expect(saved.status).toBe('stopped');
      expect(mockRecordAgentFailure).not.toHaveBeenCalled();
      expect(mockResetAgentFailureCount).not.toHaveBeenCalled();
    });

    it('skips agents that are already stopped', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState());

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908');

      expect(actions).toEqual([]);
      expect(mockSaveAgentState).not.toHaveBeenCalled();
    });

    it('skips running agents with a live tmux session', async () => {
      mockGetAgentStateSync.mockReturnValue(makeState({ status: 'running' }));
      mockSessionExistsSync.mockReturnValue(true);

      const actions = await handleAgentHeartbeatDeadEvent('agent-pan-1908');

      expect(actions).toEqual([]);
      expect(mockSaveAgentState).not.toHaveBeenCalled();
    });
  });
});
