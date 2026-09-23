/**
 * Review of #4017: "inherited from main" reads the newest default-branch
 * commit whose test checks finished, not a HEAD whose CI is still running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

import {
  defaultBranchCommitTestVerdict,
  readDefaultBranchFailingTestChecks,
} from '../ci-default-branch-tests.js';

type Run = { name: string; status: string; conclusion: string | null };

/** `gh api` answers: the commit list, then each commit's check runs. */
function forge(commits: Record<string, Run[]>): void {
  execFile.mockImplementation((_file: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout?: string) => void) => {
    const path = args[1] ?? '';
    if (path.startsWith('repos/o/r/commits?')) {
      callback(null, JSON.stringify(Object.keys(commits)));
      return;
    }
    const sha = path.match(/^repos\/o\/r\/commits\/([^/]+)\/check-runs/)?.[1];
    if (sha && commits[sha]) {
      callback(null, JSON.stringify(commits[sha]));
      return;
    }
    callback(new Error(`unexpected gh call: ${args.join(' ')}`));
  });
}

const done = (name: string, conclusion: string): Run => ({ name, status: 'completed', conclusion });
const running = (name: string): Run => ({ name, status: 'in_progress', conclusion: null });

beforeEach(() => {
  execFile.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('readDefaultBranchFailingTestChecks', () => {
  it('skips a HEAD whose tests are still running and reads the previous finished run', async () => {
    forge({
      head: [running('test-shard (1/4)'), done('lint', 'success')],
      prev: [done('test-shard (1/4)', 'failure'), done('test-shard (2/4)', 'success')],
    });

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set(['test-shard (1/4)']));
  });

  it('skips a cancelled run, and reads a green one as an empty set', async () => {
    forge({
      head: [done('test', 'cancelled')],
      prev: [done('test', 'success')],
    });

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set());
  });

  it('is unknown (null) when no recent commit has a finished test run', async () => {
    forge({
      head: [running('test')],
      prev: [done('test', 'cancelled')],
    });

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toBeNull();
  });

  it('is an empty set when the default branch runs no test checks at all', async () => {
    forge({ head: [done('lint', 'success')], prev: [] });

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set());
  });

  it('is unknown (null) when the forge cannot be read', async () => {
    execFile.mockImplementation((_f: string, _a: string[], _o: unknown, callback: (err: Error) => void) => callback(new Error('gh: 502')));

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toBeNull();
  });
});

describe('defaultBranchCommitTestVerdict', () => {
  it('counts failure and timed_out, ignores non-test checks', () => {
    expect(defaultBranchCommitTestVerdict([
      done('test-e2e', 'timed_out'),
      done('test-shard (1/4)', 'success'),
      done('lint', 'failure'),
    ])).toEqual(new Set(['test-e2e']));
  });
});
