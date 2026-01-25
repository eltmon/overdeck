import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Issue } from '../../src/dashboard/frontend/src/types.js';

/**
 * Helper to filter done/canceled issues older than 24 hours
 * This is the logic extracted from src/dashboard/server/index.ts for testing
 */
function filterRecentCompletedIssues(issues: Issue[]): Issue[] {
  const oneDayAgoTime = getOneDayAgo().getTime();

  return issues.filter((issue: Issue) => {
    const isDone = issue.status === 'Done' || issue.status === 'Completed' || issue.status === 'Closed';
    const isCanceled = issue.status === 'Canceled' || issue.status === 'Cancelled';

    // Keep all non-done/canceled issues
    if (!isDone && !isCanceled) return true;

    // For done/canceled issues, only keep if completed in last 24 hours
    if (issue.completedAt) {
      const completedTime = new Date(issue.completedAt).getTime();
      return completedTime >= oneDayAgoTime;
    }

    // If no completedAt, exclude done/canceled items (shouldn't happen with new data)
    return false;
  });
}

function getOneDayAgo(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
}

describe('Dashboard Issue Filtering (PAN-76)', () => {
  const now = new Date('2024-01-15T12:00:00Z');
  const oneDayAgo = new Date('2024-01-14T12:00:00Z');
  const twoDaysAgo = new Date('2024-01-13T12:00:00Z');
  const threeDaysAgo = new Date('2024-01-12T12:00:00Z');

  let mockIssues: Issue[];

  beforeEach(() => {
    // Mock Date.now() to have predictable tests
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockIssues = [
      // Active issues (should always be included)
      {
        id: '1',
        identifier: 'TEST-1',
        title: 'Active Todo',
        status: 'Todo',
        priority: 3,
        labels: [],
        url: 'https://example.com/1',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: oneDayAgo.toISOString(),
      },
      {
        id: '2',
        identifier: 'TEST-2',
        title: 'In Progress',
        status: 'In Progress',
        priority: 3,
        labels: [],
        url: 'https://example.com/2',
        createdAt: twoDaysAgo.toISOString(),
        updatedAt: oneDayAgo.toISOString(),
      },
      // Recently completed (should be included)
      {
        id: '3',
        identifier: 'TEST-3',
        title: 'Recently Done',
        status: 'Done',
        priority: 3,
        labels: [],
        url: 'https://example.com/3',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T10:00:00Z').toISOString(), // 2 hours ago
      },
      {
        id: '4',
        identifier: 'TEST-4',
        title: 'Completed status variant',
        status: 'Completed',
        priority: 3,
        labels: [],
        url: 'https://example.com/4',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T08:00:00Z').toISOString(), // 4 hours ago
      },
      {
        id: '5',
        identifier: 'TEST-5',
        title: 'Recently Closed (GitHub)',
        status: 'Closed',
        priority: 3,
        labels: [],
        url: 'https://example.com/5',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: oneDayAgo.toISOString(), // Exactly 24h ago
      },
      // Old completed (should be filtered out)
      {
        id: '6',
        identifier: 'TEST-6',
        title: 'Old Done',
        status: 'Done',
        priority: 3,
        labels: [],
        url: 'https://example.com/6',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: twoDaysAgo.toISOString(),
        completedAt: twoDaysAgo.toISOString(), // 2 days ago - should be filtered
      },
      {
        id: '7',
        identifier: 'TEST-7',
        title: 'Old Completed',
        status: 'Completed',
        priority: 3,
        labels: [],
        url: 'https://example.com/7',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: threeDaysAgo.toISOString(),
        completedAt: threeDaysAgo.toISOString(), // 3 days ago - should be filtered
      },
      // Recently canceled (should be included)
      {
        id: '8',
        identifier: 'TEST-8',
        title: 'Recently Canceled',
        status: 'Canceled',
        priority: 3,
        labels: [],
        url: 'https://example.com/8',
        createdAt: twoDaysAgo.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T06:00:00Z').toISOString(), // 6 hours ago
      },
      {
        id: '9',
        identifier: 'TEST-9',
        title: 'Recently Cancelled (alt spelling)',
        status: 'Cancelled',
        priority: 3,
        labels: [],
        url: 'https://example.com/9',
        createdAt: twoDaysAgo.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T04:00:00Z').toISOString(), // 8 hours ago
      },
      // Old canceled (should be filtered out)
      {
        id: '10',
        identifier: 'TEST-10',
        title: 'Old Canceled',
        status: 'Canceled',
        priority: 3,
        labels: [],
        url: 'https://example.com/10',
        createdAt: threeDaysAgo.toISOString(),
        updatedAt: twoDaysAgo.toISOString(),
        completedAt: twoDaysAgo.toISOString(), // 2 days ago - should be filtered
      },
      // Done without completedAt (should be filtered out as safety measure)
      {
        id: '11',
        identifier: 'TEST-11',
        title: 'Done without completedAt',
        status: 'Done',
        priority: 3,
        labels: [],
        url: 'https://example.com/11',
        createdAt: oneDayAgo.toISOString(),
        updatedAt: now.toISOString(),
        // completedAt is missing
      },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should keep all non-done/canceled issues regardless of age', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    const activeIssues = filtered.filter(i =>
      i.status !== 'Done' &&
      i.status !== 'Completed' &&
      i.status !== 'Closed' &&
      i.status !== 'Canceled' &&
      i.status !== 'Cancelled'
    );

    expect(activeIssues).toHaveLength(2);
    expect(activeIssues.map(i => i.identifier)).toEqual(['TEST-1', 'TEST-2']);
  });

  it('should include done/completed issues from last 24 hours', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    const recentDone = filtered.filter(i =>
      (i.status === 'Done' || i.status === 'Completed' || i.status === 'Closed') &&
      i.completedAt
    );

    expect(recentDone).toHaveLength(3);
    expect(recentDone.map(i => i.identifier).sort()).toEqual(['TEST-3', 'TEST-4', 'TEST-5']);
  });

  it('should exclude done/completed issues older than 24 hours', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    const oldDoneIds = ['TEST-6', 'TEST-7'];
    const hasOldDone = filtered.some(i => oldDoneIds.includes(i.identifier));

    expect(hasOldDone).toBe(false);
  });

  it('should include canceled issues from last 24 hours', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    const recentCanceled = filtered.filter(i =>
      (i.status === 'Canceled' || i.status === 'Cancelled') &&
      i.completedAt
    );

    expect(recentCanceled).toHaveLength(2);
    expect(recentCanceled.map(i => i.identifier).sort()).toEqual(['TEST-8', 'TEST-9']);
  });

  it('should exclude canceled issues older than 24 hours', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    const hasOldCanceled = filtered.some(i => i.identifier === 'TEST-10');

    expect(hasOldCanceled).toBe(false);
  });

  it('should exclude done issues without completedAt field', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    const hasNoCompletedAt = filtered.some(i => i.identifier === 'TEST-11');

    expect(hasNoCompletedAt).toBe(false);
  });

  it('should handle all status variants (Done, Completed, Closed)', () => {
    const testIssues: Issue[] = [
      {
        id: 'done-1',
        identifier: 'DONE-1',
        title: 'Done status',
        status: 'Done',
        priority: 3,
        labels: [],
        url: 'https://example.com/done-1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T11:00:00Z').toISOString(),
      },
      {
        id: 'done-2',
        identifier: 'DONE-2',
        title: 'Completed status',
        status: 'Completed',
        priority: 3,
        labels: [],
        url: 'https://example.com/done-2',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T11:00:00Z').toISOString(),
      },
      {
        id: 'done-3',
        identifier: 'DONE-3',
        title: 'Closed status',
        status: 'Closed',
        priority: 3,
        labels: [],
        url: 'https://example.com/done-3',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T11:00:00Z').toISOString(),
      },
    ];

    const filtered = filterRecentCompletedIssues(testIssues);

    expect(filtered).toHaveLength(3);
  });

  it('should handle both Canceled and Cancelled spellings', () => {
    const testIssues: Issue[] = [
      {
        id: 'cancel-1',
        identifier: 'CANCEL-1',
        title: 'US spelling',
        status: 'Canceled',
        priority: 3,
        labels: [],
        url: 'https://example.com/cancel-1',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T11:00:00Z').toISOString(),
      },
      {
        id: 'cancel-2',
        identifier: 'CANCEL-2',
        title: 'UK spelling',
        status: 'Cancelled',
        priority: 3,
        labels: [],
        url: 'https://example.com/cancel-2',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        completedAt: new Date('2024-01-15T11:00:00Z').toISOString(),
      },
    ];

    const filtered = filterRecentCompletedIssues(testIssues);

    expect(filtered).toHaveLength(2);
  });

  it('should return empty array when given empty array', () => {
    const filtered = filterRecentCompletedIssues([]);

    expect(filtered).toEqual([]);
  });

  it('should preserve issue order', () => {
    const filtered = filterRecentCompletedIssues(mockIssues);

    // Active and recent completed should appear in same order as input
    const filteredIds = filtered.map(i => i.identifier);
    const expectedOrder = ['TEST-1', 'TEST-2', 'TEST-3', 'TEST-4', 'TEST-5', 'TEST-8', 'TEST-9'];

    expect(filteredIds).toEqual(expectedOrder);
  });
});

describe('getOneDayAgo helper', () => {
  it('should return a date exactly 24 hours ago', () => {
    const now = new Date('2024-01-15T12:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const oneDayAgo = getOneDayAgo();

    expect(oneDayAgo.getTime()).toBe(new Date('2024-01-14T12:00:00Z').getTime());

    vi.useRealTimers();
  });

  it('should return a new Date object each time', () => {
    const date1 = getOneDayAgo();
    const date2 = getOneDayAgo();

    // Should be different objects
    expect(date1).not.toBe(date2);
    // But with same value
    expect(date1.getTime()).toBe(date2.getTime());
  });
});
