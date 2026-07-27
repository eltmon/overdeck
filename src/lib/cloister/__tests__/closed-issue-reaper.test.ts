import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  emitActivityEntrySync: vi.fn(),
  reconcileMergedDockerCleanupQueue: vi.fn(),
  exec: vi.fn(),
  loadReviewStatuses: vi.fn(),
  getReviewStatusesSync: vi.fn(),
  isIssueClosed: vi.fn(),
  isTrackerIssueClosed: vi.fn(),
  readJournalStatus: vi.fn(),
  listRunningAgents: vi.fn(),
  listProjectsSync: vi.fn(),
  listSessionNames: vi.fn(),
  reapIssueResidue: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  setReviewStatusSync: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: mocks.exec,
  };
});

vi.mock('../../agents.js', () => ({
  listRunningAgents: mocks.listRunningAgents,
  stopAgent: mocks.stopAgent,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../paths.js', () => ({
  get AGENTS_DIR() {
    return `${process.env.OVERDECK_HOME ?? '/tmp'}/agents`;
  },
}));

vi.mock('../../projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
}));

vi.mock('../../pan-dir/record.js', () => ({
  resolveProjectForIssue: mocks.resolveProjectForIssue,
}));

vi.mock('../../tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
  isTrackerIssueClosed: mocks.isTrackerIssueClosed,
}));

vi.mock('../reap-issue-residue.js', () => ({
  reapIssueResidue: mocks.reapIssueResidue,
}));

vi.mock('../../review-status.js', () => ({
  getReviewStatusesSync: mocks.getReviewStatusesSync,
  loadReviewStatuses: mocks.loadReviewStatuses,
  setReviewStatusSync: mocks.setReviewStatusSync,
}));

vi.mock('../../overdeck/review-status-record-sync.js', () => ({
  readJournalStatus: mocks.readJournalStatus,
}));

vi.mock('../merged-docker-cleanup-worker.js', () => ({
  reconcileMergedDockerCleanupQueue: mocks.reconcileMergedDockerCleanupQueue,
}));

import {
  reapClosedIssueReviewRequests,
  reconcileClosedIssueAgents,
  REVIEW_REQUEST_CLOSURE_CHECK_CONCURRENCY,
} from '../closed-issue-reaper.js';

