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
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
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
const mockGetDashboardApiUrl = vi.fn().mockReturnValue('http://localhost:3000');
const mockGetVBriefACStatus = vi.fn().mockReturnValue(null);

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn };
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
});
