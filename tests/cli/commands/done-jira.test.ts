import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackerError } from '../../../src/lib/errors.js';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  linkJiraPullRequest: vi.fn(),
  transitionJiraIssue: vi.fn(),
  commentOnJiraIssue: vi.fn(),
  createJiraTrackerForIssue: vi.fn(),
}));

vi.mock('../../../src/lib/tracker/jira-lifecycle.js', () => ({
  linkJiraPullRequest: mocks.linkJiraPullRequest,
  transitionJiraIssue: mocks.transitionJiraIssue,
  commentOnJiraIssue: mocks.commentOnJiraIssue,
}));

vi.mock('../../../src/lib/tracker/factory.js', () => ({
  createJiraTrackerForIssue: mocks.createJiraTrackerForIssue,
}));

import { refuseIfJiraIssueClosed, updateJiraToInReview } from '../../../src/cli/commands/done-jira.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.linkJiraPullRequest.mockImplementation(async () => { mocks.calls.push('link'); return { kind: 'ok', message: 'ok' }; });
  mocks.transitionJiraIssue.mockImplementation(async () => { mocks.calls.push('transition'); return { kind: 'transitioned', message: 'moved' }; });
  mocks.commentOnJiraIssue.mockImplementation(async () => { mocks.calls.push('comment'); return { kind: 'ok', message: 'ok' }; });
});

describe('updateJiraToInReview (PAN-5152)', () => {
  it('links the PR, moves the issue to In Review, then posts the agent-completed comment', async () => {
    const prUrl = 'https://github.com/o/r/pull/9';
    await expect(updateJiraToInReview('PROJ-3', [prUrl], 'note')).resolves.toBe(true);

    expect(mocks.calls).toEqual(['link', 'transition', 'comment']);
    expect(mocks.linkJiraPullRequest).toHaveBeenCalledWith('PROJ-3', prUrl);
    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-3', 'in_review');
    expect(mocks.commentOnJiraIssue).toHaveBeenCalledWith('PROJ-3', '🤖 **Agent completed work:**\n\nnote');
  });

  it('posts no comment without --comment and counts already as updated', async () => {
    mocks.transitionJiraIssue.mockResolvedValue({ kind: 'already', message: 'already' });
    await expect(updateJiraToInReview('PROJ-3', [])).resolves.toBe(true);
    expect(mocks.commentOnJiraIssue).not.toHaveBeenCalled();
  });

  it('returns false without throwing when the seam reports an error', async () => {
    mocks.transitionJiraIssue.mockResolvedValue({ kind: 'error', message: 'Jira rejected the credentials (HTTP 401).' });
    await expect(updateJiraToInReview('PROJ-3', ['https://github.com/o/r/pull/9'], 'note')).resolves.toBe(false);
  });
});

describe('refuseIfJiraIssueClosed (PAN-5152)', () => {
  const trackerReturning = (effect: Effect.Effect<unknown, unknown>) => ({ getIssue: () => effect });

  it('refuses when the Jira issue is already Done', async () => {
    mocks.createJiraTrackerForIssue.mockReturnValue(trackerReturning(Effect.succeed({ canonicalState: 'done', rawState: 'Done' })));
    await expect(refuseIfJiraIssueClosed('PROJ-3')).resolves.toBe('PROJ-3 is already closed in Jira (Done).');
  });

  it('allows an open Jira issue', async () => {
    mocks.createJiraTrackerForIssue.mockReturnValue(trackerReturning(Effect.succeed({ canonicalState: 'in_progress', rawState: 'In Progress' })));
    await expect(refuseIfJiraIssueClosed('PROJ-3')).resolves.toBeNull();
  });

  it('warns and continues when Jira cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.createJiraTrackerForIssue.mockReturnValue(trackerReturning(Effect.fail(
      new TrackerError({ tracker: 'jira', operation: 'GET /rest/api/3/issue/PROJ-3', message: 'Jira GET /rest/api/3/issue/PROJ-3 failed: 503' }),
    )));

    await expect(refuseIfJiraIssueClosed('PROJ-3')).resolves.toBeNull();
    expect(String(warn.mock.calls[0]?.[0])).toContain('Could not verify Jira state: Jira GET /rest/api/3/issue/PROJ-3 failed: 503');
    warn.mockRestore();
  });
});
