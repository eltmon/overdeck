import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, exec: execMock };
});

import {
  ForgeCommandError,
  ForgeTimeoutError,
  getCombinedCommitStatus,
  getPrLabels,
} from '../forge.js';

type ExecOptions = { timeout?: number; encoding?: BufferEncoding };
type ExecCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

function mockExec(handler: (command: string, options: ExecOptions) => { stdout: string; stderr?: string } | Error) {
  execMock.mockImplementation((command: string, options: ExecOptions | ExecCallback, callback?: ExecCallback) => {
    const cb = typeof options === 'function' ? options : callback;
    const execOptions = typeof options === 'function' ? {} : options;
    if (!cb) throw new Error('missing exec callback');

    const result = handler(command, execOptions);
    if (result instanceof Error) {
      cb(result);
    } else {
      cb(null, { stdout: result.stdout, stderr: result.stderr ?? '' });
    }
    return {};
  });
}

describe('auto-merge forge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passing status for all success, neutral, and skipped checks', async () => {
    mockExec((command, options) => {
      expect(command).toBe("gh pr checks 'https://github.com/acme/app/pull/12' --json name,conclusion");
      expect(options.timeout).toBe(5000);
      return {
        stdout: JSON.stringify([
          { name: 'build', conclusion: 'success' },
          { name: 'docs', conclusion: 'neutral' },
          { name: 'optional', conclusion: 'skipped' },
        ]),
      };
    });

    const result = await getCombinedCommitStatus('https://github.com/acme/app/pull/12');

    expect(result.passing).toBe(true);
    expect(result.checks).toEqual([
      { name: 'build', conclusion: 'success' },
      { name: 'docs', conclusion: 'neutral' },
      { name: 'optional', conclusion: 'skipped' },
    ]);
    expect(result.queriedAt).toBeTruthy();
  });

  it('returns failing status when any check conclusion is failing, cancelled, or timed out', async () => {
    mockExec(() => ({
      stdout: JSON.stringify([
        { name: 'build', conclusion: 'success' },
        { name: 'test', conclusion: 'failure' },
        { name: 'deploy', conclusion: 'cancelled' },
        { name: 'e2e', conclusion: 'timed_out' },
      ]),
    }));

    const result = await getCombinedCommitStatus('https://github.com/acme/app/pull/12');

    expect(result.passing).toBe(false);
    expect(result.checks.map((check) => check.conclusion)).toEqual(['success', 'failure', 'cancelled', 'timed_out']);
  });

  it('returns PR labels from GitHub', async () => {
    mockExec((command, options) => {
      expect(command).toBe("gh pr view 'https://github.com/acme/app/pull/12' --json labels");
      expect(options.timeout).toBe(5000);
      return {
        stdout: JSON.stringify({
          labels: [{ name: 'ready-for-merge' }, { name: 'needs-design' }],
        }),
      };
    });

    await expect(getPrLabels('https://github.com/acme/app/pull/12')).resolves.toEqual(['ready-for-merge', 'needs-design']);
  });

  it('throws ForgeTimeoutError when GitHub checks timeout', async () => {
    const timeout = Object.assign(new Error('command timed out'), { killed: true, signal: 'SIGTERM' });
    mockExec(() => timeout);

    await expect(getCombinedCommitStatus('https://github.com/acme/app/pull/12')).rejects.toBeInstanceOf(ForgeTimeoutError);
  });

  it('throws ForgeTimeoutError when GitHub labels timeout', async () => {
    const timeout = Object.assign(new Error('command timed out'), { code: 'ETIMEDOUT' });
    mockExec(() => timeout);

    await expect(getPrLabels('https://github.com/acme/app/pull/12')).rejects.toMatchObject({
      _tag: 'ForgeTimeoutError',
      operation: 'getPrLabels',
      timeoutMs: 5000,
    });
  });

  it('throws ForgeCommandError on command failures and missing pull request URLs', async () => {
    mockExec(() => new Error('not found'));

    await expect(getPrLabels('https://github.com/acme/app/pull/404')).rejects.toBeInstanceOf(ForgeCommandError);
    await expect(getCombinedCommitStatus('   ')).rejects.toMatchObject({
      _tag: 'ForgeCommandError',
      operation: 'getCombinedCommitStatus',
      message: 'Pull request URL is required',
    });
  });

  it('returns no-op GitLab gate stubs for v1', async () => {
    await expect(getCombinedCommitStatus('https://gitlab.com/acme/app/-/merge_requests/12')).resolves.toMatchObject({
      passing: true,
      checks: [],
    });
    await expect(getPrLabels('https://gitlab.com/acme/app/-/merge_requests/12')).resolves.toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
  });
});
