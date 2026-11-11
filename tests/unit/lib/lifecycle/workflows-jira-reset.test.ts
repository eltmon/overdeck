import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transitionJiraIssue: vi.fn(),
  linearImported: vi.fn(),
}));

vi.mock('../../../../src/lib/tracker-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tracker-utils.js')>()),
  resolveTrackerType: vi.fn(() => 'jira'),
}));

vi.mock('../../../../src/lib/tracker/jira-lifecycle.js', () => ({
  transitionJiraIssue: mocks.transitionJiraIssue,
}));

vi.mock('@linear/sdk', () => {
  mocks.linearImported();
  return { LinearClient: vi.fn() };
});

import { __testInternals } from '../../../../src/lib/lifecycle/workflows.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transitionJiraIssue.mockResolvedValue({ kind: 'transitioned', message: 'Jira PROJ-3: moved from "Done" to "To Do".' });
});

describe('workflow reset steps for Jira issues (PAN-5152)', () => {
  it('moves a reset Jira issue to To Do through the seam', async () => {
    const step = await Effect.runPromise(__testInternals.resetIssueToTodo({ issueId: 'PROJ-3', projectPath: '/p' }));

    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-3', 'todo');
    expect(step).toMatchObject({ step: 'reset:reset-issue', success: true, details: ['Jira PROJ-3: moved from "Done" to "To Do".'] });
    expect(mocks.linearImported).not.toHaveBeenCalled();
  });

  it('moves a canceled Jira issue to Canceled through the seam', async () => {
    mocks.transitionJiraIssue.mockResolvedValue({ kind: 'no-transition', message: 'Jira PROJ-3: no transition reaches "Canceled" (available: none); status left unchanged.' });

    const step = await Effect.runPromise(__testInternals.resetIssueToCanceled({ issueId: 'PROJ-3', projectPath: '/p' }));

    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('PROJ-3', 'canceled');
    expect(step).toMatchObject({ step: 'cancel:reset-issue', success: true });
    expect(mocks.linearImported).not.toHaveBeenCalled();
  });
});
