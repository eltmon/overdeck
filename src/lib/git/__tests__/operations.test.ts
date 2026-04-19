/**
 * PAN-653: git operations helper wrapper tests.
 *
 * AC1: gitPush throws MainDivergedError when origin/main is not an ancestor
 * AC2: Every helper call writes exactly one row to git_operations
 * AC3: Unit tests cover success, non-fast-forward rejection, and divergence cases
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Hoist the execFile mock so it's available in vi.mock factory
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: execFileMock };
});

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../../database/index.js');
  resetDatabase();
}

/**
 * Install a mock that dispatches execFile calls based on substring matches.
 * 'rev-parse HEAD' → string or Error
 */
function installExecMock(responses: Record<string, string | Error>) {
  execFileMock.mockImplementation(
    (_file: string, args: string[], _opts: unknown, cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
      const callback = (typeof _opts === 'function' ? _opts : cb) as
        | ((err: Error | null, result?: { stdout: string; stderr: string }) => void)
        | undefined;
      if (!callback) return;
      const cmd = args.join(' ');
      const key = Object.keys(responses).find((k) => cmd.includes(k));
      const result = key !== undefined ? responses[key] : '';
      if (result instanceof Error) {
        callback(result);
      } else {
        callback(null, { stdout: result as string, stderr: '' });
      }
    }
  );
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-653-git-ops-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
  vi.clearAllMocks();
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('gitPush — divergence guard (AC1/AC3)', () => {
  it('throws MainDivergedError when origin/main is not an ancestor of local HEAD', async () => {
    installExecMock({
      'rev-parse HEAD': 'aaa111\n',
      'rev-parse origin/main': 'bbb222\n',
      'fetch': '',
      'merge-base --is-ancestor': Object.assign(new Error('not ancestor'), { code: 1 }),
    });

    const { gitPush, MainDivergedError } = await import('../operations.js');
    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-653' }))
      .rejects.toThrow(MainDivergedError);
  });

  it('records a main_diverged event in git_operations on divergence (AC2)', async () => {
    installExecMock({
      'rev-parse HEAD': 'local123\n',
      'rev-parse origin/main': 'remote456\n',
      'fetch': '',
      'merge-base --is-ancestor': Object.assign(new Error('not ancestor'), { code: 1 }),
    });

    const { gitPush } = await import('../operations.js');
    const { listGitOperations } = await import('../../../lib/git-activity.js');

    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-DIV' }))
      .rejects.toThrow();

    const ops = listGitOperations({ issueId: 'PAN-DIV', operation: 'main_diverged' });
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('aborted');
    expect(ops[0].beforeSha).toBe('local123');
    expect(ops[0].remoteSha).toBe('remote456');
  });

  it('succeeds and records push event when remote is an ancestor (AC3)', async () => {
    installExecMock({
      'rev-parse HEAD': 'local789\n',
      'rev-parse origin/main': 'remote789\n',
      'fetch': '',
      'merge-base --is-ancestor': '', // exits 0 = is ancestor
      'push origin main': '',
    });

    const { gitPush } = await import('../operations.js');
    const { listGitOperations } = await import('../../../lib/git-activity.js');

    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-OK' }))
      .resolves.not.toThrow();

    const ops = listGitOperations({ issueId: 'PAN-OK', operation: 'push' });
    expect(ops).toHaveLength(1);
    expect(ops[0].status).toBe('success');
  });

  it('records failure when git push rejects (non-fast-forward) (AC3)', async () => {
    installExecMock({
      'rev-parse HEAD': 'abc\n',
      'rev-parse origin/main': 'abc\n',
      'fetch': '',
      'merge-base --is-ancestor': '',
      'push origin main': new Error('! [rejected] main -> main (non-fast-forward)'),
    });

    const { gitPush } = await import('../operations.js');
    const { listGitOperations } = await import('../../../lib/git-activity.js');

    await expect(gitPush('/tmp/workspace', 'origin', 'main', { issueId: 'PAN-NFF' }))
      .rejects.toThrow('non-fast-forward');

    const failures = listGitOperations({ issueId: 'PAN-NFF', status: 'failure' });
    expect(failures.length).toBeGreaterThan(0);
    const pushFail = failures.find((op) => op.operation === 'push');
    expect(pushFail).toBeDefined();
    expect(pushFail?.error).toContain('non-fast-forward');
  });
});
