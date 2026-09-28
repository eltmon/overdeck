/**
 * PAN-4264 Work Item 1: classifyGitHubRefusal recognizes primary and
 * secondary rate limits from gh stderr and from fetch responses.
 */

import { describe, expect, it } from 'vitest';

import { classifyGitHubRefusal } from '../../../../src/lib/github-quota/classify.js';

describe('classifyGitHubRefusal (PAN-4264)', () => {
  it('classifies the issue evidence message as a primary limit', () => {
    expect(classifyGitHubRefusal({
      message: 'Command failed: gh api graphql',
      stderr: 'GraphQL: API rate limit already exceeded for user ID 678719.',
    })).toEqual({ kind: 'primary' });
    expect(classifyGitHubRefusal({ message: 'GraphQL: API rate limit already exceeded for user ID 678719' }))
      .toEqual({ kind: 'primary' });
  });

  it('classifies graphql_rate_limit and a 403 with zero remaining as primary, keeping the reset time', () => {
    expect(classifyGitHubRefusal({ stderr: '{"type":"graphql_rate_limit"}' })).toEqual({ kind: 'primary' });
    expect(classifyGitHubRefusal({
      status: 403,
      message: 'Forbidden',
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' }),
    })).toEqual({ kind: 'primary', resetAtSec: 1790000000 });
  });

  it('classifies a secondary limit with retry-after: 30 and ignores the hourly reset header', () => {
    expect(classifyGitHubRefusal({
      status: 403,
      message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      headers: new Headers({ 'retry-after': '30', 'x-ratelimit-reset': '1790000000' }),
    })).toEqual({ kind: 'secondary', retryAfterSec: 30 });
    expect(classifyGitHubRefusal({ stderr: 'HTTP 403: abuse detection mechanism triggered' }))
      .toEqual({ kind: 'secondary' });
  });

  it('treats a 429 carrying retry-after as secondary', () => {
    expect(classifyGitHubRefusal({ status: 429, headers: new Headers({ 'retry-after': '30' }) }))
      .toEqual({ kind: 'secondary', retryAfterSec: 30 });
  });

  it('returns null for a 404 and a plain 500', () => {
    expect(classifyGitHubRefusal({ status: 404, message: 'GitHub API GET /repos/x/y/issues failed: 404 Not Found' }))
      .toBeNull();
    expect(classifyGitHubRefusal({ status: 500, message: 'Internal Server Error' })).toBeNull();
    expect(classifyGitHubRefusal({ status: 403, headers: new Headers({ 'x-ratelimit-remaining': '12' }) })).toBeNull();
  });
});
