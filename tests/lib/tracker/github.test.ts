import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubTracker } from '../../../src/lib/tracker/github.js';
import { TrackerAuthError, IssueNotFoundError } from '../../../src/lib/tracker/interface.js';

// Mock Octokit
vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () { return {
    issues: {
      listForRepo: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      listComments: vi.fn(),
      createComment: vi.fn(),
    },
  }; }),
}));

describe('GitHubTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw TrackerAuthError when token is missing', () => {
      expect(() => new GitHubTracker('', 'owner', 'repo')).toThrow(TrackerAuthError);
      expect(() => new GitHubTracker('', 'owner', 'repo')).toThrow('Token is required');
    });

    it('should throw error when owner is missing', () => {
      expect(() => new GitHubTracker('token', '', 'repo')).toThrow('GitHub owner and repo are required');
    });

    it('should throw error when repo is missing', () => {
      expect(() => new GitHubTracker('token', 'owner', '')).toThrow('GitHub owner and repo are required');
    });

    it('should create tracker with valid parameters', () => {
      const tracker = new GitHubTracker('token', 'owner', 'repo');
      expect(tracker.name).toBe('github');
    });
  });

  describe('listIssues', () => {
    it('should return normalized issues excluding PRs', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssues = [
        {
          id: 123,
          number: 42,
          title: 'Bug Report',
          body: 'Something is broken',
          state: 'open',
          labels: [{ name: 'bug' }],
          assignee: { login: 'johndoe' },
          html_url: 'https://github.com/owner/repo/issues/42',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
        },
        {
          id: 124,
          number: 43,
          title: 'PR (should be filtered)',
          body: 'This is a PR',
          state: 'open',
          labels: [],
          assignee: null,
          html_url: 'https://github.com/owner/repo/pull/43',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          pull_request: { url: 'https://api.github.com/...' }, // This marks it as PR
        },
      ];

      (mockOctokit.issues.listForRepo as any).mockResolvedValue({ data: mockIssues });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issues = await tracker.listIssues();

      // Should filter out the PR
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        id: '123',
        ref: '#42',
        title: 'Bug Report',
        description: 'Something is broken',
        state: 'open',
        labels: ['bug'],
        assignee: 'johndoe',
        tracker: 'github',
      });
    });

    it('should apply filters correctly', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      (mockOctokit.issues.listForRepo as any).mockResolvedValue({ data: [] });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.listIssues({
        state: 'closed',
        labels: ['bug', 'urgent'],
        assignee: 'johndoe',
        limit: 25,
      });

      expect(mockOctokit.issues.listForRepo).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        state: 'closed',
        labels: 'bug,urgent',
        assignee: 'johndoe',
        per_page: 25,
      });
    });

    it('should use "all" state when includeClosed is true', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      (mockOctokit.issues.listForRepo as any).mockResolvedValue({ data: [] });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.listIssues({ includeClosed: true });

      expect(mockOctokit.issues.listForRepo).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'all' })
      );
    });

    it('should handle string labels', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssues = [
        {
          id: 123,
          number: 1,
          title: 'Test',
          body: '',
          state: 'open',
          labels: ['string-label'], // Labels can be strings
          assignee: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ];

      (mockOctokit.issues.listForRepo as any).mockResolvedValue({ data: mockIssues });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issues = await tracker.listIssues();

      expect(issues[0].labels).toEqual(['string-label']);
    });
  });

  describe('getIssue', () => {
    it('should get issue by number', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 456,
        number: 99,
        title: 'Feature Request',
        body: 'Add this feature',
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/99',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issue = await tracker.getIssue('99');

      expect(mockOctokit.issues.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 99,
      });
      expect(issue.ref).toBe('#99');
    });

    it('should handle # prefix in issue ref', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 456,
        number: 42,
        title: 'Test',
        body: '',
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issue = await tracker.getIssue('#42');

      expect(mockOctokit.issues.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });
    });

    it('should throw IssueNotFoundError for invalid ref', async () => {
      const tracker = new GitHubTracker('token', 'owner', 'repo');

      await expect(tracker.getIssue('invalid')).rejects.toThrow(IssueNotFoundError);
    });

    it('should throw IssueNotFoundError when issue not found (404)', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const error = new Error('Not Found');
      (error as any).status = 404;
      (mockOctokit.issues.get as any).mockRejectedValue(error);

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await expect(tracker.getIssue('999')).rejects.toThrow(IssueNotFoundError);
    });
  });

  describe('updateIssue', () => {
    it('should update issue title and description', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Updated Title',
        body: 'Updated body',
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issue = await tracker.updateIssue('#42', {
        title: 'Updated Title',
        description: 'Updated body',
      });

      expect(mockOctokit.issues.update).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        title: 'Updated Title',
        body: 'Updated body',
      });
      expect(issue.title).toBe('Updated Title');
    });

    it('should update issue state', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Test',
        body: '',
        state: 'closed',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.updateIssue('42', { state: 'closed' });

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'closed' })
      );
    });

    it('should update labels', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Test',
        body: '',
        state: 'open',
        labels: [{ name: 'bug' }],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.updateIssue('42', { labels: ['bug', 'priority'] });

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['bug', 'priority'] })
      );
    });

    it('should update assignee', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Test',
        body: '',
        state: 'open',
        labels: [],
        assignee: { login: 'newuser' },
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.updateIssue('42', { assignee: 'newuser' });

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ assignees: ['newuser'] })
      );
    });

    it('should clear assignee when set to empty', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Test',
        body: '',
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.updateIssue('42', { assignee: '' });

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ assignees: [] })
      );
    });
  });

  describe('createIssue', () => {
    it('should create issue with all fields', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 789,
        number: 100,
        title: 'New Issue',
        body: 'Issue description',
        state: 'open',
        labels: [{ name: 'enhancement' }],
        assignee: { login: 'developer' },
        html_url: 'https://github.com/owner/repo/issues/100',
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
      };

      (mockOctokit.issues.create as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issue = await tracker.createIssue({
        title: 'New Issue',
        description: 'Issue description',
        labels: ['enhancement'],
        assignee: 'developer',
      });

      expect(mockOctokit.issues.create).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: 'New Issue',
        body: 'Issue description',
        labels: ['enhancement'],
        assignees: ['developer'],
      });
      expect(issue.ref).toBe('#100');
    });

    it('should create issue with minimal fields', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 790,
        number: 101,
        title: 'Minimal Issue',
        body: null,
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/101',
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
      };

      (mockOctokit.issues.create as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const issue = await tracker.createIssue({ title: 'Minimal Issue' });

      expect(mockOctokit.issues.create).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        title: 'Minimal Issue',
        body: undefined,
        labels: undefined,
        assignees: undefined,
      });
      expect(issue.description).toBe('');
    });
  });

  describe('getComments', () => {
    it('should return comments for issue', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockComments = [
        {
          id: 1001,
          body: 'First comment',
          user: { login: 'commenter1' },
          created_at: '2024-01-10T00:00:00Z',
          updated_at: '2024-01-10T00:00:00Z',
        },
        {
          id: 1002,
          body: 'Second comment',
          user: { login: 'commenter2' },
          created_at: '2024-01-11T00:00:00Z',
          updated_at: '2024-01-11T00:00:00Z',
        },
      ];

      (mockOctokit.issues.listComments as any).mockResolvedValue({ data: mockComments });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const comments = await tracker.getComments('42');

      expect(mockOctokit.issues.listComments).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
      });
      expect(comments).toHaveLength(2);
      expect(comments[0]).toMatchObject({
        id: '1001',
        body: 'First comment',
        author: 'commenter1',
      });
    });

    it('should handle missing user', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockComments = [
        {
          id: 1001,
          body: 'Anonymous comment',
          user: null,
          created_at: '2024-01-10T00:00:00Z',
          updated_at: '2024-01-10T00:00:00Z',
        },
      ];

      (mockOctokit.issues.listComments as any).mockResolvedValue({ data: mockComments });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const comments = await tracker.getComments('#42');

      expect(comments[0].author).toBe('Unknown');
    });
  });

  describe('addComment', () => {
    it('should add comment to issue', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockComment = {
        id: 2001,
        body: 'New comment',
        user: { login: 'panopticon-bot' },
        created_at: '2024-01-15T12:00:00Z',
        updated_at: '2024-01-15T12:00:00Z',
      };

      (mockOctokit.issues.createComment as any).mockResolvedValue({ data: mockComment });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      const comment = await tracker.addComment('42', 'New comment');

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'New comment',
      });
      expect(comment.body).toBe('New comment');
      expect(comment.author).toBe('panopticon-bot');
    });
  });

  describe('transitionIssue', () => {
    it('should close issue', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Test',
        body: '',
        state: 'closed',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.transitionIssue('42', 'closed');

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'closed' })
      );
    });

    it('should reopen issue', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockIssue = {
        id: 123,
        number: 42,
        title: 'Test',
        body: '',
        state: 'open',
        labels: [],
        assignee: null,
        html_url: 'https://github.com/owner/repo/issues/42',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      };

      (mockOctokit.issues.update as any).mockResolvedValue({});
      (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.transitionIssue('42', 'open');

      expect(mockOctokit.issues.update).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'open' })
      );
    });
  });

  describe('linkPR', () => {
    it('should add comment with PR link', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const mockComment = {
        id: 3001,
        body: 'Linked Pull Request: https://github.com/owner/repo/pull/50',
        user: { login: 'bot' },
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
      };

      (mockOctokit.issues.createComment as any).mockResolvedValue({ data: mockComment });

      const tracker = new GitHubTracker('token', 'owner', 'repo');
      (tracker as any).octokit = mockOctokit;

      await tracker.linkPR('42', 'https://github.com/owner/repo/pull/50');

      expect(mockOctokit.issues.createComment).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Linked Pull Request: https://github.com/owner/repo/pull/50',
      });
    });
  });

  describe('state mapping', () => {
    it('should map GitHub states correctly', async () => {
      const { Octokit } = await import('@octokit/rest');
      const mockOctokit = new Octokit();

      const stateTests = [
        { ghState: 'open', expected: 'open' },
        { ghState: 'closed', expected: 'closed' },
      ];

      for (const test of stateTests) {
        const mockIssue = {
          id: 123,
          number: 1,
          title: 'Test',
          body: '',
          state: test.ghState,
          labels: [],
          assignee: null,
          html_url: 'https://github.com/owner/repo/issues/1',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        };

        (mockOctokit.issues.get as any).mockResolvedValue({ data: mockIssue });

        const tracker = new GitHubTracker('token', 'owner', 'repo');
        (tracker as any).octokit = mockOctokit;

        const issue = await tracker.getIssue('1');
        expect(issue.state).toBe(test.expected);
      }
    });
  });

  describe('getChildIssues', () => {
    it('returns empty array (GitHub does not support parent-child hierarchy)', async () => {
      const tracker = new GitHubTracker('token', 'owner', 'repo');
      const result = await tracker.getChildIssues('some-parent-id');
      expect(result).toEqual([]);
    });
  });
});
