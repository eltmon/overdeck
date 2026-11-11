import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findProjectByPath: vi.fn(),
  createTracker: vi.fn(),
  createTrackerFromConfig: vi.fn(),
  transitionJiraIssue: vi.fn(async () => ({ kind: 'transitioned', message: 'moved' })),
}));

vi.mock('../../../../src/lib/projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/projects.js')>()),
  findProjectByPath: mocks.findProjectByPath,
}));

vi.mock('../../../../src/lib/tracker/factory.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tracker/factory.js')>()),
  createTracker: mocks.createTracker,
  createTrackerFromConfig: mocks.createTrackerFromConfig,
}));

vi.mock('../../../../src/lib/tracker/jira-lifecycle.js', () => ({
  transitionJiraIssue: mocks.transitionJiraIssue,
}));

import { transitionIssueToInProgress, transitionIssueToInReview } from '../../../../src/lib/agents/spawn-prep.js';
import { trackerStateToJiraTarget } from '../../../../src/lib/tracker/jira-status.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProjectByPath.mockReturnValue({
    name: 'Acme',
    path: '/home/user/acme',
    tracker: 'jira',
    issue_prefix: 'ACME',
    github_repo: 'o/acme',
  });
});

describe('spawn-time state transitions for Jira projects (PAN-5152)', () => {
  it('moves a Jira issue to in_progress through the seam, never through GitHub', async () => {
    await transitionIssueToInProgress('ACME-5', '/home/user/acme/workspaces/feature-acme-5');

    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('ACME-5', 'in_progress');
    expect(mocks.createTracker).not.toHaveBeenCalled();
    expect(mocks.createTrackerFromConfig).not.toHaveBeenCalled();
  });

  it('moves a Jira issue to in_review on review handoff', async () => {
    await transitionIssueToInReview('ACME-5', '/home/user/acme/workspaces/feature-acme-5');
    expect(mocks.transitionJiraIssue).toHaveBeenCalledWith('ACME-5', 'in_review');
  });

  it('resolves even when the seam reports an error', async () => {
    mocks.transitionJiraIssue.mockResolvedValue({ kind: 'error', message: 'Jira rejected the credentials (HTTP 401).' });
    await expect(transitionIssueToInProgress('ACME-5', '/home/user/acme/workspaces/feature-acme-5')).resolves.toBeUndefined();
  });
});

describe('trackerStateToJiraTarget', () => {
  it('maps the tracker IssueState to Jira targets (D-10)', () => {
    expect(trackerStateToJiraTarget('open')).toBe('todo');
    expect(trackerStateToJiraTarget('in_progress')).toBe('in_progress');
    expect(trackerStateToJiraTarget('in_review')).toBe('in_review');
    expect(trackerStateToJiraTarget('closed')).toBe('done');
  });
});
