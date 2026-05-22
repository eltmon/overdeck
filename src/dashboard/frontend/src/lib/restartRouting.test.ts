import { describe, expect, it } from 'vitest';
import { getDirectRestartRequest } from './restartRouting';

describe('getDirectRestartRequest', () => {
  it('routes review coordinator restarts to the review convoy endpoint', () => {
    expect(getDirectRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionId: 'agent-pan-1381-review',
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
    const request = getDirectRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionId: 'agent-pan-1381-review-correctness',
      sessionType: 'reviewer',
      role: 'correctness',
      model: 'claude-sonnet-4-6',
    });

    expect(request?.endpoint).toBe('/api/specialists/panopticon-cli/PAN-1381/review/restart');
    expect(request?.endpoint).not.toContain('/reviewer/');
    expect(request?.body).toEqual({ model: 'claude-sonnet-4-6' });
  });

  it('omits the model field for default-model review restarts', () => {
    expect(getDirectRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionId: 'agent-pan-1381-review-correctness',
      sessionType: 'reviewer',
    })?.body).toEqual({});
  });

  it.each(['test', 'ship', 'merge'])('routes %s restarts to the generic agent restart endpoint', (sessionType) => {
    expect(getDirectRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionId: `agent-pan-1381-${sessionType}`,
      sessionType,
      model: 'claude-haiku-4-5-20251001',
    })).toEqual({
      endpoint: `/api/agents/agent-pan-1381-${sessionType}/restart`,
      body: { model: 'claude-haiku-4-5-20251001', graceful: false },
      successMessage: `${sessionType.charAt(0).toUpperCase() + sessionType.slice(1)} restarted`,
      errorMessage: `Failed to restart ${sessionType} agent`,
    });
  });

  it('uses no model field for default generic agent restarts', () => {
    expect(getDirectRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionId: 'agent-pan-1381-test',
      sessionType: 'test',
    })?.body).toEqual({ graceful: false });
  });

  it('leaves work sessions on the existing resume/start restart path', () => {
    expect(getDirectRestartRequest({
      projectKey: 'panopticon-cli',
      issueId: 'PAN-1381',
      sessionId: 'agent-pan-1381',
      sessionType: 'work',
    })).toBeNull();
  });

  it('requires a project key for review routing', () => {
    expect(() => getDirectRestartRequest({
      issueId: 'PAN-1381',
      sessionId: 'agent-pan-1381-review-correctness',
      sessionType: 'reviewer',
    })).toThrow('Cannot find project for PAN-1381');
  });
});
