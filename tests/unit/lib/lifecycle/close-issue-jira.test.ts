import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  linearImported: vi.fn(),
  linkJiraPullRequest: vi.fn(),
  transitionJiraIssue: vi.fn(),
  commentOnJiraIssue: vi.fn(),
}));

vi.mock('../../../../src/lib/tracker-utils.js', () => ({
  resolveTrackerType: vi.fn(() => 'jira'),
}));

vi.mock('../../../../src/lib/tracker/jira-lifecycle.js', () => ({
  linkJiraPullRequest: mocks.linkJiraPullRequest,
  transitionJiraIssue: mocks.transitionJiraIssue,
  commentOnJiraIssue: mocks.commentOnJiraIssue,
}));

vi.mock('../../../../src/lib/agents.js', async () => {
  const { Effect: E } = await import('effect');
  return {
    getAgentState: vi.fn(() => null),
    markAgentStoppedState: vi.fn((state: unknown) => state),
    saveAgentState: vi.fn(() => E.succeed(undefined)),
  };
});

vi.mock('../../../../src/lib/lifecycle/types.js', () => ({
  stepOk: (step: string, details?: string[]) => ({ step, success: true, skipped: false, details }),
  stepSkipped: (step: string, details?: string[]) => ({ step, success: true, skipped: true, details }),
  stepFailed: (step: string, error: string) => ({ step, success: false, skipped: false, error }),
  getLinearApiKey: vi.fn(async () => ['fake', 'linear', 'key'].join('-')),
}));

vi.mock('@linear/sdk', () => {
  mocks.linearImported();
  return { LinearClient: vi.fn() };
});

import { closeIssue } from '../../../../src/lib/lifecycle/close-issue.js';

const prUrl = 'https://github.com/acme/app/pull/42';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.linkJiraPullRequest.mockImplementation(async () => { mocks.calls.push('link'); return { kind: 'ok', message: 'ok' }; });
  mocks.transitionJiraIssue.mockImplementation(async () => { mocks.calls.push('transition'); return { kind: 'transitioned', message: 'moved' }; });
  mocks.commentOnJiraIssue.mockImplementation(async () => { mocks.calls.push('comment'); return { kind: 'ok', message: 'ok' }; });
});

describe('closeIssue for a Jira issue (PAN-5152)', () => {
  it('links the PR, moves the issue to Done, then comments with the PR URL', async () => {
    const steps = await Effect.runPromise(closeIssue({ issueId: 'PROJ-7', projectPath: '/p', prUrl }));

    expect(mocks.calls).toEqual(['link', 'transition', 'comment']);
    expect(mocks.linkJiraPullRequest).toHaveBeenCalledWith('PROJ-7', prUrl);
    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-7', 'done');
    expect(mocks.commentOnJiraIssue).toHaveBeenCalledWith('PROJ-7', `Closed by Overdeck after merge of ${prUrl}.`);
    expect(steps[0]).toEqual({ step: 'close-issue:transition', success: true, skipped: false, details: ['Jira issue moved to Done'] });
  });

  it('skips the link and uses the short comment without a PR URL', async () => {
    await Effect.runPromise(closeIssue({ issueId: 'PROJ-7', projectPath: '/p' }));

    expect(mocks.linkJiraPullRequest).not.toHaveBeenCalled();
    expect(mocks.commentOnJiraIssue).toHaveBeenCalledWith('PROJ-7', 'Closed by Overdeck.');
  });

  it.each([
    ['error', 'Jira rejected the credentials (HTTP 401).'],
    ['no-transition', 'Jira PROJ-7: no transition reaches "Done" (available: none); status left unchanged.'],
  ])('returns an ok step when the seam reports %s', async (kind, message) => {
    mocks.transitionJiraIssue.mockResolvedValue({ kind, message });

    const steps = await Effect.runPromise(closeIssue({ issueId: 'PROJ-7', projectPath: '/p', prUrl }));
    expect(steps[0].success).toBe(true);
    expect(steps[0].details?.[0]).toBe(`Jira: ${message}`);
  });

  it('never imports the Linear SDK and writes no workflow labels', async () => {
    const steps = await Effect.runPromise(closeIssue({ issueId: 'PROJ-7', projectPath: '/p', prUrl }));

    expect(mocks.linearImported).not.toHaveBeenCalled();
    expect(steps[1]).toMatchObject({ step: 'close-issue:label', skipped: true });
  });
});
