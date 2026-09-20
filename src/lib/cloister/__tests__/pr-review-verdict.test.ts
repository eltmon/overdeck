/**
 * Verdict posting on a single-account install (PAN-3917 follow-up).
 *
 * GitHub refuses `gh pr review` on your own pull request, so these cover the
 * two ways out: author the review as the GitHub App, and — when the forge
 * still refuses — post the verdict as a marker comment.
 */
import { describe, it, expect, vi } from 'vitest';

import { emptyPrFacts, type PrFacts } from '../pr-facts.js';
import { postReviewVerdict, type PostReviewVerdictDeps } from '../pr-review-verdict.js';

function ghFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    ...emptyPrFacts('PAN-1'),
    forge: 'github',
    exists: true,
    open: true,
    url: 'https://github.com/eltmon/overdeck/pull/3933',
    number: 3933,
    ...overrides,
  };
}

function selfReviewError(): Error {
  const err = new Error('Command failed: gh pr review 3933');
  (err as Error & { stderr?: string }).stderr =
    'GraphQL: Can not request changes on your own pull request (addPullRequestReview)';
  return err;
}

const baseDeps = (overrides: Partial<PostReviewVerdictDeps> = {}): PostReviewVerdictDeps => ({
  isAppConfigured: () => false,
  ...overrides,
});

describe('postReviewVerdict — GitHub App identity', () => {
  it('passes the installation token as GH_TOKEN when the app is configured', async () => {
    const runGh = vi.fn(async () => {});
    const result = await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'approve', body: 'looks good', facts: ghFacts() },
      { runGh, isAppConfigured: () => true, getAppToken: async () => 'ghs_installation' },
    );

    expect(result).toMatchObject({ posted: true, via: 'review', verdict: 'approve' });
    expect(runGh).toHaveBeenCalledTimes(1);
    const [args, options] = runGh.mock.calls[0] as unknown as [string[], { env?: NodeJS.ProcessEnv }];
    expect(args).toContain('--approve');
    expect(options?.env?.GH_TOKEN).toBe('ghs_installation');
  });

  it('falls through to the plain gh identity when the token cannot be minted', async () => {
    const runGh = vi.fn(async () => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'approve', body: 'ok', facts: ghFacts() },
      {
        runGh,
        isAppConfigured: () => true,
        getAppToken: async () => { throw new Error('GitHub App not configured'); },
      },
    );
    warn.mockRestore();

    expect(result).toMatchObject({ posted: true, via: 'review' });
    const [, options] = runGh.mock.calls[0] as unknown as [string[], { env?: NodeJS.ProcessEnv } | undefined];
    expect(options?.env).toBeUndefined();
  });

  it('sends no env when the app is not configured', async () => {
    const runGh = vi.fn(async () => {});
    await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'request-changes', body: 'nope', facts: ghFacts() },
      baseDeps({ runGh }),
    );
    const [, options] = runGh.mock.calls[0] as unknown as [string[], { env?: NodeJS.ProcessEnv } | undefined];
    expect(options?.env).toBeUndefined();
  });
});

describe('postReviewVerdict — self-review refusal fallback', () => {
  it('posts a CHANGES_REQUESTED marker comment when the forge refuses a self-review', async () => {
    const runGh = vi.fn(async (args: string[]) => {
      if (args[1] === 'review') throw selfReviewError();
    });

    const result = await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'request-changes', body: 'two findings', facts: ghFacts() },
      baseDeps({ runGh }),
    );

    expect(result).toEqual({
      posted: true,
      forge: 'github',
      url: 'https://github.com/eltmon/overdeck/pull/3933',
      verdict: 'request-changes',
      via: 'comment',
    });
    expect(runGh).toHaveBeenCalledTimes(2);
    const [args] = runGh.mock.calls[1] as unknown as [string[]];
    expect(args.slice(0, 2)).toEqual(['pr', 'comment']);
    const body = args[args.indexOf('--body') + 1];
    expect(body.startsWith('<!-- overdeck-verdict: CHANGES_REQUESTED -->')).toBe(true);
    expect(body).toContain('two findings');
  });

  it('posts an APPROVED marker comment for an approval', async () => {
    const runGh = vi.fn(async (args: string[]) => {
      if (args[1] === 'review') throw selfReviewError();
    });
    const result = await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'approve', body: 'ship it', facts: ghFacts() },
      baseDeps({ runGh }),
    );
    expect(result).toMatchObject({ posted: true, via: 'comment' });
    const [args] = runGh.mock.calls[1] as unknown as [string[]];
    expect(args[args.indexOf('--body') + 1]).toContain('<!-- overdeck-verdict: APPROVED -->');
  });

  it('does not fall back for any other gh error', async () => {
    const runGh = vi.fn(async () => { throw new Error('HTTP 502 from api.github.com'); });
    const result = await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'approve', body: 'ok', facts: ghFacts() },
      baseDeps({ runGh }),
    );
    expect(result).toMatchObject({ posted: false });
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it('reports not posted when the fallback comment also fails', async () => {
    const runGh = vi.fn(async (args: string[]) => {
      if (args[1] === 'review') throw selfReviewError();
      throw new Error('comment rejected');
    });
    const result = await postReviewVerdict(
      { issueId: 'PAN-1', verdict: 'approve', body: 'ok', facts: ghFacts() },
      baseDeps({ runGh }),
    );
    expect(result.posted).toBe(false);
    expect((result as { reason: string }).reason).toContain('fallback comment failed');
  });
});
