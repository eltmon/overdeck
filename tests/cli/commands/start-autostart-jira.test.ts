import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveTrackerType: vi.fn(),
  resolveGitHubIssue: vi.fn(() => ({ isGitHub: false })),
  createJiraTrackerForIssue: vi.fn(),
  linearClient: vi.fn(),
}));

vi.mock('../../../src/lib/tracker-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/tracker-utils.js')>()),
  resolveTrackerType: mocks.resolveTrackerType,
  resolveGitHubIssue: mocks.resolveGitHubIssue,
}));

vi.mock('../../../src/lib/tracker/factory.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/tracker/factory.js')>()),
  createJiraTrackerForIssue: mocks.createJiraTrackerForIssue,
}));

vi.mock('@linear/sdk', () => ({ LinearClient: mocks.linearClient }));

import { fetchIssueForAutoStart } from '../../../src/cli/commands/start.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveTrackerType.mockReturnValue('jira');
  mocks.resolveGitHubIssue.mockReturnValue({ isGitHub: false });
});

describe('fetchIssueForAutoStart for Jira issues (PAN-5152)', () => {
  it('returns the Jira title, Markdown body and URL', async () => {
    mocks.createJiraTrackerForIssue.mockReturnValue({
      getIssue: () => Effect.succeed({
        title: 'Add Jira support',
        description: '# Goal\nTeams on Jira can use Overdeck.',
        url: 'https://acme.atlassian.net/browse/PROJ-4',
      }),
    });

    await expect(fetchIssueForAutoStart('PROJ-4')).resolves.toEqual({
      issueId: 'PROJ-4',
      title: 'Add Jira support',
      body: '# Goal\nTeams on Jira can use Overdeck.',
      url: 'https://acme.atlassian.net/browse/PROJ-4',
    });
    expect(mocks.createJiraTrackerForIssue).toHaveBeenCalledWith('PROJ-4');
    expect(mocks.linearClient).not.toHaveBeenCalled();
  });

  it('falls back to the id and an empty body when Jira cannot be read', async () => {
    mocks.createJiraTrackerForIssue.mockReturnValue({
      getIssue: () => Effect.fail(new Error('Jira GET /rest/api/3/issue/PROJ-4 failed: 503')),
    });

    await expect(fetchIssueForAutoStart('PROJ-4')).resolves.toEqual({ issueId: 'PROJ-4', title: 'PROJ-4', body: '' });
    expect(mocks.linearClient).not.toHaveBeenCalled();
  });
});
