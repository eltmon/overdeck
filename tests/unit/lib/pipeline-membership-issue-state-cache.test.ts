/**
 * PAN-5261: a process that enables it (the dashboard) reuses a GraphQL
 * issue-state answer for the same repo and number for up to
 * `ISSUE_STATE_CACHE_TTL_MS`. With the cache not enabled (the default — CLI,
 * deacon, tests), every gather asks GraphQL as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enableIssueStateCache,
  gatherProjectLensSignals,
  invalidateCachedIssueState,
  ISSUE_STATE_CACHE_TTL_MS,
  listIssueStatesCached,
  type PipelineMembershipGatherDeps,
} from '../../../src/lib/pipeline-membership-gather.js';
import type { ProjectConfig } from '../../../src/lib/projects.js';

type IssueState = { number: number; state: 'open' | 'closed' };

describe('listIssueStatesCached', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cache not enabled: two calls for [1, 2] call list twice with [1, 2] (ac1)', async () => {
    const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
      .mockResolvedValue([{ number: 1, state: 'open' }, { number: 2, state: 'closed' }]);

    await listIssueStatesCached('o', 'r', [1, 2], list);
    await listIssueStatesCached('o', 'r', [1, 2], list);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenNthCalledWith(1, 'o', 'r', [1, 2]);
    expect(list).toHaveBeenNthCalledWith(2, 'o', 'r', [1, 2]);
  });

  describe('cache enabled', () => {
    let disable: () => void;

    beforeEach(() => {
      vi.useFakeTimers();
      disable = enableIssueStateCache();
    });

    afterEach(() => {
      disable();
      vi.useRealTimers();
    });

    it('reuses answers within the TTL; asks list only for the rest; an omitted number stays omitted (ac2)', async () => {
      const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
        .mockResolvedValueOnce([{ number: 1, state: 'open' }, { number: 2, state: 'closed' }]);

      const first = await listIssueStatesCached('eac2', 'r', [1, 2, 3], list);
      expect(first).toEqual([{ number: 1, state: 'open' }, { number: 2, state: 'closed' }]);

      list.mockResolvedValueOnce([{ number: 4, state: 'open' }]);
      const second = await listIssueStatesCached('eac2', 'r', [1, 2, 3, 4], list);

      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(2, 'eac2', 'r', [4]);
      expect(second).toEqual([{ number: 1, state: 'open' }, { number: 2, state: 'closed' }, { number: 4, state: 'open' }]);
    });

    it("invalidateCachedIssueState('O', 'R', 2) (case-insensitive key) makes the next call ask list for [2] only (ac3)", async () => {
      const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
        .mockResolvedValueOnce([{ number: 1, state: 'open' }, { number: 2, state: 'closed' }]);
      await listIssueStatesCached('eac3', 'r', [1, 2], list);

      invalidateCachedIssueState('EAC3', 'R', 2);

      list.mockResolvedValueOnce([{ number: 2, state: 'open' }]);
      await listIssueStatesCached('eac3', 'r', [1, 2], list);

      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(2, 'eac3', 'r', [2]);
    });

    it('past ISSUE_STATE_CACHE_TTL_MS every number is asked again (ac3)', async () => {
      const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
        .mockResolvedValue([{ number: 1, state: 'open' }]);
      await listIssueStatesCached('eac3b', 'r', [1], list);

      await vi.advanceTimersByTimeAsync(ISSUE_STATE_CACHE_TTL_MS + 1_000);
      await listIssueStatesCached('eac3b', 'r', [1], list);

      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(2, 'eac3b', 'r', [1]);
    });

    it("a 'not an issue' (null) answer re-asks sooner than a confirmed answer (CodeRabbit, PR #5266)", async () => {
      const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
        .mockResolvedValueOnce([{ number: 1, state: 'open' }]); // 2 omitted: not an issue, or a transient error
      await listIssueStatesCached('eac3c', 'r', [1, 2], list);

      // Past the short null TTL but well inside the 30-minute main TTL: 1
      // (confirmed) stays cached, 2 (null) is asked again — bounding how
      // long a transient per-alias GraphQL error can hide a candidate.
      await vi.advanceTimersByTimeAsync(3 * 60_000);
      list.mockResolvedValueOnce([{ number: 2, state: 'open' }]);
      const second = await listIssueStatesCached('eac3c', 'r', [1, 2], list);

      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(2, 'eac3c', 'r', [2]);
      expect(second).toEqual([{ number: 1, state: 'open' }, { number: 2, state: 'open' }]);
    });

    it('an invalidation that lands mid-lookup is returned to this caller but never cached (ac4)', async () => {
      let resolveList!: (value: IssueState[]) => void;
      const pending = new Promise<IssueState[]>((resolve) => { resolveList = resolve; });
      const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
        .mockReturnValueOnce(pending);

      const call = listIssueStatesCached('eac4', 'r', [5], list);
      invalidateCachedIssueState('eac4', 'r', 5);
      resolveList([{ number: 5, state: 'open' }]);

      await expect(call).resolves.toEqual([{ number: 5, state: 'open' }]);

      list.mockResolvedValueOnce([{ number: 5, state: 'open' }]);
      await listIssueStatesCached('eac4', 'r', [5], list);

      expect(list).toHaveBeenCalledTimes(2);
    });

    it("the function returned by enableIssueStateCache() disables and clears the cache", async () => {
      const list = vi.fn<(owner: string, repo: string, numbers: number[]) => Promise<IssueState[]>>()
        .mockResolvedValue([{ number: 1, state: 'open' }]);
      await listIssueStatesCached('eac6', 'r', [1], list);
      expect(list).toHaveBeenCalledTimes(1);

      disable();

      await listIssueStatesCached('eac6', 'r', [1], list);
      expect(list).toHaveBeenCalledTimes(2);
    });
  });
});

describe('gatherProjectLensSignals with the issue-state cache enabled (ac5)', () => {
  const project: ProjectConfig = {
    name: 'overdeck',
    path: '/project',
    issue_prefix: 'PAN',
    github_repo: 'eltmon/overdeck',
  };

  function deps(): PipelineMembershipGatherDeps {
    return {
      listOpenIssues: vi.fn().mockResolvedValue([
        { number: 1, labels: ['in-review'] },
        { number: 4, labels: [] },
      ]),
      listPhaseLabeledIssues: vi.fn().mockResolvedValue([]),
      listOpenPullRequests: vi.fn().mockResolvedValue([{
        headRefName: 'feature/pan-2', headRepoFullName: 'eltmon/overdeck',
      }]),
      listOpenMergeRequests: vi.fn().mockResolvedValue([]),
      listMergedPullRequestHeads: vi.fn().mockResolvedValue(['feature/pan-1']),
      listMergedMergeRequestHeads: vi.fn().mockResolvedValue([]),
      listIssueStates: vi.fn().mockImplementation(async (_owner, _repo, numbers: number[]) =>
        numbers.map((number) => ({ number, state: number === 4 ? 'open' as const : 'closed' as const }))),
      listTrackerIssues: vi.fn().mockResolvedValue([]),
      listSpecIssueIds: vi.fn().mockResolvedValue(['PAN-4']),
      run: vi.fn().mockImplementation(async (command, args, cwd) => {
        if (command === 'git' && args[0] === 'rev-parse') return cwd;
        if (command === 'git' && args.includes('--no-merged=main')) return 'feature/pan-1\norigin/feature/pan-3\n';
        if (command === 'git') return 'feature/pan-1\norigin/feature/pan-3\n';
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }),
    };
  }

  let disable: () => void;

  beforeEach(() => {
    disable = enableIssueStateCache();
  });

  afterEach(() => {
    disable();
  });

  it('a gather run twice calls deps.listIssueStates once', async () => {
    const mocked = deps();

    await gatherProjectLensSignals(project, mocked);
    await gatherProjectLensSignals(project, mocked);

    expect(mocked.listIssueStates).toHaveBeenCalledTimes(1);
  });
});
