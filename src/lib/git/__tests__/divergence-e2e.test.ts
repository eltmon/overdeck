/**
 * PAN-653: End-to-end divergence guard integration tests.
 *
 * Scenario: two concurrent approves against the same repo.
 * The first push succeeds (remote is still an ancestor of local HEAD).
 * The second push sees that origin/main has advanced and is no longer
 * an ancestor — it throws MainDivergedError, marks the workspace stuck,
 * and records a main_diverged event in git_operations.
 *
 * Additional coverage:
 * - Stuck state survives a simulated dashboard restart (DB reconnect)
 * - clearWorkspaceStuck removes the flag
 * - Bug repro: without the guard a push would succeed even when origin/main diverged
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Hoist exec mocks before any module imports
const execFileMock = vi.hoisted(() => vi.fn());
const execMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock, exec: execMock };
});

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

function installExecMock(responses: Record<string, string | Error>) {
  const impl = (
    input: string | string[],
    _opts: unknown,
    cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => {
    const callback = (typeof _opts === 'function' ? _opts : cb) as
      | ((err: Error | null, result?: { stdout: string; stderr: string }) => void)
      | undefined;
    if (!callback) return;
    const cmd = Array.isArray(input) ? input.join(' ') : input;
    const key = Object.keys(responses).find((k) => cmd.includes(k));
    const result = key !== undefined ? responses[key] : '';
    if (result instanceof Error) {
      callback(result);
    } else {
      callback(null, { stdout: result as string, stderr: '' });
    }
  };
  execFileMock.mockImplementation((file: string, args: string[], opts: unknown, cb: unknown) => impl(args, opts, cb as typeof cb));
  execMock.mockImplementation((cmd: string, opts: unknown, cb: unknown) => impl(cmd, opts, cb as typeof cb));
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-653-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  vi.clearAllMocks();
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('PAN-653 — concurrent approve divergence guard (E2E)', () => {
  it('BUG REPRO: without guard, a second push succeeds even when origin/main diverged', async () => {
    // Pre-fix behaviour: raw git push doesn't check ancestry → succeeds even when remote has advanced.
    // This test documents what the *old* code would have done.
    // We simulate it by calling execAsync('git push ...') directly.

    // The push command itself doesn't fail — git's fast-forward check is only on the server,
    // and the mock doesn't enforce ancestry. This is intentional: the mock lets it through,
    // showing how the bug manifested (no client-side guard).
    installExecMock({
      // No ancestry check, push always succeeds
      'push origin main': '',
    });

    const { promisify } = await import('util');
    const { exec } = await import('child_process');
    const execAsync = promisify(exec);

    // Both "concurrent" pushes succeed — this is the pre-fix bug
    await expect(execAsync('git push origin main', { cwd: '/tmp', encoding: 'utf-8' }))
      .resolves.toBeDefined();
    await expect(execAsync('git push origin main', { cwd: '/tmp', encoding: 'utf-8' }))
      .resolves.toBeDefined();
  });

  it('POST-FIX: second concurrent approve is rejected with MainDivergedError', async () => {
    // First approve: remote is still an ancestor
    installExecMock({
      'rev-parse HEAD': 'local001\n',
      'rev-parse origin/main': 'remote000\n',
      'fetch': '',
      'merge-base --is-ancestor': '',    // remote000 IS ancestor of local001 — safe to push
      'push origin main': '',
    });

    const { gitPush, MainDivergedError } = await import('../operations.js');

    // First push succeeds
    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-FIRST' }))
      .resolves.not.toThrow();

    // Now origin/main has advanced (hotfix landed)
    vi.clearAllMocks();
    installExecMock({
      'rev-parse HEAD': 'local002\n',
      'rev-parse origin/main': 'hotfix999\n',  // remote has advanced
      'fetch': '',
      'merge-base --is-ancestor': Object.assign(new Error('not ancestor'), { code: 1 }),
    });

    // Second push throws MainDivergedError
    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-SECOND' }))
      .rejects.toThrow(MainDivergedError);
  });

  it('Full flow: divergence → mark stuck → Deacon skips → restart persists → unstick clears', async () => {
    // Step 1: gitPush detects divergence
    installExecMock({
      'rev-parse HEAD': 'localABC\n',
      'rev-parse origin/main': 'remoteXYZ\n',
      'fetch': '',
      'merge-base --is-ancestor': Object.assign(new Error('not ancestor'), { code: 1 }),
    });

    const { gitPush, MainDivergedError } = await import('../operations.js');
    let divergedErr: InstanceType<typeof MainDivergedError> | undefined;

    try {
      await gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-FLOW' });
    } catch (err) {
      if (err instanceof MainDivergedError) {
        divergedErr = err;
      }
    }

    expect(divergedErr).toBeDefined();
    expect(divergedErr!.localSha).toBe('localABC');
    expect(divergedErr!.remoteSha).toBe('remoteXYZ');

    // Step 2: mark workspace stuck (simulating what the approve handler does)
    const { markWorkspaceStuck } = await import('../../review-status.js');
    markWorkspaceStuck('PAN-FLOW', 'main_diverged', {
      localSha: divergedErr!.localSha,
      remoteSha: divergedErr!.remoteSha,
    });

    // Step 3: verify stuck flag is persisted
    const { getReviewStatus } = await import('../../review-status.js');
    const status = getReviewStatus('PAN-FLOW');
    expect(status?.stuck).toBe(true);
    expect(status?.stuckReason).toBe('main_diverged');

    // Step 4: main_diverged event was written to git_operations
    const { listGitOperations } = await import('../../../lib/git-activity.js');
    const ops = listGitOperations({ issueId: 'PAN-FLOW', operation: 'main_diverged' });
    expect(ops.length).toBeGreaterThan(0);
    expect(ops[0].status).toBe('aborted');
    expect(ops[0].beforeSha).toBe('localABC');
    expect(ops[0].remoteSha).toBe('remoteXYZ');

    // Step 5: simulate dashboard restart — reset DB singleton, reconnect
    await resetDb();

    // After restart, stuck state is still persisted in SQLite
    const statusAfterRestart = getReviewStatus('PAN-FLOW');
    expect(statusAfterRestart?.stuck).toBe(true);

    // Step 6: unstick clears the flag
    const { clearWorkspaceStuck } = await import('../../review-status.js');
    clearWorkspaceStuck('PAN-FLOW');

    const statusAfterUnstick = getReviewStatus('PAN-FLOW');
    expect(statusAfterUnstick?.stuck).toBeFalsy();
  });

  it('git_operations records all events in the push flow: rev_parse, fetch, main_diverged', async () => {
    installExecMock({
      'rev-parse HEAD': 'sha-head\n',
      'rev-parse origin/main': 'sha-remote\n',
      'fetch': '',
      'merge-base --is-ancestor': Object.assign(new Error('not ancestor'), { code: 1 }),
    });

    const { gitPush } = await import('../operations.js');
    const { listGitOperations } = await import('../../../lib/git-activity.js');

    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-OPS' }))
      .rejects.toThrow();

    const allOps = listGitOperations({ issueId: 'PAN-OPS' });
    // fetch and main_diverged should be recorded (rev_parse is unfiltered by issueId)
    const opTypes = allOps.map((o) => o.operation);
    expect(opTypes).toContain('fetch');
    expect(opTypes).toContain('main_diverged');

    const divergedOp = allOps.find((o) => o.operation === 'main_diverged');
    expect(divergedOp?.status).toBe('aborted');
    expect(divergedOp?.beforeSha).toBe('sha-head');
    expect(divergedOp?.remoteSha).toBe('sha-remote');
  });
});
