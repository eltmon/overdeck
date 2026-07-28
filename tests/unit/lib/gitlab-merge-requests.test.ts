import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
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

      const result = await listOpenGitLabMergeRequests('/test/open-1', runner);

      expect(runner).toHaveBeenCalledWith(
        ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '1'],
        '/test/open-1',
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

      const result = await listOpenGitLabMergeRequests('/test/open-2', runner);

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

      const result = await listOpenGitLabMergeRequests('/test/open-3', runner);

      // Should have 100 + 100 + 50 = 250 rows
      expect(result).toHaveLength(250);
      // Should have made 3 calls (pages 1, 2, 3)
      expect(runner).toHaveBeenCalledTimes(3);
      expect(runner).toHaveBeenNthCalledWith(1, ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '1'], '/test/open-3');
      expect(runner).toHaveBeenNthCalledWith(2, ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '2'], '/test/open-3');
      expect(runner).toHaveBeenNthCalledWith(3, ['mr', 'list', '--output', 'json', '--per-page', '100', '--page', '3'], '/test/open-3');
    });

    it('given empty stdout from the runner, returns []', async () => {
      const runner: GitLabRunner = vi.fn(async () => '');

      const result = await listOpenGitLabMergeRequests('/test/open-4', runner);

      expect(result).toEqual([]);
    });

    it('given a rejecting runner, rejects with the runner\'s error', async () => {
      const runner: GitLabRunner = vi.fn(async () => {
        throw new Error('glab unavailable');
      });

      await expect(listOpenGitLabMergeRequests('/test/open-5', runner)).rejects.toThrow('glab unavailable');
    });

    it('given malformed JSON, rejects with a parse error', async () => {
      const runner: GitLabRunner = vi.fn(async () => 'not json');

      await expect(listOpenGitLabMergeRequests('/test/open-6', runner)).rejects.toThrow();
    });

    it('caches results by repo for 30s and dedupes concurrent calls', async () => {
      vi.useFakeTimers();
      try {
        const runner: GitLabRunner = vi.fn(async () =>
          JSON.stringify([{ source_branch: 'feature/min-1' } as GitLabMergeRequestRow]),
        );

        // First call invokes runner
        const result1 = await listOpenGitLabMergeRequests('/test/open-7', runner);
        expect(runner).toHaveBeenCalledTimes(1);
        expect(result1).toHaveLength(1);

        // Concurrent call within TTL reuses cached result without invoking runner again
        const result2 = await listOpenGitLabMergeRequests('/test/open-7', runner);
        expect(runner).toHaveBeenCalledTimes(1);
        expect(result2).toEqual(result1);

        // After 30s TTL expires, next call re-invokes runner
        vi.advanceTimersByTime(31_000);
        const result3 = await listOpenGitLabMergeRequests('/test/open-7', runner);
        expect(runner).toHaveBeenCalledTimes(2);
        expect(result3).toEqual(result1);
      } finally {
        vi.useRealTimers();
      }
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

      const result = await listGitLabMergedMergeRequestHeads('/test/merged-1', ['feature/min-1', 'feature/min-2'], runner);

      expect(result).toEqual(['feature/min-1']);
      // Should have been called for each head
      expect(runner).toHaveBeenCalledWith(
        ['mr', 'list', '--merged', '--source-branch', 'feature/min-1', '--output', 'json', '--per-page', '100', '--page', '1'],
        '/test/merged-1',
      );
      expect(runner).toHaveBeenCalledWith(
        ['mr', 'list', '--merged', '--source-branch', 'feature/min-2', '--output', 'json', '--per-page', '100', '--page', '1'],
        '/test/merged-1',
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
        '/test/merged-2',
        ['feature/min-1', 'feature/min-2', 'feature/min-3'],
        runner,
      );

      expect(result).toEqual(['feature/min-1', 'feature/min-3']);
    });

    it('correctly identifies heads with merged MRs across multiple pages and stops on page 1 with results', async () => {
      let callCount = 0;
      const runner: GitLabRunner = vi.fn(async (args) => {
        callCount++;
        if (args[args.length - 1] === '1') {
          // Page 1: full page (100 rows) - head is found, implementation returns immediately
          return JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
            source_branch: 'feature/min-multipage',
            iid: i,
          } as GitLabMergeRequestRow)));
        }
        // Should not reach page 2 since page 1 has results
        throw new Error('Should not request page 2');
      });

      const result = await listGitLabMergedMergeRequestHeads('/test/merged-3', ['feature/min-multipage'], runner);

      // Should correctly identify that the head has merged MRs
      expect(result).toEqual(['feature/min-multipage']);
      // Should only have made page 1 request (short-circuit on finding any result)
      expect(callCount).toBe(1);
    });

    it('short-circuits after a full first page proves the head has a merged MR', async () => {
      let callCount = 0;
      const runner: GitLabRunner = vi.fn(async (args) => {
        callCount++;
        if (args[args.length - 1] === '1') {
          return JSON.stringify(Array.from({ length: 100 }, (_, i) => ({
            source_branch: 'feature/multi',
            iid: i,
          } as GitLabMergeRequestRow)));
        }
        throw new Error('Should not request page 2 after finding merged rows');
      });

      const result = await listGitLabMergedMergeRequestHeads('/test/merged-4', ['feature/multi'], runner);

      expect(result).toEqual(['feature/multi']);
      expect(callCount).toBe(1);
    });

    it('returns empty array when no heads are provided', async () => {
      const runner: GitLabRunner = vi.fn();

      const result = await listGitLabMergedMergeRequestHeads('/test/merged-5', [], runner);

      expect(result).toEqual([]);
      expect(runner).not.toHaveBeenCalled();
    });

    it('given a rejecting runner, rejects with the error (not silently treating as unmerged)', async () => {
      const runner: GitLabRunner = vi.fn(async (args) => {
        if (args.includes('feature/min-1')) {
          throw new Error('glab error');
        }
        return '';
      });

      await expect(
        listGitLabMergedMergeRequestHeads('/test/merged-6', ['feature/min-1'], runner),
      ).rejects.toThrow('glab error');
    });

    it('given malformed JSON, rejects with parse error', async () => {
      const runner: GitLabRunner = vi.fn(async () => 'not json');

      await expect(
        listGitLabMergedMergeRequestHeads('/test/merged-7', ['feature/test'], runner),
      ).rejects.toThrow();
    });

    it('caches results by (repoPath, head) for 30s and dedupes concurrent calls', async () => {
      vi.useFakeTimers();
      try {
        const runner: GitLabRunner = vi.fn(async (args) => {
          if (args.includes('feature/min-1')) {
            return JSON.stringify([{ source_branch: 'feature/min-1' } as GitLabMergeRequestRow]);
          }
          return '';
        });

        // First call invokes runner
        const result1 = await listGitLabMergedMergeRequestHeads('/test/merged-8', ['feature/min-1'], runner);
        expect(runner).toHaveBeenCalledTimes(1);
        expect(result1).toEqual(['feature/min-1']);

        // Concurrent call within TTL reuses cached result
        const result2 = await listGitLabMergedMergeRequestHeads('/test/merged-8', ['feature/min-1'], runner);
        expect(runner).toHaveBeenCalledTimes(1);
        expect(result2).toEqual(result1);

        // After 30s TTL expires, next call re-invokes runner
        vi.advanceTimersByTime(31_000);
        const result3 = await listGitLabMergedMergeRequestHeads('/test/merged-8', ['feature/min-1'], runner);
        expect(runner).toHaveBeenCalledTimes(2);
        expect(result3).toEqual(result1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