describe('reconcileClosedIssueAgents', () => {
  let overdeckHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    overdeckHome = mkdtempSync(join(tmpdir(), 'closed-issue-reaper-'));
    process.env.OVERDECK_HOME = overdeckHome;
    delete process.env.OVERDECK_NO_RESUME;
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.listProjectsSync.mockReturnValue([]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.loadReviewStatuses.mockReturnValue({});
    mocks.getReviewStatusesSync.mockReturnValue({});
    mocks.readJournalStatus.mockResolvedValue(null);
    mocks.reapIssueResidue.mockResolvedValue([]);
    mocks.resolveProjectForIssue.mockReturnValue(null);
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.reconcileMergedDockerCleanupQueue.mockImplementation(
      (issueIds: string[]) => issueIds.map((issueId) => `Queued merged-issue Docker cleanup for ${issueId}`),
    );
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.isTrackerIssueClosed.mockResolvedValue(false);
    mocks.exec.mockImplementation((_command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });
  });

  afterEach(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
    delete process.env.OVERDECK_NO_RESUME;
  });

  it('stops running agents whose parent issue is closed', async () => {
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-1613-ship', issueId: 'PAN-1613', role: 'ship', status: 'running' },
      { id: 'agent-pan-1614', issueId: 'PAN-1614', role: 'work', status: 'running' },
      { id: 'agent-pan-1615', issueId: 'PAN-1615', role: 'work', status: 'stopped' },
    ]));
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-1613');

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped agent-pan-1613-ship — parent issue PAN-1613 is closed',
    ]);

    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledWith('agent-pan-1613-ship');
    expect(mocks.emitActivityEntrySync).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'info',
      issueId: 'PAN-1613',
      message: '[deacon] reaped agent-pan-1613-ship — parent issue PAN-1613 is closed',
    }));
  });

  it('does not stop open issues, verifying-on-main issues, or already stopped agents', async () => {
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-2001', issueId: 'PAN-2001', role: 'work', status: 'running' },
      { id: 'agent-pan-2002-ship', issueId: 'PAN-2002', role: 'ship', status: 'running' },
      { id: 'agent-pan-2003', issueId: 'PAN-2003', role: 'work', status: 'stopped' },
    ]));
    mocks.isIssueClosed.mockResolvedValue(false);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.stopAgent).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntrySync).not.toHaveBeenCalled();
  });

  it('evaluates isIssueClosed once per distinct issue per pass and is idempotent after agents are stopped', async () => {
    mocks.listRunningAgents
      .mockReturnValueOnce(Effect.succeed([
        { id: 'agent-pan-3001', issueId: 'PAN-3001', role: 'work', status: 'running' },
        { id: 'agent-pan-3001-review', issueId: 'PAN-3001', role: 'review', status: 'running' },
      ]))
      .mockReturnValueOnce(Effect.succeed([
        { id: 'agent-pan-3001', issueId: 'PAN-3001', role: 'work', status: 'stopped' },
        { id: 'agent-pan-3001-review', issueId: 'PAN-3001', role: 'review', status: 'stopped' },
      ]));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped agent-pan-3001 — parent issue PAN-3001 is closed',
      'Reaped agent-pan-3001-review — parent issue PAN-3001 is closed',
    ]);
    expect(mocks.isIssueClosed).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);
    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });

  it('stops inspect-shaped tmux sessions whose parent issue is closed', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed([
      'inspect-pan-1613-workspace-rn3ha',
      'inspect-pan-1614-workspace-b95lw',
      'agent-pan-1613',
    ]));
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-1613');

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped inspect-pan-1613-workspace-rn3ha — parent issue PAN-1613 is closed',
    ]);

    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledWith('inspect-pan-1613-workspace-rn3ha');
    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-1613');
    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-1614');
  });

  it('stops strike-shaped tmux sessions whose parent issue is closed (PAN-1721)', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed([
      'strike-pan-1716',
      'strike-pan-1717',
      'agent-pan-1716',
    ]));
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-1716');

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped strike-pan-1716 — parent issue PAN-1716 is closed',
    ]);

    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledWith('strike-pan-1716');
  });

  it('reaps closed-issue agents even when OVERDECK_NO_RESUME was set at boot', async () => {
    process.env.OVERDECK_NO_RESUME = '1';
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-1613', issueId: 'PAN-1613', role: 'work', status: 'running' },
    ]));
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['inspect-pan-1613-workspace-rn3ha']));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped agent-pan-1613 — parent issue PAN-1613 is closed',
      'Reaped inspect-pan-1613-workspace-rn3ha — parent issue PAN-1613 is closed',
    ]);

    expect(mocks.listRunningAgents).toHaveBeenCalledTimes(1);
    expect(mocks.listSessionNames).toHaveBeenCalledTimes(1);
    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-1613');
    expect(mocks.stopAgent).toHaveBeenCalledWith('agent-pan-1613');
    expect(mocks.stopAgent).toHaveBeenCalledWith('inspect-pan-1613-workspace-rn3ha');
  });

  it('reaps closed pure-disk residue discovered from configured project workspaces', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-5555'), { recursive: true });
    mocks.listProjectsSync.mockReturnValue([{ key: 'overdeck', config: { name: 'Overdeck', path: projectPath } }]);
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-5555');
    mocks.reapIssueResidue.mockResolvedValue(['removed residue PAN-5555']);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual(['removed residue PAN-5555']);

    expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
    expect(mocks.reapIssueResidue).toHaveBeenCalledWith(projectPath, 'PAN-5555');
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reaps closed pure-disk residue discovered from agent state directories', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
    mkdirSync(join(overdeckHome, 'agents', 'agent-pan-5556'), { recursive: true });
    mocks.resolveProjectForIssue.mockReturnValue({ name: 'Overdeck', path: projectPath });
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-5556');
    mocks.reapIssueResidue.mockResolvedValue(['removed agent residue PAN-5556']);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual(['removed agent residue PAN-5556']);

    expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
    expect(mocks.reapIssueResidue).toHaveBeenCalledWith(projectPath, 'PAN-5556');
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reaps closed-issue residue discovered from leaked _devnet networks', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      const stdout = String(command).includes('docker network ls')
        ? 'myn-feature-min-729_devnet\noverdeck-feature-pan-5558_devnet\nbridge\n'
        : '';
      cb?.(null, { stdout, stderr: '' });
      return { on: vi.fn() };
    });
    mocks.resolveProjectForIssue.mockImplementation((issueId: string) =>
      issueId === 'PAN-5558' ? { name: 'Overdeck', path: projectPath } : null,
    );
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-5558');
    mocks.reapIssueResidue.mockResolvedValue(['removed network residue PAN-5558']);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual(['removed network residue PAN-5558']);

    expect(mocks.isIssueClosed).toHaveBeenCalledWith('MIN-729');
    expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
    expect(mocks.reapIssueResidue).toHaveBeenCalledWith(projectPath, 'PAN-5558');
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('checks leaked devnet closure state with bounded concurrency', async () => {
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      const stdout = String(command).includes('docker network ls')
        ? Array.from({ length: 6 }, (_, index) => `overdeck-feature-pan-${6000 + index}_devnet`).join('\n')
        : '';
      cb?.(null, { stdout, stderr: '' });
      return { on: vi.fn() };
    });
    let active = 0;
    let maxActive = 0;
    const resolveChecks: Array<() => void> = [];
    mocks.isIssueClosed.mockImplementation(() => new Promise<boolean>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      resolveChecks.push(() => {
        active -= 1;
        resolve(false);
      });
    }));

    const reconciliation = reconcileClosedIssueAgents();
    await vi.waitFor(() => expect(mocks.isIssueClosed).toHaveBeenCalledTimes(4));
    expect(maxActive).toBe(4);
    resolveChecks.splice(0, 4).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(mocks.isIssueClosed).toHaveBeenCalledTimes(6));
    resolveChecks.splice(0).forEach((resolve) => resolve());

    await expect(reconciliation).resolves.toEqual([]);
    expect(maxActive).toBe(4);
  });

  it('queues merged Docker cleanup without blocking patrol or reaping non-Docker state', async () => {
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      const stdout = String(command).includes('docker network ls')
        ? 'overdeck-feature-pan-5559_devnet\nbridge\n'
        : '';
      cb?.(null, { stdout, stderr: '' });
      return { on: vi.fn() };
    });
    mocks.getReviewStatusesSync.mockReturnValue({
      'PAN-5559': { mergeStatus: 'merged' },
    });

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Queued merged-issue Docker cleanup for PAN-5559',
    ]);

    expect(mocks.getReviewStatusesSync).toHaveBeenCalledTimes(1);
    expect(mocks.getReviewStatusesSync).toHaveBeenCalledWith(['PAN-5559']);
    expect(mocks.reconcileMergedDockerCleanupQueue).toHaveBeenCalledWith(['PAN-5559']);
    expect(mocks.reapIssueResidue).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });

  it('ignores leaked devnets without merged review status', async () => {
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      const stdout = String(command).includes('docker network ls')
        ? 'overdeck-feature-pan-5559_devnet\nbridge\n'
        : '';
      cb?.(null, { stdout, stderr: '' });
      return { on: vi.fn() };
    });

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.getReviewStatusesSync).toHaveBeenCalledWith(['PAN-5559']);
    expect(mocks.reconcileMergedDockerCleanupQueue).toHaveBeenCalledWith([]);
    expect(mocks.reapIssueResidue).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });

  it('preserves queued cleanup when Docker network discovery is unavailable', async () => {
    mocks.exec.mockImplementation((_command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      cb?.(new Error('docker unavailable'), { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.reconcileMergedDockerCleanupQueue).not.toHaveBeenCalled();
  });

  it('preserves open pure-disk residue', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'open-project-'));
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-5557'), { recursive: true });
    mocks.listProjectsSync.mockReturnValue([{ key: 'overdeck', config: { name: 'Overdeck', path: projectPath } }]);
    mocks.isIssueClosed.mockResolvedValue(false);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-5557');
    expect(mocks.reapIssueResidue).not.toHaveBeenCalled();
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('clears unserviced review intent for a tracker-closed issue', async () => {
    const dbStatus = {
      issueId: 'PAN-7001',
      reviewStatus: 'pending',
      testStatus: 'pending',
      reviewRequestedAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      readyForMerge: false,
    };
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-7001': dbStatus });
    mocks.readJournalStatus.mockResolvedValue({
      updatedAt: '2026-07-02T00:00:00.000Z',
      durable: { reviewRequestedAt: '2026-07-02T00:00:00.000Z' },
    });
    mocks.isTrackerIssueClosed.mockResolvedValue(true);

    await expect(reapClosedIssueReviewRequests(new Map())).resolves.toEqual([
      'Cleared unserviced review request for PAN-7001 — parent issue is closed',
    ]);

    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
      'PAN-7001',
      { reviewRequestedAt: undefined, reviewSpawnedAt: undefined },
      expect.objectContaining({ reviewRequestedAt: '2026-07-02T00:00:00.000Z' }),
    );
    expect(mocks.emitActivityEntrySync).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'info',
      issueId: 'PAN-7001',
    }));
  });

  it('reaps review intent that exists only in the durable journal', async () => {
    const dbStatus = {
      issueId: 'PAN-7005',
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: '2026-07-01T00:00:00.000Z',
      readyForMerge: false,
    };
    mocks.loadReviewStatuses.mockReturnValue({ 'PAN-7005': dbStatus });
    mocks.readJournalStatus.mockResolvedValue({
      updatedAt: '2026-07-02T00:00:00.000Z',
      durable: { reviewRequestedAt: '2026-07-02T00:00:00.000Z' },
    });
    mocks.isTrackerIssueClosed.mockResolvedValue(true);

    await expect(reapClosedIssueReviewRequests(new Map())).resolves.toEqual([
      'Cleared unserviced review request for PAN-7005 — parent issue is closed',
    ]);

    expect(mocks.setReviewStatusSync).toHaveBeenCalledWith(
      'PAN-7005',
      { reviewRequestedAt: undefined, reviewSpawnedAt: undefined },
      expect.objectContaining({ reviewRequestedAt: '2026-07-02T00:00:00.000Z' }),
    );
  });

  it('preserves unserviced review intent for a tracker-open issue', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-7002': {
        issueId: 'PAN-7002',
        reviewStatus: 'pending',
        testStatus: 'pending',
        reviewRequestedAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        readyForMerge: false,
      },
    });
    // The broad lifecycle predicate can be true from terminal shadow state while
    // the tracker remains open. Review intent must follow the tracker itself.
    mocks.isIssueClosed.mockResolvedValue(true);
    mocks.isTrackerIssueClosed.mockResolvedValue(false);

    await expect(reapClosedIssueReviewRequests(new Map())).resolves.toEqual([]);

    expect(mocks.isTrackerIssueClosed).toHaveBeenCalledWith('PAN-7002');
    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.readJournalStatus).toHaveBeenCalledWith('PAN-7002');
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
  });

  it('checks tracker closure concurrently with a bounded batch', async () => {
    const statuses = Object.fromEntries(Array.from(
      { length: REVIEW_REQUEST_CLOSURE_CHECK_CONCURRENCY + 1 },
      (_, index) => {
        const issueId = `PAN-${7100 + index}`;
        return [issueId, {
          issueId,
          reviewStatus: 'pending',
          testStatus: 'pending',
          reviewRequestedAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
          readyForMerge: false,
        }];
      },
    ));
    mocks.loadReviewStatuses.mockReturnValue(statuses);

    let active = 0;
    let maxActive = 0;
    const firstBatchResolvers: Array<(closed: boolean) => void> = [];
    mocks.isTrackerIssueClosed.mockImplementation(() => new Promise<boolean>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      firstBatchResolvers.push((closed) => {
        active -= 1;
        resolve(closed);
      });
    }));

    const sweep = reapClosedIssueReviewRequests(new Map());
    await vi.waitFor(() => {
      expect(mocks.isTrackerIssueClosed).toHaveBeenCalledTimes(REVIEW_REQUEST_CLOSURE_CHECK_CONCURRENCY);
    });
    expect(maxActive).toBe(REVIEW_REQUEST_CLOSURE_CHECK_CONCURRENCY);
    for (const resolve of firstBatchResolvers.splice(0)) resolve(false);

    await vi.waitFor(() => {
      expect(mocks.isTrackerIssueClosed).toHaveBeenCalledTimes(REVIEW_REQUEST_CLOSURE_CHECK_CONCURRENCY + 1);
    });
    for (const resolve of firstBatchResolvers.splice(0)) resolve(false);
    await expect(sweep).resolves.toEqual([]);
    expect(mocks.readJournalStatus).toHaveBeenCalledTimes(REVIEW_REQUEST_CLOSURE_CHECK_CONCURRENCY + 1);
  });

  it('preserves serviced requests and terminal review verdicts', async () => {
    mocks.loadReviewStatuses.mockReturnValue({
      'PAN-7003': {
        issueId: 'PAN-7003',
        reviewStatus: 'pending',
        testStatus: 'pending',
        reviewRequestedAt: '2026-07-01T00:00:00.000Z',
        reviewSpawnedAt: '2026-07-01T00:00:01.000Z',
        updatedAt: '2026-07-01T00:00:01.000Z',
        readyForMerge: false,
      },
      'PAN-7004': {
        issueId: 'PAN-7004',
        reviewStatus: 'passed',
        testStatus: 'pending',
        reviewRequestedAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        readyForMerge: false,
      },
    });
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reapClosedIssueReviewRequests(new Map())).resolves.toEqual([]);

    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.setReviewStatusSync).not.toHaveBeenCalled();
  });

  it('runs the review-intent sweep once per reconciliation patrol', async () => {
    mocks.loadReviewStatuses.mockReturnValue({});

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.loadReviewStatuses).toHaveBeenCalledTimes(1);
  });
});
