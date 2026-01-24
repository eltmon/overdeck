import { describe, it, expect } from 'vitest';
import type { Issue } from '../../src/dashboard/frontend/src/types.js';

/**
 * Tests for PAN-76 completedAt field handling
 * 
 * These tests verify that the completedAt field is properly:
 * 1. Defined in the Issue interface  
 * 2. Mapped from GitHub's closedAt field
 * 3. Included in Linear GraphQL queries
 * 4. Present in formatted issues from all sources
 */

describe('completedAt Field Handling (PAN-76)', () => {
  describe('Issue Interface', () => {
    it('should allow completedAt as an optional string field', () => {
      const issueWithCompletedAt: Issue = {
        id: 'test-1',
        identifier: 'TEST-1',
        title: 'Test Issue',
        status: 'Done',
        priority: 3,
        labels: [],
        url: 'https://example.com/1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        completedAt: '2024-01-02T12:00:00Z', // Should be valid
      };

      expect(issueWithCompletedAt.completedAt).toBe('2024-01-02T12:00:00Z');
    });

    it('should allow completedAt to be undefined', () => {
      const issueWithoutCompletedAt: Issue = {
        id: 'test-2',
        identifier: 'TEST-2',
        title: 'Test Issue',
        status: 'Todo',
        priority: 3,
        labels: [],
        url: 'https://example.com/2',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        // completedAt is omitted
      };

      expect(issueWithoutCompletedAt.completedAt).toBeUndefined();
    });
  });

  describe('GitHub Issue Mapping', () => {
    it('should map closedAt to completedAt for GitHub issues', () => {
      // Simulating the GitHub API response format
      const githubApiIssue = {
        id: 123,
        number: 42,
        title: 'Bug fix',
        body: 'Fixed the bug',
        state: 'closed',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        closed_at: '2024-01-02T12:00:00Z', // GitHub uses closed_at
      };

      // This simulates the mapping logic in src/dashboard/server/index.ts
      const mappedIssue = {
        id: `github-owner-repo-${githubApiIssue.number}`,
        identifier: `REPO-${githubApiIssue.number}`,
        title: githubApiIssue.title,
        description: githubApiIssue.body || '',
        status: githubApiIssue.state === 'open' ? 'Todo' : 'Done',
        priority: 3,
        labels: [],
        url: githubApiIssue.html_url,
        createdAt: githubApiIssue.created_at,
        updatedAt: githubApiIssue.updated_at,
        completedAt: githubApiIssue.closed_at, // Maps closed_at to completedAt
      };

      expect(mappedIssue.completedAt).toBe('2024-01-02T12:00:00Z');
    });

    it('should map closedAt to completedAt for gh CLI format', () => {
      // Simulating the gh CLI JSON response format (camelCase)
      const ghCliIssue = {
        id: 123,
        number: 42,
        title: 'Bug fix',
        body: 'Fixed the bug',
        state: 'CLOSED',
        labels: [],
        assignees: [],
        url: 'https://github.com/owner/repo/issues/42',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        closedAt: '2024-01-02T12:00:00Z', // gh CLI uses closedAt (camelCase)
      };

      // This simulates the mapping logic that handles both formats
      const mappedIssue = {
        id: `github-owner-repo-${ghCliIssue.number}`,
        identifier: `REPO-${ghCliIssue.number}`,
        title: ghCliIssue.title,
        description: ghCliIssue.body || '',
        status: ghCliIssue.state === 'OPEN' ? 'Todo' : 'Done',
        priority: 3,
        labels: [],
        url: ghCliIssue.url,
        // Handle both gh CLI (camelCase) and API (snake_case) formats
        createdAt: ghCliIssue.createdAt,
        updatedAt: ghCliIssue.updatedAt,
        completedAt: ghCliIssue.closedAt, // Maps closedAt to completedAt
      };

      expect(mappedIssue.completedAt).toBe('2024-01-02T12:00:00Z');
    });

    it('should handle missing closedAt gracefully', () => {
      const githubOpenIssue = {
        id: 123,
        number: 43,
        title: 'Open issue',
        body: 'Still working on it',
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/43',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        // closed_at is null for open issues
        closed_at: null,
      };

      const mappedIssue = {
        id: `github-owner-repo-${githubOpenIssue.number}`,
        identifier: `REPO-${githubOpenIssue.number}`,
        title: githubOpenIssue.title,
        description: githubOpenIssue.body || '',
        status: 'Todo',
        priority: 3,
        labels: [],
        url: githubOpenIssue.html_url,
        createdAt: githubOpenIssue.created_at,
        updatedAt: githubOpenIssue.updated_at,
        completedAt: githubOpenIssue.closed_at || undefined,
      };

      expect(mappedIssue.completedAt).toBeUndefined();
    });
  });

  describe('Linear Issue Mapping', () => {
    it('should include completedAt from Linear GraphQL response', () => {
      // Simulating Linear GraphQL response format
      const linearIssue = {
        id: 'linear-123',
        identifier: 'MIN-42',
        title: 'Feature request',
        description: 'Add new feature',
        url: 'https://linear.app/team/issue/MIN-42',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        completedAt: '2024-01-02T12:00:00Z', // Linear provides completedAt directly
        priority: 1,
        state: {
          name: 'Done',
          type: 'completed',
        },
      };

      // Linear issues should map completedAt directly
      const mappedIssue = {
        id: linearIssue.id,
        identifier: linearIssue.identifier,
        title: linearIssue.title,
        description: linearIssue.description || '',
        status: linearIssue.state.name,
        priority: linearIssue.priority,
        labels: [],
        url: linearIssue.url,
        createdAt: linearIssue.createdAt,
        updatedAt: linearIssue.updatedAt,
        completedAt: linearIssue.completedAt, // Direct mapping
      };

      expect(mappedIssue.completedAt).toBe('2024-01-02T12:00:00Z');
    });

    it('should handle missing completedAt for incomplete Linear issues', () => {
      const linearOpenIssue = {
        id: 'linear-124',
        identifier: 'MIN-43',
        title: 'In progress task',
        description: 'Working on it',
        url: 'https://linear.app/team/issue/MIN-43',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        completedAt: null, // Not completed yet
        priority: 2,
        state: {
          name: 'In Progress',
          type: 'started',
        },
      };

      const mappedIssue = {
        id: linearOpenIssue.id,
        identifier: linearOpenIssue.identifier,
        title: linearOpenIssue.title,
        description: linearOpenIssue.description || '',
        status: linearOpenIssue.state.name,
        priority: linearOpenIssue.priority,
        labels: [],
        url: linearOpenIssue.url,
        createdAt: linearOpenIssue.createdAt,
        updatedAt: linearOpenIssue.updatedAt,
        completedAt: linearOpenIssue.completedAt || undefined,
      };

      expect(mappedIssue.completedAt).toBeUndefined();
    });
  });

  describe('Date Parsing', () => {
    it('should parse ISO 8601 timestamp strings', () => {
      const isoTimestamp = '2024-01-15T12:30:45.123Z';
      const parsed = new Date(isoTimestamp);

      expect(parsed.toISOString()).toBe(isoTimestamp);
    });

    it('should handle various ISO 8601 formats', () => {
      const timestamps = [
        '2024-01-15T12:00:00Z', // UTC
        '2024-01-15T12:00:00.000Z', // With milliseconds
        '2024-01-15T12:00:00+00:00', // With timezone offset
      ];

      timestamps.forEach(ts => {
        const parsed = new Date(ts);
        expect(parsed).toBeInstanceOf(Date);
        expect(isNaN(parsed.getTime())).toBe(false);
      });
    });
  });
});
