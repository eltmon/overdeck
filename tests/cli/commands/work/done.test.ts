/**
 * Command-level tests for doneCommand behavior.
 *
 * Focuses on behaviors that remain stable across the pre-flight extraction
 * refactor (bead-241):
 *  - Issue-id normalization via resolveIssueId
 *  - --force bypasses pre-flight checks
 *  - Shadow mode skips tracker update, calls updateShadowState
 *  - Dashboard-unreachable path completes gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Module-level mocks (hoisted before imports) ────────────────────────────

const mockExecFn = vi.fn();
const mockGetAgentState = vi.fn();
const mockSaveAgentState = vi.fn();
const mockSaveAgentRuntimeState = vi.fn();
const mockShouldSkipTrackerUpdate = vi.fn();
const mockUpdateShadowState = vi.fn();
const mockEnsureMergeSetForIssue = vi.fn().mockReturnValue(null);
const mockRebaseAndPushRepos = vi.fn();
const mockCreateReviewArtifactsForIssue = vi.fn().mockResolvedValue({ artifacts: [], mergeSet: null });
const mockSetReviewStatus = vi.fn();
const mockGetReviewStatus = vi.fn().mockReturnValue(null);
const mockGetDashboardApiUrl = vi.fn().mockReturnValue('http://localhost:3000');
const mockGetVBriefACStatus = vi.fn().mockReturnValue(null);

// execFile mock delegates to mockExecFn so tests that only set up exec
// implementations also cover the bd list calls done-preflight makes via execFile.
const mockExecFileFn = vi.fn((...args: any[]) => {
  const lastArg = args[args.length - 1];
  const callback = typeof lastArg === 'function' ? lastArg : undefined;
  const file = args[0];
  const cmdArgs = Array.isArray(args[1]) ? args[1] : [];
  const cmd = [file, ...cmdArgs].join(' ');
  if (callback) {
    return mockExecFn(cmd, {}, callback);
  }
  return Promise.resolve({ stdout: '', stderr: '' });
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn, execFile: mockExecFileFn };
});

vi.mock('../../../../src/lib/agents.js', () => ({
  getAgentState: mockGetAgentState,
  saveAgentState: mockSaveAgentState,
  saveAgentRuntimeState: mockSaveAgentRuntimeState,
}));

vi.mock('../../../../src/lib/shadow-mode.js', () => ({
  shouldSkipTrackerUpdate: mockShouldSkipTrackerUpdate,
}));

vi.mock('../../../../src/lib/shadow-state.js', () => ({
  updateShadowState: mockUpdateShadowState,
  markAsSynced: vi.fn(),
}));

vi.mock('../../../../src/lib/merge-set.js', () => ({
  ensureMergeSetForIssue: mockEnsureMergeSetForIssue,
}));

vi.mock('../../../../src/lib/rebase-helper.js', () => ({
  rebaseAndPushRepos: mockRebaseAndPushRepos,
}));

vi.mock('../../../../src/lib/review-artifacts.js', () => ({
  createReviewArtifactsForIssue: mockCreateReviewArtifactsForIssue,
}));

vi.mock('../../../../src/lib/review-status.js', () => ({
  setReviewStatus: mockSetReviewStatus,
  getReviewStatus: mockGetReviewStatus,
}));

vi.mock('../../../../src/lib/config.js', () => ({
  getDashboardApiUrl: mockGetDashboardApiUrl,
}));

vi.mock('../../../../src/lib/shadow-utils.js', () => ({
  getLinearApiKey: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: mockGetVBriefACStatus,
  syncBeadStatusToVBrief: vi.fn().mockReturnValue(null),
}));

// Suppress ora spinner output in tests
vi.mock('ora', () => ({
  default: () => ({
    start: () => ({ text: '', succeed: vi.fn(), fail: vi.fn(), warn: vi.fn(), stop: vi.fn() }),
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockGetReviewStatus.mockReset();
  mockGetReviewStatus.mockReturnValue(null);
  mockSetReviewStatus.mockClear();
});

function makeAgentState(workspace: string) {
  return {
    id: 'agent-pan-714',
    issueId: 'PAN-714',
    workspace,
    status: 'running',
    lastActivity: new Date().toISOString(),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('resolveIssueId normalization', () => {
  it('converts agent-pan-714 to PAN-714', async () => {
    const { resolveIssueId } = await import('../../../../src/lib/issue-id.js');
    expect(resolveIssueId('agent-pan-714')).toBe('PAN-714');
  });

  it('converts pan-714 (lowercase) to PAN-714', async () => {
    const { resolveIssueId } = await import('../../../../src/lib/issue-id.js');
    expect(resolveIssueId('pan-714')).toBe('PAN-714');
  });

  it('preserves already-normalized PAN-714', async () => {
    const { resolveIssueId } = await import('../../../../src/lib/issue-id.js');
    expect(resolveIssueId('PAN-714')).toBe('PAN-714');
  });

  it('strips agent- prefix case-insensitively', async () => {
    const { resolveIssueId } = await import('../../../../src/lib/issue-id.js');
    expect(resolveIssueId('AGENT-MIN-42')).toBe('MIN-42');
  });

  it('uppercases the result regardless of input case', async () => {
    const { resolveIssueId } = await import('../../../../src/lib/issue-id.js');
    expect(resolveIssueId('min-42')).toBe('MIN-42');
  });
});

describe('doneCommand --force bypass', () => {
  let tempDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetAgentState.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockUpdateShadowState.mockReset();
    mockCreateReviewArtifactsForIssue.mockResolvedValue({ artifacts: [], mergeSet: null });
    mockEnsureMergeSetForIssue.mockReturnValue(null);

    tempDir = mkdtempSync(join(tmpdir(), 'pan-done-test-'));
    // Create .git to trigger monorepo path in checkUncommittedChanges
    mkdirSync(join(tempDir, '.git'));

    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    exitSpy.mockRestore();
  });

  it('calls process.exit(1) when open beads exist (no --force)', async () => {
    // Return agent state so pre-flight runs
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    // bd list returns an open bead → preflight failure
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify([{ id: 'bead-open', title: 'Unfinished task' }]), stderr: '' });
    });

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('pan-714');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does NOT call process.exit(1) from pre-flight when --force is set', async () => {
    // With force, pre-flight is bypassed entirely — bd list is never called
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '', stderr: '' });
    });
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    // This will proceed past pre-flight. It may fail at review artifacts (mocked to resolve),
    // but process.exit(1) should NOT be called by the pre-flight block.
    await doneCommand('pan-714', { force: true });

    // process.exit should not have been called with 1 from pre-flight
    const exitCalls = exitSpy.mock.calls;
    const preflightExit = exitCalls.find(([code]) => code === 1);
    expect(preflightExit).toBeUndefined();
  });
});

describe('doneCommand shadow mode', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetAgentState.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockUpdateShadowState.mockReset();
    mockCreateReviewArtifactsForIssue.mockResolvedValue({ artifacts: [], mergeSet: null });
    mockEnsureMergeSetForIssue.mockReturnValue(null);

    tempDir = mkdtempSync(join(tmpdir(), 'pan-done-shadow-'));
    mkdirSync(join(tempDir, '.git'));
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('calls updateShadowState when shouldSkipTrackerUpdate returns true', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    // Differentiate bd commands (return JSON) vs git status (return empty = clean)
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        // git status --porcelain: empty = clean working tree
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714');

    expect(mockUpdateShadowState).toHaveBeenCalledWith('PAN-714', 'in_review', 'pan done');
  });
});

describe('doneCommand dashboard-unreachable graceful path', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetAgentState.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockUpdateShadowState.mockReset();
    mockCreateReviewArtifactsForIssue.mockResolvedValue({ artifacts: [], mergeSet: null });
    mockEnsureMergeSetForIssue.mockReturnValue(null);

    tempDir = mkdtempSync(join(tmpdir(), 'pan-done-dash-'));
    mkdirSync(join(tempDir, '.git'));
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('completes successfully even when dashboard HTTP check fails', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '[]', stderr: '' });
    });
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);
    // getDashboardApiUrl returning something that won't respond is fine because
    // checkDashboard uses http.request with error handler that resolves(false).
    mockGetDashboardApiUrl.mockReturnValue('http://localhost:19999');

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');

    // Should not throw — dashboard unreachable is handled gracefully
    await expect(doneCommand('PAN-714', { force: true })).resolves.not.toThrow();
  });

  it('does not rewrite continue.json when the latest end entry already matches', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '[]', stderr: '' });
    });
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);
    mockGetDashboardApiUrl.mockReturnValue('http://localhost:19999');

    const panDir = join(tempDir, '.pan');
    mkdirSync(panDir, { recursive: true });
    const continuePath = join(panDir, 'continue.json');
    writeFileSync(continuePath, JSON.stringify({
      version: '1',
      issueId: 'PAN-714',
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-01T00:00:00.000Z',
      gitState: {},
      decisions: [],
      hazards: [],
      resumePoint: null,
      beadsMapping: {},
      sessionHistory: [{
        timestamp: '2026-01-01T00:00:00.000Z',
        reason: 'end',
        note: 'Agent signaled work complete',
      }],
      feedback: [],
    }, null, 2));
    const before = readFileSync(continuePath, 'utf-8');

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714', { force: true });

    expect(readFileSync(continuePath, 'utf-8')).toBe(before);
  });

  it('does not skip review when stored merged status is stale', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('git merge-base --is-ancestor')) {
        cb(new Error('not merged'), '', '');
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);
    mockGetReviewStatus.mockReturnValue({ mergeStatus: 'merged' });
    mockCreateReviewArtifactsForIssue.mockResolvedValue({
      artifacts: [{ skipped: false, url: 'https://example.test/pr/714' }],
      mergeSet: {
        workspaceType: 'monorepo',
        repos: [{ repoKey: 'panopticon-cli', targetBranch: 'main' }],
      },
    });
    mockGetDashboardApiUrl.mockReturnValue('http://localhost:19999');

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714', { force: true });

    expect(mockSetReviewStatus).toHaveBeenCalledWith('PAN-714', expect.objectContaining({
      reviewStatus: 'pending',
      testStatus: 'pending',
      mergeStatus: 'pending',
    }));
  });
});

describe('doneCommand preflight failure paths', () => {
  let tempDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetAgentState.mockReset();
    mockShouldSkipTrackerUpdate.mockReset();
    mockUpdateShadowState.mockReset();
    mockGetVBriefACStatus.mockReturnValue(null);
    mockCreateReviewArtifactsForIssue.mockResolvedValue({ artifacts: [], mergeSet: null });
    mockEnsureMergeSetForIssue.mockReturnValue(null);

    tempDir = mkdtempSync(join(tmpdir(), 'pan-done-preflight-'));
    mkdirSync(join(tempDir, '.git'));
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    exitSpy.mockRestore();
  });

  it('calls process.exit(1) when uncommitted changes exist', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else if (cmd.includes('git status --porcelain')) {
        // Dirty working tree — uncommitted changes
        cb(null, { stdout: ' M src/dirty.ts\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('calls process.exit(1) when vBRIEF acceptance criteria are incomplete', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        // Clean git state so uncommitted-changes check passes
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockGetVBriefACStatus.mockReturnValue({
      allCompleted: false,
      totalPending: 1,
      totalCount: 2,
      items: [
        {
          itemTitle: 'Feature X',
          pending: 1,
          criteria: [{ title: 'Should do Y', status: 'pending' }],
        },
      ],
    });

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does NOT exit(1) when only .pan/spec.vbrief.json is dirty (stale from prior run)', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);

    // Simulate stale spec.vbrief.json: dirty before the pre-preflight commit fires,
    // clean afterward (all other git status checks pass).
    let planCommitted = false;
    const capturedCmds: string[] = [];
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      capturedCmds.push(cmd);
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else if (
        cmd.includes('git status --porcelain .pan/') &&
        !planCommitted
      ) {
        // First check: stale file from prior run
        cb(null, { stdout: ' M .pan/spec.vbrief.json\n', stderr: '' });
      } else if (cmd.includes('git commit')) {
        planCommitted = true;
        cb(null, { stdout: '', stderr: '' });
      } else {
        // git add, git status (no path or post-commit), etc. → clean/success
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714');

    // Pre-flight must NOT block on the stale spec.vbrief.json
    expect(exitSpy).not.toHaveBeenCalledWith(1);
    // The stale file must have been committed before preflight ran
    expect(capturedCmds.some((c) => c.includes('git commit'))).toBe(true);
  });

  it('does NOT exit(1) when stale .pan/continue.json is dirty (other managed planning artifact)', async () => {
    mockGetAgentState.mockReturnValue(makeAgentState(tempDir));
    mockShouldSkipTrackerUpdate.mockResolvedValue(true);
    mockUpdateShadowState.mockResolvedValue(undefined);

    let planningCommitted = false;
    const capturedCmds: string[] = [];
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      capturedCmds.push(cmd);
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else if (
        cmd.includes('git status --porcelain .pan/') &&
        !planningCommitted
      ) {
        // Stale continue.json from a prior interrupted run
        cb(null, { stdout: ' M .pan/continue.json\n', stderr: '' });
      } else if (cmd.includes('git commit')) {
        planningCommitted = true;
        cb(null, { stdout: '', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const { doneCommand } = await import('../../../../src/cli/commands/done.js');
    await doneCommand('PAN-714');

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    expect(capturedCmds.some((c) => c.includes('git commit'))).toBe(true);
  });
});
