/**
 * Tests for git/operations.ts — gitFetch, gitForcePush, gitMerge (PAN-653).
 *
 * Uses a mocked child_process.exec so no real git repo is required.
 * appendGitOperation is mocked so no SQLite DB is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── child_process mock — must be hoisted before any import ───────────────────

const execMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function exec(cmd: string, optsOrCb: unknown, maybeCb?: unknown) {
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as (
      err: Error | null, out: string, errOut: string) => void;
    const result = execMock(cmd) as { stdout: string } | undefined;
    cb(null, result?.stdout ?? '', '');
    return {} as ReturnType<typeof import('child_process').exec>;
  }

  // Async promisify target — awaits execMock so mockResolvedValueOnce/mockRejectedValueOnce work
  (exec as unknown as Record<symbol, unknown>)[kCustom] = async (cmd: string) => {
    const result = await execMock(cmd) as { stdout: string } | undefined;
    return { stdout: result?.stdout ?? '', stderr: '' };
  };

  // execFile mock — delegates to execMock with joined args so existing test setups work
  function execFile(file: string, args: string[], optsOrCb: unknown, maybeCb?: unknown) {
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : typeof maybeCb === 'function' ? maybeCb : undefined) as (
      err: Error | null, stdout: string, stderr: string) => void | undefined;
    const cmd = [file, ...args].join(' ');
    const result = execMock(cmd) as { stdout: string } | undefined;
    if (cb) cb(null, result?.stdout ?? '', '');
    return {} as ReturnType<typeof import('child_process').execFile>;
  }

  (execFile as unknown as Record<symbol, unknown>)[kCustom] = async (file: string, args: string[]) => {
    const cmd = [file, ...args].join(' ');
    const result = await execMock(cmd) as { stdout: string } | undefined;
    return { stdout: result?.stdout ?? '', stderr: '' };
  };

  return { exec, execFile };
});

// ── appendGitOperation mock ───────────────────────────────────────────────────

const mockAppend = vi.fn();
vi.mock('../../../src/lib/git-activity.js', () => ({
  appendGitOperation: (...args: unknown[]) => mockAppend(...args),
}));

// ── Import module under test (after mocks) ────────────────────────────────────

import { gitFetch, gitForcePush, gitMerge, gitPush, MainDivergedError } from '../../../src/lib/git/operations.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const LOCAL_SHA  = 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111';
const REMOTE_SHA = 'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';
const AFTER_SHA  = 'cccc3333cccc3333cccc3333cccc3333cccc3333';

function mockRevParse(sha: string) {
  execMock.mockResolvedValueOnce({ stdout: sha });
}

// ─── gitPush ─────────────────────────────────────────────────────────────────

describe('gitPush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws MainDivergedError and records main_diverged when merge-base exits with code 1', async () => {
    mockRevParse(LOCAL_SHA);   // git rev-parse HEAD
    execMock.mockResolvedValueOnce({ stdout: '' });  // git fetch
    mockRevParse(REMOTE_SHA);  // git rev-parse origin/main
    // merge-base exits 1 = not an ancestor (true divergence)
    const notAncestorErr = Object.assign(new Error(''), { code: 1 });
    execMock.mockRejectedValueOnce(notAncestorErr);

    await expect(gitPush('/repo', 'origin', 'main', { issueId: 'PAN-10' }))
      .rejects.toBeInstanceOf(MainDivergedError);
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'main_diverged',
      status: 'aborted',
      issueId: 'PAN-10',
    }));
  });

  it('rethrows real git errors without recording main_diverged when merge-base exits non-1', async () => {
    mockRevParse(LOCAL_SHA);
    execMock.mockResolvedValueOnce({ stdout: '' });  // git fetch
    mockRevParse(REMOTE_SHA);
    // merge-base exits 128 = bad object / repo error — not a divergence
    const badObjectErr = Object.assign(new Error('fatal: not a commit'), { code: 128 });
    execMock.mockRejectedValueOnce(badObjectErr);

    await expect(gitPush('/repo', 'origin', 'main', { issueId: 'PAN-10' }))
      .rejects.toThrow('fatal: not a commit');
    expect(mockAppend).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: 'main_diverged',
    }));
  });
});

// ─── gitFetch ────────────────────────────────────────────────────────────────

describe('gitFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls git fetch and records a success operation', async () => {
    execMock.mockResolvedValueOnce({ stdout: '' }); // git fetch origin branch

    await gitFetch('/repo', 'origin', 'main', { issueId: 'PAN-1' });

    expect(execMock).toHaveBeenCalledWith(expect.stringContaining('git fetch origin main'));
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'fetch',
      status: 'success',
      issueId: 'PAN-1',
    }));
  });

  it('records a failure and re-throws when git fetch fails', async () => {
    const fetchErr = new Error('network error');
    execMock.mockRejectedValueOnce(fetchErr);

    await expect(gitFetch('/repo', 'origin', 'main')).rejects.toThrow('network error');
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'fetch',
      status: 'failure',
    }));
  });

  it('fetches the whole remote when no branch is specified', async () => {
    execMock.mockResolvedValueOnce({ stdout: '' });
    await gitFetch('/repo');
    expect(execMock).toHaveBeenCalledWith(expect.stringMatching(/git fetch origin$/));
  });
});

// ─── gitForcePush ─────────────────────────────────────────────────────────────

describe('gitForcePush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls git push --force-with-lease and records success', async () => {
    mockRevParse(LOCAL_SHA);   // HEAD before push (gitRevParse)
    mockRevParse(REMOTE_SHA);  // origin/main (gitRevParse)
    execMock.mockResolvedValueOnce({ stdout: '' });   // git push --force-with-lease
    mockRevParse(AFTER_SHA);   // HEAD after push (gitRevParse)

    await gitForcePush('/repo', 'origin', 'main', { issueId: 'PAN-2' });

    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('--force-with-lease origin main')
    );
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'force_push',
      status: 'success',
      issueId: 'PAN-2',
      beforeSha: LOCAL_SHA,
      afterSha: AFTER_SHA,
      remoteSha: REMOTE_SHA,
    }));
  });

  it('records failure and re-throws when force-push is rejected', async () => {
    mockRevParse(LOCAL_SHA);
    execMock.mockResolvedValueOnce({ stdout: '' }); // origin/main rev-parse returns empty → null
    const pushErr = new Error('rejected by remote');
    execMock.mockRejectedValueOnce(pushErr);

    await expect(gitForcePush('/repo')).rejects.toThrow('rejected by remote');
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'force_push',
      status: 'failure',
    }));
  });
});

// ─── gitMerge ─────────────────────────────────────────────────────────────────

describe('gitMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls git merge and records success', async () => {
    mockRevParse(LOCAL_SHA);   // HEAD before merge
    execMock.mockResolvedValueOnce({ stdout: '' });   // git merge feature-branch
    mockRevParse(AFTER_SHA);   // HEAD after merge

    await gitMerge('/repo', 'feature-branch', { issueId: 'PAN-3' });

    expect(execMock).toHaveBeenCalledWith(expect.stringContaining('git merge feature-branch'));
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'merge',
      status: 'success',
      issueId: 'PAN-3',
      beforeSha: LOCAL_SHA,
      afterSha: AFTER_SHA,
    }));
  });

  it('passes --no-ff flag when noFf option is set', async () => {
    mockRevParse(LOCAL_SHA);
    execMock.mockResolvedValueOnce({ stdout: '' });
    mockRevParse(AFTER_SHA);

    await gitMerge('/repo', 'feature-branch', { noFf: true });
    expect(execMock).toHaveBeenCalledWith(expect.stringContaining('--no-ff feature-branch'));
  });

  it('records failure and re-throws on merge conflict', async () => {
    mockRevParse(LOCAL_SHA);
    const mergeErr = new Error('CONFLICT (content): Merge conflict in file.ts');
    execMock.mockRejectedValueOnce(mergeErr);

    await expect(gitMerge('/repo', 'feature-branch')).rejects.toThrow('CONFLICT');
    expect(mockAppend).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'merge',
      status: 'failure',
    }));
  });
});
