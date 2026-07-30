/**
 * LinearTracker.getIssue must resolve identifier-form ids ("MIN-852") through
 * client.issue(), which accepts identifiers and returns a full Issue with lazy
 * relations. The old path went through searchIssues, whose IssueSearchResult
 * nodes lack the labels() relation — normalizeIssue threw, and the LinearApiError
 * catchTag masked it as IssueNotFoundError for every identifier lookup (PAN-3337).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { LinearTracker } from '../linear.js';

const fullIssue = {
  id: '22222222-2222-2222-2222-222222222222',
  identifier: 'MIN-852',
  title: 'Habits: full bug audit',
  description: 'desc',
  url: 'https://linear.app/x/issue/MIN-852',
  priority: 0,
  dueDate: undefined,
  createdAt: new Date('2026-06-11T00:00:00Z'),
  updatedAt: new Date('2026-07-22T00:00:00Z'),
  state: Promise.resolve({ type: 'completed' }),
  assignee: Promise.resolve(undefined),
  labels: () => Promise.resolve({ nodes: [{ name: 'closed-out' }] }),
};

describe('LinearTracker.getIssue', () => {
  let issueMock: ReturnType<typeof vi.fn>;
  let searchIssuesMock: ReturnType<typeof vi.fn>;
  let tracker: LinearTracker;

  beforeEach(() => {
    issueMock = vi.fn().mockResolvedValue(fullIssue);
    searchIssuesMock = vi.fn();
    tracker = new LinearTracker('test-key');
    (tracker as unknown as { client: unknown }).client = {
      issue: issueMock,
      searchIssues: searchIssuesMock,
    };
  });

  it('resolves an identifier-form id through client.issue, never search', async () => {
    const issue = await Effect.runPromise(tracker.getIssue('MIN-852'));

    expect(issueMock).toHaveBeenCalledWith('MIN-852');
    expect(searchIssuesMock).not.toHaveBeenCalled();
    expect(issue.title).toBe('Habits: full bug audit');
    expect(issue.state).toBe('closed');
    expect(issue.labels).toEqual(['closed-out']);
  });

  it('resolves a UUID id through client.issue', async () => {
    const issue = await Effect.runPromise(
      tracker.getIssue('22222222-2222-2222-2222-222222222222'),
    );

    expect(issueMock).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
    expect(issue.ref).toBe('MIN-852');
  });

  it('fails with IssueNotFoundError for a non-issue-shaped id', async () => {
    await expect(
      Effect.runPromise(tracker.getIssue('not-an-issue-id')),
    ).rejects.toThrow();
    expect(issueMock).not.toHaveBeenCalled();
  });
});
