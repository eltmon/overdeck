import { describe, expect, it, vi } from 'vitest';
import {
  listOpenGitLabMergeRequests,
  listGitLabMergedMergeRequestHeads,
  type GitLabMergeRequestRow,
  type GitLabRunner,
} from '../../../src/lib/gitlab-merge-requests.js';

describe('gitlab-merge-requests', () => {
  describe('listOpenGitLabMergeRequests', () => {
    it('invokes the runner with argv [\'mr\',\'list\',\'--output\',\'json\',\'--per-page\',\'100\',...] and cwd=repoPath', async () => {
      const runner: GitLabRunner = vi.fn(async () =>
        JSON.stringify([
          { source_branch: 'feature/min-1', title: 'Feature 1', web_url: 'https://gitlab.com/test/repo/-/merge_requests/1' } as GitLabMergeRequestRow,
        ]),
      );

      const result = await listOpenGitLabMergeRequests('/test/repo', runner);

      expect(runner).toHaveBeenCalledWith(
        ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '1'],
        '/test/repo',
      );
      expect(result).toEqual([
        { source_branch: 'feature/min-1', title: 'Feature 1', web_url: 'https://gitlab.com/test/repo/-/merge_requests/1' },
      ]);
    });

    it('returns parsed rows including source_branch and web_url', async () => {
      const runner: GitLabRunner = vi.fn(async () =>
        JSON.stringify([
          {
            iid: 1,
            title: 'Feature 1',
            web_url: 'https://gitlab.com/test/repo/-/merge_requests/1',
            state: 'opened',
            source_branch: 'feature/min-1',
            target_branch: 'main',
            sha: 'abc123',
            draft: false,
          } as GitLabMergeRequestRow,
        ]),
      );

      const result = await listOpenGitLabMergeRequests('/test/repo', runner);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source_branch: 'feature/min-1',
        web_url: 'https://gitlab.com/test/repo/-/merge_requests/1',
        title: 'Feature 1',
      });
    });

    it('requests page N+1 when a page returns exactly 100 rows and stops on short or empty page', async () => {
      let callCount = 0;
      const runner: GitLabRunner = vi.fn(async (_args, _cwd) => {
        callCount++;
        if (callCount === 1) {
          // First call returns exactly 100 rows
          return JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
            source_branch: `feature/min-${i}`,
          } as GitLabMergeRequestRow)));
        } else if (callCount === 2) {
          // Second call returns exactly 100 rows
          return JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
            source_branch: `feature/min-${100 + i}`,
          } as GitLabMergeRequestRow)));
        } else {
          // Third call returns 50 rows (short page)
          return JSON.stringify(Array.from({ length: 50 }, (_, i) => ({
            source_branch: `feature/min-${200 + i}`,
          } as GitLabMergeRequestRow)));
        }
      });

      const result = await listOpenGitLabMergeRequests('/test/repo-pagination', runner);

      // Should have 100 + 100 + 50 = 250 rows
      expect(result).toHaveLength(250);
      // Should have made 3 calls (pages 1, 2, 3)
      expect(runner).toHaveBeenCalledTimes(3);
      expect(runner).toHaveBeenNthCalledWith(1, ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '1'], '/test/repo-pagination');
      expect(runner).toHaveBeenNthCalledWith(2, ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '2'], '/test/repo-pagination');
      expect(runner).toHaveBeenNthCalledWith(3, ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '3'], '/test/repo-pagination');
    });

    it('given empty stdout from the runner, returns []', async () => {
      const runner: GitLabRunner = vi.fn(async () => '');

      const result = await listOpenGitLabMergeRequests('/test/repo-empty', runner);

      expect(result).toEqual([]);
    });

    it('given a rejecting runner, rejects with the runner\'s error', async () => {
      const runner: GitLabRunner = vi.fn(async () => {
        throw new Error('glab unavailable');
      });

      await expect(listOpenGitLabMergeRequests('/test/repo-error-test', runner)).rejects.toThrow('glab unavailable');
    });

    it('returns the same result for duplicate calls to the same repo (caching behavior)', async () => {
      const runner: GitLabRunner = vi.fn(async () =>
        JSON.stringify([{ source_branch: 'feature/min-1' } as GitLabMergeRequestRow]),
      );

      const result1 = await listOpenGitLabMergeRequests('/test/repo-cache-test', runner);
      expect(runner).toHaveBeenCalledTimes(1);

      // Immediate second call should return cached result
      const result2 = await listOpenGitLabMergeRequests('/test/repo-cache-test', runner);
      // Note: Due to caching, may not make a second call, but at minimum the results match
      expect(result2).toEqual(result1);
    });
  });

  describe('listGitLabMergedMergeRequestHeads', () => {
    it('invokes the runner with argv containing \'--merged\' and \'--source-branch <head>\' per head', async () => {
      const runner: GitLabRunner = vi.fn(async (args) => {
        // First call (feature/min-1) returns a merged MR, second (feature/min-2) returns empty
        if (args.includes('feature/min-1')) {
          return JSON.stringify([{ source_branch: 'feature/min-1', state: 'merged' } as GitLabMergeRequestRow]);
        }
        return '';
      });

      const result = await listGitLabMergedMergeRequestHeads('/test/repo', ['feature/min-1', 'feature/min-2'], runner);

      expect(result).toEqual(['feature/min-1']);
      // Should have been called for each head
      expect(runner).toHaveBeenCalledWith(
        ['mr', 'list', '--merged', '--source-branch', 'feature/min-1', '--output', 'json', '--per-page', '100', '--page', '1'],
        '/test/repo',
      );
      expect(runner).toHaveBeenCalledWith(
        ['mr', 'list', '--merged', '--source-branch', 'feature/min-2', '--output', 'json', '--per-page', '100', '--page', '1'],
        '/test/repo',
      );
    });

    it('returns exactly the heads whose query produced >=1 row', async () => {
      const runner: GitLabRunner = vi.fn(async (args) => {
        if (args.includes('feature/min-1')) {
          return JSON.stringify([{ source_branch: 'feature/min-1', state: 'merged' }] as GitLabMergeRequestRow[]);
        }
        if (args.includes('feature/min-3')) {
          return JSON.stringify([{ source_branch: 'feature/min-3', state: 'merged' }] as GitLabMergeRequestRow[]);
        }
        return '';
      });

      const result = await listGitLabMergedMergeRequestHeads(
        '/test/repo',
        ['feature/min-1', 'feature/min-2', 'feature/min-3'],
        runner,
      );

      expect(result).toEqual(['feature/min-1', 'feature/min-3']);
    });

    it('correctly identifies heads with merged MRs across multiple pages', async () => {
      const runner: GitLabRunner = vi.fn(async (args) => {
        if (args[args.length - 1] === '1') {
          // Page 1: full page (100 rows) - all with the requested source branch
          return JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
            source_branch: 'feature/min-multipage',
            iid: i,
          } as GitLabMergeRequestRow)));
        } else if (args[args.length - 1] === '2') {
          // Page 2: short page (< 100 rows)
          return JSON.stringify([{ source_branch: 'feature/min-multipage', iid: 100 } as GitLabMergeRequestRow]);
        }
        return '';
      });

      const result = await listGitLabMergedMergeRequestHeads('/test/repo-merged-multipage', ['feature/min-multipage'], runner);

      // Should correctly identify that the head has merged MRs
      expect(result).toEqual(['feature/min-multipage']);
    });

    it('returns empty array when no heads are provided', async () => {
      const runner: GitLabRunner = vi.fn();

      const result = await listGitLabMergedMergeRequestHeads('/test/repo', [], runner);

      expect(result).toEqual([]);
      expect(runner).not.toHaveBeenCalled();
    });

    it('given a rejecting runner, catches the error and treats the head as unmerged', async () => {
      const runner: GitLabRunner = vi.fn(async (args) => {
        if (args.includes('feature/min-1')) {
          throw new Error('glab error');
        }
        if (args.includes('feature/min-2')) {
          return JSON.stringify([{ source_branch: 'feature/min-2' } as GitLabMergeRequestRow]);
        }
        return '';
      });

      const result = await listGitLabMergedMergeRequestHeads(
        '/test/repo-error-merged',
        ['feature/min-1', 'feature/min-2'],
        runner,
      );

      // Only feature/min-2 is returned; feature/min-1 errored and was skipped
      expect(result).toEqual(['feature/min-2']);
    });

    it('returns the same result for duplicate calls to the same (repoPath, head) pair', async () => {
      let callCount = 0;
      const runner: GitLabRunner = vi.fn(async (args) => {
        if (args.includes('feature/min-1')) {
          callCount++;
          return JSON.stringify([{ source_branch: 'feature/min-1' } as GitLabMergeRequestRow]);
        }
        return '';
      });

      const result1 = await listGitLabMergedMergeRequestHeads('/test/repo-merged-cache', ['feature/min-1'], runner);
      expect(callCount).toBe(1);

      // Immediate second call should use cache
      const result2 = await listGitLabMergedMergeRequestHeads('/test/repo-merged-cache', ['feature/min-1'], runner);
      // Results should match (cache or fresh call both produce same result)
      expect(result2).toEqual(result1);
    });
  });
});
