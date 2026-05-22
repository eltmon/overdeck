import { describe, expect, it } from 'vitest';
import { getReviewRestartRequest } from './restartRouting';

describe('getReviewRestartRequest', () => {
  it('routes review coordinator restarts to the review convoy endpoint', () => {
    expect(getReviewRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionType: 'review',
      model: 'claude-opus-4-7',
    })).toEqual({
      endpoint: '/api/specialists/panopticon-cli/PAN-1381/review/restart',
      body: { model: 'claude-opus-4-7' },
      successMessage: 'Review restarted',
      errorMessage: 'Failed to restart review',
    });
  });

  it('routes reviewer restarts to the review convoy endpoint instead of the retired per-reviewer route', () => {
    const request = getReviewRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionType: 'reviewer',
      model: 'claude-sonnet-4-6',
    });

    expect(request?.endpoint).toBe('/api/specialists/panopticon-cli/PAN-1381/review/restart');
    expect(request?.endpoint).not.toContain('/reviewer/');
    expect(request?.body).toEqual({ model: 'claude-sonnet-4-6' });
  });

  it('omits the model field for default-model restarts', () => {
    expect(getReviewRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionType: 'reviewer',
    })?.body).toEqual({});
  });

  it('does not handle non-review session types', () => {
    expect(getReviewRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionType: 'work',
    })).toBeNull();
  });

  it('requires a project key for review routing', () => {
    expect(() => getReviewRestartRequest({
      issueId: 'PAN-1381',
      sessionType: 'reviewer',
    })).toThrow('Cannot find project for PAN-1381');
  });
});
