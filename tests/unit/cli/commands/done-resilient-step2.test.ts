/**
 * PAN-2207 step 2: `pan done` resilience when review-artifact creation fails.
 *
 * Covers:
 *  - REST fallback lookup (`gh pr list`) when createReviewArtifactsForIssue throws.
 *  - Re-throw original error when REST fallback finds no existing PR.
 *  - Clearing stale `pipeline.panDoneRecoveredAt` tombstone on re-run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

const {
  mockExecFn,
  mockGetAgentState,
  mockSaveAgentState,
  mockSaveAgentRuntimeState,
  mockShouldSkipTrackerUpdate,
  mockUpdateShadowState,
  mockCreateReviewArtifactsForIssue,
  mockSetReviewStatus,
  mockGetReviewStatus,
  mockEnsureMergeSetForIssue,
  mockResolveProjectForIssue,
  mockFindWorkspacePath,
  mockGetDashboardApiUrl,
} = vi.hoisted(() => ({
  mockExecFn: vi.fn(),
  mockGetAgentState: vi.fn(),
  mockSaveAgentState: vi.fn(),
  mockSaveAgentRuntimeState: vi.fn(),
  mockShouldSkipTrackerUpdate: vi.fn(),
  mockUpdateShadowState: vi.fn(),
  mockCreateReviewArtifactsForIssue: vi.fn(),
  mockSetReviewStatus: vi.fn(),
  mockGetReviewStatus: vi.fn().mockReturnValue(null),
  mockEnsureMergeSetForIssue: vi.fn().mockReturnValue(null),
  mockResolveProjectForIssue: vi.fn(),
  mockFindWorkspacePath: vi.fn(),
  mockGetDashboardApiUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

const mockExecFileFn = vi.hoisted(() => vi.fn((...args: any[]) => {
  const lastArg = args[args.length - 1];
  const callback = typeof lastArg === 'function' ? lastArg : undefined;
  const file = args[0];
  const cmdArgs = Array.isArray(args[1]) ? args[1] : [];
  const cmd = [file, ...cmdArgs].join(' ');
  if (callback) {
    return mockExecFn(cmd, {}, callback);
  }
  return Promise.resolve({ stdout: '', stderr: '' });
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn, execFile: mockExecFileFn };
});

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  getAgentStateSync: mockGetAgentState,
  saveAgentState: mockSaveAgentState,
  saveAgentStateSync: mockSaveAgentState,
  saveAgentRuntimeState: mockSaveAgentRuntimeState,
  saveAgentRuntimeStateSync: mockSaveAgentRuntimeState,
}));

vi.mock('../../../../src/lib/shadow-mode.js', () => ({
  shouldSkipTrackerUpdate: (...args: unknown[]) => Effect.tryPromise({
    try: () => Promise.resolve(mockShouldSkipTrackerUpdate(...args)),
    catch: (cause) => cause as any,
  }),
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  updateShadowState: (...args: unknown[]) => Effect.tryPromise({
    try: () => Promise.resolve(mockUpdateShadowState(...args)),
    catch: (cause) => cause as any,
  }),
  markAsSynced: vi.fn(),
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  ensureMergeSetForIssue: mockEnsureMergeSetForIssue,
  ensureMergeSetForIssueSync: mockEnsureMergeSetForIssue,
}));

vi.mock('../../../../src/lib/rebase-helper.js', () => ({
  rebaseAndPushRepos: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
}));

vi.mock('../../../../src/lib/review-artifacts.js', () => ({
  createReviewArtifactsForIssue: (...args: unknown[]) => Effect.tryPromise({
    try: () => Promise.resolve(mockCreateReviewArtifactsForIssue(...args)),
    catch: (cause) => cause as any,
  }),
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  setReviewStatus: mockSetReviewStatus,
  setReviewStatusSync: mockSetReviewStatus,
  getReviewStatus: mockGetReviewStatus,
  getReviewStatusSync: mockGetReviewStatus,
}));

vi.mock('../../../../src/lib/lifecycle/archive-planning.js', () => ({
  findWorkspacePath: mockFindWorkspacePath,
}));

vi.mock('../../../../src/lib/config.js', async (importActual) => ({
  ...(await importActual<typeof import('../../../../src/lib/config.js')>()),
  getDashboardApiUrl: mockGetDashboardApiUrl,
  getDashboardApiUrlSync: mockGetDashboardApiUrl,
}));

vi.mock('../../../../src/lib/shadow-utils.js', () => ({
  getLinearApiKey: vi.fn().mockReturnValue(Effect.succeed(null)),
}));

vi.mock('../../../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: vi.fn().mockReturnValue(null),
  getVBriefACStatusSync: vi.fn().mockReturnValue(null),
  syncBeadStatusToVBrief: vi.fn().mockReturnValue(Effect.succeed(null)),
}));

vi.mock('../../../../src/lib/work/test-requirement-gate.js', () => ({
  runTestRequirementCheck: vi.fn().mockReturnValue(Effect.succeed([])),
}));

vi.mock('../../../../src/lib/bd-mutex.js', () => ({
  restoreTrackedBeadsExport: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveGitHubIssueSync: vi.fn().mockReturnValue({ isGitHub: false }),
}));

// Preserve real record read/write functions; only mock project resolution.
vi.mock('../../../../src/lib/pan-dir/record.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/pan-dir/record.js')>('../../../../src/lib/pan-dir/record.js');
  return { ...actual, resolveProjectForIssue: mockResolveProjectForIssue };
});

// Suppress ora spinner output in tests
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ text: '', succeed: vi.fn(), fail: vi.fn(), warn: vi.fn(), stop: vi.fn() }),
  }),
}));

import { doneCommand } from '../../../../src/cli/commands/done.js';
import { readIssueRecordSync, writeIssueRecordSync } from '../../../../src/lib/pan-dir/record.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAgentState(workspace: string) {
  return {
    id: 'agent-pan-2207',
    issueId: 'PAN-2207',
    workspace,
    status: 'running',
    lastActivity: new Date().toISOString(),
  };
}

async function drainDonePromise(donePromise: Promise<void>) {
  let resolved = false;
  donePromise.finally(() => { resolved = true; });
  while (!resolved) {
    await vi.advanceTimersByTimeAsync(2000);
  }
  await donePromise;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PAN-2207 step 2: doneCommand review-artifact fallback', () => {
  let tempDir: string;
  let workspacePath: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetAgentState.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockUpdateShadowState.mockReset();
    mockSaveAgentState.mockClear();
    mockSaveAgentRuntimeState.mockClear();
    mockSetReviewStatus.mockClear();
    mockCreateReviewArtifactsForIssue.mockReset();
    mockEnsureMergeSetForIssue.mockReturnValue(null);
    mockGetReviewStatus.mockReset();
    mockGetReviewStatus.mockReturnValue(null);

    tempDir = mkdtempSync(join(tmpdir(), 'pan-done-resilient-'));
    workspacePath = join(tempDir, 'workspaces', 'feature-pan-2207');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, '.git'));
    mkdirSync(join(tempDir, '.pan', 'records'), { recursive: true });

    mockResolveProjectForIssue.mockReturnValue({ name: 'test', path: tempDir });
    mockFindWorkspacePath.mockReturnValue(workspacePath);
    mockGetAgentState.mockReturnValue(makeAgentState(workspacePath));
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts?: RequestInit) => ({
      status: 200, ok: true,
      json: async () => (opts?.method === 'POST' ? { success: true, queued: true } : {}),
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
    exitSpy.mockRestore();
  });

  it('falls back to REST PR lookup and completes when createReviewArtifactsForIssue throws', async () => {
    const existingPrUrl = 'https://github.com/org/repo/pull/2207';
    mockCreateReviewArtifactsForIssue.mockRejectedValue(new Error('GraphQL rate limit'));
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('gh pr list --head feature/pan-2207')) {
        cb(null, { stdout: `${existingPrUrl}\n`, stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const donePromise = doneCommand('PAN-2207', { force: true });
    await drainDonePromise(donePromise);

    // PR URL recorded both via fallback setReviewStatusSync and primary-artifact path
    expect(mockSetReviewStatus).toHaveBeenCalledWith(
      'PAN-2207',
      expect.objectContaining({ prUrl: existingPrUrl })
    );
    // reviewRequestedAt is set as part of review dispatch
    expect(mockSetReviewStatus).toHaveBeenCalledWith(
      'PAN-2207',
      expect.objectContaining({ reviewRequestedAt: expect.any(String) })
    );
    // process.exit(1) should not have been called
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('re-throws original error when REST fallback finds no existing PR', async () => {
    const originalError = new Error('GraphQL rate limit');
    mockCreateReviewArtifactsForIssue.mockRejectedValue(originalError);
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('gh pr list --head feature/pan-2207')) {
        cb(null, { stdout: '\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    await doneCommand('PAN-2207', { force: true });

    // process.exit(1) should have been called because the original error is re-thrown
    expect(exitSpy).toHaveBeenCalledWith(1);
    // No PR URL recorded, no review dispatch attempted
    expect(mockSetReviewStatus).not.toHaveBeenCalledWith(
      'PAN-2207',
      expect.objectContaining({ prUrl: expect.any(String) })
    );
  });
});

describe('PAN-2207 step 2: doneCommand clears recovery tombstone', () => {
  let tempDir: string;
  let workspacePath: string;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetAgentState.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockUpdateShadowState.mockReset();
    mockCreateReviewArtifactsForIssue.mockReset();
    mockCreateReviewArtifactsForIssue.mockResolvedValue({ artifacts: [], mergeSet: null });
    mockEnsureMergeSetForIssue.mockReturnValue(null);

    tempDir = mkdtempSync(join(tmpdir(), 'pan-done-tombstone-'));
    workspacePath = join(tempDir, 'workspaces', 'feature-pan-2207');
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(join(workspacePath, '.git'));
    mkdirSync(join(tempDir, '.pan', 'records'), { recursive: true });

    mockResolveProjectForIssue.mockReturnValue({ name: 'test', path: tempDir });
    mockFindWorkspacePath.mockReturnValue(workspacePath);
    mockGetAgentState.mockReturnValue(makeAgentState(workspacePath));
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);

    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts?: RequestInit) => ({
      status: 200, ok: true,
      json: async () => (opts?.method === 'POST' ? { success: true, queued: true } : {}),
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('clears pipeline.panDoneRecoveredAt on re-run before pre-flight checks', async () => {
    const project = { name: 'test', path: tempDir };
    const recoveredAt = new Date().toISOString();
    writeIssueRecordSync(project, 'PAN-2207', {
      issueId: 'PAN-2207',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-2207',
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: new Date().toISOString(),
        panDoneRecoveredAt: recoveredAt,
      },
      updatedAt: new Date().toISOString(),
    } as any);

    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const donePromise = doneCommand('PAN-2207', { force: true });
    await drainDonePromise(donePromise);

    const record = readIssueRecordSync(project, 'PAN-2207');
    expect(record?.pipeline?.panDoneRecoveredAt).toBeUndefined();
    expect(record?.pipeline?.reviewStatus).toBe('pending');
  });
});
