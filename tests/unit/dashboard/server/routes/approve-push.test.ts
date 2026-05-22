/**
 * Route-level regression tests for the approve-push divergence guard
 * (src/dashboard/server/routes/workspaces.ts — pushApproveMain).
 *
 * The POST /api/issues/:issueId/approve handler calls pushApproveMain() after a
 * successful merge to push the result to origin/main. If origin/main has advanced
 * past the local ancestor, gitPush throws MainDivergedError; the handler must:
 *
 *   1. Return HTTP 409 (not 400 or 500)
 *   2. Mark the workspace stuck via markWorkspaceStuck()
 *   3. Include the diverged SHAs in the error message
 *   4. NOT reset local main automatically — the operator must run
 *      `git reset --hard origin/main` manually before retrying (see stuckDetails)
 *
 * The approve route deliberately refuses to auto-reset because a reset on the
 * project repo would destroy work in the projectPath. The orphaned merge commit
 * is detected in a separate guard that fires on the NEXT approve attempt and
 * surfaces explicit recovery instructions.
 *
 * pushApproveMain() is the extracted testable unit — the route calls it and
 * delegates response-building to the caller, following the project's established
 * pattern for exported route helpers (computeStuckCount, parseGitActivityParams, etc.).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGitPush = vi.fn();
const mockMarkWorkspaceStuck = vi.fn();
const mockExec = vi.fn();

// vi.hoisted so class definition is available before vi.mock() resolution
const { MainDivergedErrorClass } = vi.hoisted(() => {
  class MainDivergedErrorClass extends Error {
    localSha: string;
    remoteSha: string;
    constructor(msg: string, localSha: string, remoteSha: string) {
      super(msg);
      this.name = 'MainDivergedError';
      this.localSha = localSha;
      this.remoteSha = remoteSha;
    }
  }
  return { MainDivergedErrorClass };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: (...args: unknown[]) => {
      // exec(cmd, opts?, cb) — invoke callback based on mockExec result
      const cb = args[args.length - 1] as Function;
      const cmdArgs = args.slice(0, -1);
      const result = mockExec(...cmdArgs);
      if (result && typeof result.then === 'function') {
        result.then(
          () => cb(null, { stdout: '', stderr: '' }),
          (err: Error) => cb(err),
        );
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
      return { unref: vi.fn() };
    },
  };
});

vi.mock('../../../../../src/lib/git/operations.js', () => ({
  gitPush: (...args: unknown[]) => Effect.tryPromise({
    try: () => Promise.resolve(mockGitPush(...args)),
    catch: (cause) => cause as any,
  }),
  MainDivergedError: MainDivergedErrorClass,
  gitFetch: vi.fn(),
  gitForcePush: vi.fn(),
  gitMerge: vi.fn(),
}));

vi.mock('../../../../../src/lib/review-status.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/review-status.js')>();
  return {
    ...actual,
    markWorkspaceStuck: (...args: unknown[]) => mockMarkWorkspaceStuck(...args),
  };
});

// Stub out modules that workspaces.ts imports at module scope
vi.mock('../../../../../src/lib/projects.js', () => ({ resolveProjectFromIssue: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/service.js', () => ({ getCloisterService: vi.fn() }));
vi.mock('../../../../../src/lib/agents.js', () => ({
  listRunningAgents: vi.fn().mockReturnValue([]),
  listRunningAgentsSync: vi.fn().mockReturnValue([]),
  getAgentState: vi.fn(),
  getAgentStateSync: vi.fn(),
  saveAgentState: vi.fn(),
  saveAgentStateSync: vi.fn(),
  messageAgent: vi.fn(),
  saveAgentRuntimeState: vi.fn(),
  getAgentRuntimeState: vi.fn(),
  getAgentRuntimeStateSync: vi.fn(),
  transitionIssueToInReview: vi.fn(),
}));
vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: vi.fn(() => ({ prepare: vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() })) })),
  resetDatabase: vi.fn(),
}));

// ─── Import under test (after mocks) ─────────────────────────────────────────

import { pushApproveMain } from '../../../../../src/dashboard/server/routes/workspaces.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

const ISSUE_ID = 'PAN-653-PUSH-TEST';
const PROJECT_PATH = '/tmp/test-project';

beforeEach(() => {
  vi.clearAllMocks();
  // exec succeeds by default (covers the git reset --hard origin/main call)
  mockExec.mockResolvedValue(undefined);
});

describe('pushApproveMain — approve route divergence guard', () => {
  it('returns { pushed: true } when gitPush succeeds', async () => {
    mockGitPush.mockResolvedValue(undefined);

    const result = await pushApproveMain(ISSUE_ID, PROJECT_PATH);

    expect(result.pushed).toBe(true);
    expect(mockMarkWorkspaceStuck).not.toHaveBeenCalled();
  });

  it('returns httpStatus=409 and calls markWorkspaceStuck when MainDivergedError is thrown', async () => {
    const localSha = 'abc1234abcd';
    const remoteSha = 'xyz9876xyz9';
    mockGitPush.mockRejectedValue(
      new MainDivergedErrorClass('main diverged', localSha, remoteSha),
    );

    const result = await pushApproveMain(ISSUE_ID, PROJECT_PATH);

    expect(result.pushed).toBe(false);
    if (!result.pushed) {
      // HTTP 409 — not 400 or 500
      expect(result.httpStatus).toBe(409);
      // Error message includes both abbreviated SHAs
      expect(result.error).toContain(remoteSha.slice(0, 7));
      expect(result.error).toContain(localSha.slice(0, 7));
      expect(result.error).toContain('stuck');
    }

    // markWorkspaceStuck must be called with the diverged SHAs
    expect(mockMarkWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE_ID,
      'main_diverged',
      expect.objectContaining({ localSha, remoteSha }),
    );
  });

  it('returns httpStatus=400 (not 409) for non-divergence push failures', async () => {
    mockGitPush.mockRejectedValue(new Error('remote: Permission denied'));

    const result = await pushApproveMain(ISSUE_ID, PROJECT_PATH);

    expect(result.pushed).toBe(false);
    if (!result.pushed) {
      expect(result.httpStatus).toBe(400);
      expect(result.error).toContain('push failed');
    }

    // Must not mark workspace stuck for a plain push failure
    expect(mockMarkWorkspaceStuck).not.toHaveBeenCalled();
  });

  it('passes issueId and projectPath correctly to gitPush', async () => {
    mockGitPush.mockResolvedValue(undefined);

    await pushApproveMain(ISSUE_ID, PROJECT_PATH);

    expect(mockGitPush).toHaveBeenCalledWith(
      PROJECT_PATH,
      'origin',
      'main',
      expect.objectContaining({ issueId: ISSUE_ID }),
    );
  });

  // Regression: approve → divergence → workspace marked stuck, NO implicit hard-reset.
  // Recovery instructions are surfaced in the error message; the user must explicitly
  // run `git reset --hard origin/main` before retrying (not done automatically).
  it('marks workspace stuck on divergence without resetting local main', async () => {
    const localSha = 'aaa1111aaaa';
    const remoteSha = 'bbb2222bbbb';
    mockGitPush.mockRejectedValue(
      new MainDivergedErrorClass('main diverged', localSha, remoteSha),
    );

    const result = await pushApproveMain(ISSUE_ID, PROJECT_PATH);

    expect(result.pushed).toBe(false);
    // No implicit git reset — the hard-reset is destructive and must be user-initiated
    expect(mockExec).not.toHaveBeenCalledWith(
      'git reset --hard origin/main',
      expect.anything(),
    );
    expect(mockMarkWorkspaceStuck).toHaveBeenCalledWith(
      ISSUE_ID,
      'main_diverged',
      expect.objectContaining({ localSha, remoteSha }),
    );
    // Error message must include recovery instructions so the user knows what to do
    if (!result.pushed) {
      expect(result.error).toMatch(/git reset --hard origin\/main/);
    }
  });
});
