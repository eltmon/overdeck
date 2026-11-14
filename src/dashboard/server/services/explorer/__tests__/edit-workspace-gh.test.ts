import { describe, expect, it, vi } from 'vitest';
import {
  closePullRequest,
  createGitHubIssue,
  createPullRequest,
  findBranchPr,
  mergeVerdict,
  readPrWithVerdict,
  type GhRunner,
  type PrMergeState,
} from '../edit-workspace-gh.js';
import { EditWorkspaceError } from '../edit-workspace-errors.js';

/** A fake gh that answers each call with the next scripted stdout and records the argv. */
function fakeGh(outputs: string[]): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    const stdout = outputs.shift();
    if (stdout === undefined) throw new Error(`unexpected gh call: ${args.join(' ')}`);
    return { stdout };
  };
  return { gh, calls };
}

function open(mergeStateStatus: string, overrides: Partial<PrMergeState> = {}): PrMergeState {
  return { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus, headRefOid: 'abc', ...overrides };
}

describe('mergeVerdict', () => {
  it.each(['CLEAN', 'UNSTABLE', 'HAS_HOOKS'])('allows a merge when mergeable is MERGEABLE and status is %s', (status) => {
    expect(mergeVerdict(open(status))).toEqual({ canMerge: true, reason: null });
  });

  it.each<[string, PrMergeState, string]>([
    ['MERGED', open('CLEAN', { state: 'MERGED' }), 'Already merged'],
    ['CLOSED', open('CLEAN', { state: 'CLOSED' }), 'The PR is closed'],
    ['draft', open('CLEAN', { isDraft: true }), 'The PR is a draft'],
    ['DRAFT status', open('DRAFT'), 'The PR is a draft'],
    ['DIRTY', open('DIRTY'), 'Conflicts with the base branch'],
    ['CONFLICTING', open('CLEAN', { mergeable: 'CONFLICTING' }), 'Conflicts with the base branch'],
    ['BLOCKED', open('BLOCKED'), 'Required checks or reviews are not met'],
    ['BEHIND', open('BEHIND'), 'The branch is out of date with the base branch'],
    ['UNKNOWN status', open('UNKNOWN'), 'GitHub is still checking whether this PR can merge'],
    ['UNKNOWN mergeable', open('CLEAN', { mergeable: 'UNKNOWN' }), 'GitHub is still checking whether this PR can merge'],
    ['unlisted FOO', open('FOO'), 'GitHub reports FOO'],
  ])('refuses %s with the D-F7 reason', (_label, state, reason) => {
    expect(mergeVerdict(state)).toEqual({ canMerge: false, reason });
  });
});

describe('findBranchPr', () => {
  it('lists PRs for the branch in every state and returns null when there are none', async () => {
    const { gh, calls } = fakeGh(['[]']);
    expect(await findBranchPr(gh, 'o/r', 'scratch/edit-1113-1405', '/w')).toBeNull();
    expect(calls[0]).toEqual([
      'pr', 'list', '--repo', 'o/r', '--head', 'scratch/edit-1113-1405', '--state', 'all',
      '--json', 'number,url,state', '--limit', '1',
    ]);
  });
});

