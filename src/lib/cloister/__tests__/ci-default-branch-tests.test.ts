/**
 * Review of #4017: "inherited from main" reads the newest default-branch
 * commit whose test checks finished, not a HEAD whose CI is still running.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

import {
  commitStatusAsCheckRun,
  defaultBranchCommitTestVerdict,
  readDefaultBranchFailingTestChecks,
} from '../ci-default-branch-tests.js';

type Run = { name: string; status: string; conclusion: string | null };
type Status = { name: string; state: string; targetUrl?: string };

/**
 * `gh api` answers: the commit list, each commit's check runs, and (D-shaped
 * per PAN-4589) each commit's status page — `statuses[sha]` defaults to `[]`,
 * so every pre-existing test's verdict is unchanged.
 */
function forge(commits: Record<string, Run[]>, statuses: Record<string, Status[]> = {}): void {
  execFile.mockImplementation((_file: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout?: string) => void) => {
    const path = args.find((a) => a.startsWith('repos/o/r/commits')) ?? '';
    if (path.startsWith('repos/o/r/commits?')) {
      callback(null, JSON.stringify(Object.keys(commits)));
      return;
    }
    if (path.includes('/status?')) {
      const sha = path.match(/^repos\/o\/r\/commits\/([^/]+)\/status/)?.[1] ?? '';
      callback(null, JSON.stringify(statuses[sha] ?? []));
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

  it('counts failing Dagger Cloud commit statuses with no check runs (PAN-4589)', async () => {
    const daggerUrl = (context: string) => `https://dagger.cloud/o/checks/github.com/o/r@head?check=${context}`;
    forge(
      { head: [] },
      { head: [
        { name: 'go-client/test', state: 'failure', targetUrl: daggerUrl('go-client/test') },
        { name: 'helm/lint', state: 'failure', targetUrl: daggerUrl('helm/lint') },
      ] },
    );

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set(['go-client/test']));
  });

  it('walks back past a pending Dagger test status to an older green one (PAN-4589)', async () => {
    const daggerUrl = (context: string) => `https://dagger.cloud/o/checks/github.com/o/r@sha?check=${context}`;
    forge(
      { head: [], prev: [] },
      {
        head: [{ name: 'go-client/test', state: 'pending', targetUrl: daggerUrl('go-client/test') }],
        prev: [{ name: 'go-client/test', state: 'success', targetUrl: daggerUrl('go-client/test') }],
      },
    );

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set());
  });

  it('walks past any number of no-tests (bookkeeping) commits to a failing one (PAN-4618 ac1)', async () => {
    const commits: Record<string, Run[]> = {};
    for (let i = 1; i <= 20; i += 1) commits[`bk-${i}`] = [done('reject-planning-paths', 'success')];
    commits.fail = [done('test', 'failure')];
    forge(commits);

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set(['test']));
  });

  it('walks past more than DEFAULT_BRANCH_LOOKBACK indecisive commits to a failing one (PAN-4618 ac2)', async () => {
    const commits: Record<string, Run[]> = {};
    for (let i = 1; i <= 12; i += 1) commits[`cx-${i}`] = [done('test', 'cancelled')];
    commits.fail = [done('test', 'failure')];
    forge(commits);

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set(['test']));
  });

  it('gives up after DEFAULT_BRANCH_LOOKBACK pending commits and never fetches the ones past it (PAN-4618 ac3)', async () => {
    const commits: Record<string, Run[]> = {};
    for (let i = 1; i <= 12; i += 1) commits[`pend-${i}`] = [running('test')];
    forge(commits);

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toBeNull();

    const checkRunCalls = execFile.mock.calls.filter(([, args]) =>
      (args as string[]).some((a) => a.includes('/check-runs')));
    const fetchedShas = checkRunCalls.map(([, args]) => (args as string[])
      .find((a) => a.includes('/check-runs'))!.match(/commits\/([^/]+)\/check-runs/)![1]);
    expect(fetchedShas).toEqual(['pend-1', 'pend-2', 'pend-3', 'pend-4', 'pend-5', 'pend-6', 'pend-7', 'pend-8', 'pend-9', 'pend-10']);
  });

  it('is unknown (null) when a full commit-window page carries no test checks at all (PAN-4618 ac4)', async () => {
    const commits: Record<string, Run[]> = {};
    for (let i = 1; i <= 100; i += 1) commits[`bk-${i}`] = [done('reject-planning-paths', 'success')];
    forge(commits);

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toBeNull();
  });

  it('is an empty set when a partial commit-window page carries no test checks (PAN-4618 ac4)', async () => {
    forge({ head: [done('reject-planning-paths', 'success')], prev: [], tail: [] });

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(new Set());
  });

  it('requests the commit list with per_page=100 (PAN-4618 ac4)', async () => {
    forge({ head: [done('test', 'success')] });

    await readDefaultBranchFailingTestChecks('o/r');

    expect(execFile.mock.calls.some(([, args]) =>
      (args as string[]).some((a) => a === 'repos/o/r/commits?per_page=100'))).toBe(true);
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

  it('counts an errored Dagger Cloud commit status via commitStatusAsCheckRun (PAN-4589)', () => {
    expect(defaultBranchCommitTestVerdict([
      commitStatusAsCheckRun({
        name: 'go-client/test',
        state: 'error',
        targetUrl: 'https://dagger.cloud/o/checks/github.com/o/r@x?check=go-client/test',
      }),
    ])).toEqual(new Set(['go-client/test']));
  });

  it('is indecisive for a single completed test check with conclusion cancelled (PAN-4618 ac5)', () => {
    expect(defaultBranchCommitTestVerdict([done('test', 'cancelled')])).toBe('indecisive');
  });

  it('is pending (not indecisive) when a test check is still running, even alongside a completed one', () => {
    expect(defaultBranchCommitTestVerdict([running('test-shard (1/4)'), done('test-shard (2/4)', 'cancelled')])).toBe('pending');
  });
});

describe('ghJsonPages flattening (PAN-4589)', () => {
  it('flattens every page of a paginated status call into the resolved set', async () => {
    const daggerUrl = (context: string) => `https://dagger.cloud/o/checks/github.com/o/r@head?check=${context}`;
    execFile.mockImplementation((_file: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout?: string) => void) => {
      const path = args.find((a) => a.startsWith('repos/o/r/commits')) ?? '';
      if (path.startsWith('repos/o/r/commits?')) {
        callback(null, JSON.stringify(['head']));
        return;
      }
      if (path.includes('/status?')) {
        const page1 = [{ name: 'go-client/test', state: 'failure', targetUrl: daggerUrl('go-client/test') }];
        const page2 = [{ name: 'golang/packages/tests/test', state: 'failure', targetUrl: daggerUrl('golang/packages/tests/test') }];
        callback(null, `${JSON.stringify(page1)}\n${JSON.stringify(page2)}`);
        return;
      }
      if (path.includes('/check-runs')) {
        callback(null, JSON.stringify([]));
        return;
      }
      callback(new Error(`unexpected gh call: ${args.join(' ')}`));
    });

    await expect(readDefaultBranchFailingTestChecks('o/r')).resolves.toEqual(
      new Set(['go-client/test', 'golang/packages/tests/test']),
    );
  });
});
