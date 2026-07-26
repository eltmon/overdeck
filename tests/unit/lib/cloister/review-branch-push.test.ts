import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRequestReviewPipeline } from '../../../../src/lib/cloister/request-review-pipeline.js';
import {
  pushLocalReviewBranches,
  type ReviewGitRunner,
} from '../../../../src/lib/cloister/review-branch-push.js';

const roots = [
  {
    repoKey: 'changed',
    dir: '/workspace/changed',
    sourceBranch: 'feature/pan-3135',
    targetBranch: 'main',
    isPolyrepo: true,
  },
  {
    repoKey: 'untouched',
    dir: '/workspace/untouched',
    sourceBranch: 'feature/pan-3135',
    targetBranch: 'main',
    isPolyrepo: true,
  },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('pushLocalReviewBranches', () => {
  it('skips untouched polyrepo repositories whose feature branch does not exist', async () => {
    const runGit: ReviewGitRunner = vi.fn(async (args, options) => {
      expect(options).toMatchObject({
        timeout: 30_000,
        killSignal: 'SIGKILL',
        env: expect.objectContaining({ GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' }),
      });
      if (options.cwd === '/workspace/untouched') throw new Error('branch absent');
      expect(args[0]).toMatch(/rev-parse|push/);
    });

    await pushLocalReviewBranches('PAN-3135', '/workspace', {
      resolveRoots: () => roots,
      runGit,
    });

    expect(runGit).toHaveBeenCalledWith(
      ['push', 'origin', 'feature/pan-3135'],
      expect.objectContaining({ cwd: '/workspace/changed' }),
    );
    expect(runGit).not.toHaveBeenCalledWith(
      ['push', 'origin', 'feature/pan-3135'],
      expect.objectContaining({ cwd: '/workspace/untouched' }),
    );
  });

  it('releases the review pipeline after a timed-out push so a later read can retry', async () => {
    vi.useFakeTimers();
    const pipeline = createRequestReviewPipeline();
    let pushAttempts = 0;
    let finish!: () => void;
    const firstFinished = new Promise<void>((resolve) => { finish = resolve; });
    const runGit: ReviewGitRunner = vi.fn(async (args, options) => {
      if (args[0] === 'rev-parse') return;
      pushAttempts += 1;
      if (pushAttempts === 1) {
        await new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error('git push timed out')), options.timeout);
        });
      }
    });
    const deps = {
      verify: async () => ({ outcome: 'passed' as const }),
      pushBranch: () => pushLocalReviewBranches('PAN-3135', '/workspace', {
        resolveRoots: () => [roots[0]!],
        runGit,
      }),
      dispatchReview: vi.fn(async () => {}),
      onVerificationFailed: vi.fn(),
      onVerificationError: vi.fn(),
      onError: vi.fn(() => finish()),
    };

    expect(pipeline.start('PAN-3135', deps)).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    await firstFinished;
    expect(pipeline.isInFlight('PAN-3135')).toBe(false);
    expect(deps.dispatchReview).not.toHaveBeenCalled();

    expect(pipeline.start('PAN-3135', deps)).toBe(true);
    await vi.waitFor(() => expect(pipeline.isInFlight('PAN-3135')).toBe(false));
    expect(deps.dispatchReview).toHaveBeenCalledOnce();
    expect(pushAttempts).toBe(2);
  });
});