describe('readPrWithVerdict', () => {
  const listed = JSON.stringify([{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' }]);
  const view = (mergeable: string, mergeStateStatus: string) =>
    JSON.stringify({ mergeable, mergeStateStatus, headRefOid: 'deadbeef', state: 'OPEN', isDraft: false });

  it('reads the PR once more after sleep(2000) when the first read is UNKNOWN', async () => {
    const { gh, calls } = fakeGh([listed, view('UNKNOWN', 'UNKNOWN'), view('MERGEABLE', 'CLEAN')]);
    const sleep = vi.fn(async (_ms: number) => {});
    const pr = await readPrWithVerdict(gh, 'o/r', 'scratch/edit-1', '/w', sleep);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(calls.filter((args) => args[0] === 'pr' && args[1] === 'view')).toHaveLength(2);
    expect(pr).toEqual({
      url: 'https://github.com/o/r/pull/7',
      number: 7,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      headSha: 'deadbeef',
      canMerge: true,
      reason: null,
    });
  });

  it('does not sleep when the first read is known', async () => {
    const { gh } = fakeGh([listed, view('MERGEABLE', 'BLOCKED')]);
    const sleep = vi.fn(async (_ms: number) => {});
    const pr = await readPrWithVerdict(gh, 'o/r', 'scratch/edit-1', '/w', sleep);
    expect(sleep).not.toHaveBeenCalled();
    expect(pr?.reason).toBe('Required checks or reviews are not met');
  });

  it('skips gh pr view for a merged PR', async () => {
    const merged = JSON.stringify([{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'MERGED' }]);
    const { gh, calls } = fakeGh([merged]);
    const pr = await readPrWithVerdict(gh, 'o/r', 'scratch/edit-1', '/w', async () => {});
    expect(calls).toHaveLength(1);
    expect(pr).toMatchObject({ state: 'MERGED', mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', headSha: '', canMerge: false, reason: 'Already merged' });
  });

  it('returns null when the branch has no PR', async () => {
    const { gh } = fakeGh(['[]']);
    expect(await readPrWithVerdict(gh, 'o/r', 'scratch/edit-1', '/w', async () => {})).toBeNull();
  });
});

describe('createPullRequest', () => {
  const base = { repo: 'o/r', head: 'scratch/edit-1', base: 'main', body: 'body', cwd: '/w' };

  it('passes a quoted title as one argv element and returns the parsed number', async () => {
    const title = 'a "quoted" $(title)';
    const { gh, calls } = fakeGh(['Creating pull request…\nhttps://github.com/o/r/pull/123\n']);
    const result = await createPullRequest(gh, { ...base, title, draft: false });
    expect(result).toEqual({ url: 'https://github.com/o/r/pull/123', number: 123 });
    expect(calls[0]).toEqual([
      'pr', 'create', '--repo', 'o/r', '--head', 'scratch/edit-1', '--base', 'main', '--title', title, '--body', 'body',
    ]);
    expect(calls[0]).not.toContain('--draft');
  });

  it('adds --draft only when draft is true', async () => {
    const { gh, calls } = fakeGh(['https://github.com/o/r/pull/5']);
    await createPullRequest(gh, { ...base, title: 't', draft: true });
    expect(calls[0]?.[calls[0].length - 1]).toBe('--draft');
  });

  it('throws PR_CREATE_FAILED when gh prints no PR URL', async () => {
    const { gh } = fakeGh(['something else']);
    await expect(createPullRequest(gh, { ...base, title: 't', draft: false })).rejects.toMatchObject({
      code: 'PR_CREATE_FAILED',
      status: 502,
    });
  });
});

describe('createGitHubIssue', () => {
  it('returns number 42 for https://github.com/o/r/issues/42', async () => {
    const { gh, calls } = fakeGh(['https://github.com/o/r/issues/42\n']);
    const result = await createGitHubIssue(gh, { repo: 'o/r', title: 'T', body: 'B', cwd: '/w' });
    expect(result).toEqual({ number: 42, url: 'https://github.com/o/r/issues/42' });
    expect(calls[0]).toEqual(['issue', 'create', '--repo', 'o/r', '--title', 'T', '--body', 'B']);
  });

  it('throws ISSUE_CREATE_FAILED when gh prints no issue URL', async () => {
    const { gh } = fakeGh(['']);
    await expect(createGitHubIssue(gh, { repo: 'o/r', title: 'T', body: 'B', cwd: '/w' })).rejects.toBeInstanceOf(EditWorkspaceError);
  });
});

describe('closePullRequest', () => {
  it('closes by number', async () => {
    const { gh, calls } = fakeGh(['']);
    await closePullRequest(gh, 'o/r', 9, '/w');
    expect(calls[0]).toEqual(['pr', 'close', '9', '--repo', 'o/r']);
  });
});
