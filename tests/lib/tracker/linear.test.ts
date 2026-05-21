import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { LinearTracker } from '../../../src/lib/tracker/linear.js';
import { TrackerAuthError, IssueNotFoundError } from '../../../src/lib/tracker/interface.js';

function isEffect(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  for (const key of Object.getOwnPropertyNames(v)) {
    if (key.startsWith('~effect/Effect/')) return true;
  }
  return false;
}
function wrap<T extends object>(t: T): any {
  return new Proxy(t, {
    get(target, prop) {
      const value = (target as any)[prop];
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const result = value.apply(target, args);
        if (isEffect(result)) {
          return Effect.runPromise(result as any).catch((err) => {
            if (err && typeof err === 'object' && 'cause' in err && err.cause) {
              const cause = (err as any).cause;
              if (cause && typeof cause === 'object' && '_tag' in cause) throw cause;
            }
            throw err;
          });
        }
        return result;
      };
    },
  });
}

// Mock the Linear SDK
vi.mock('@linear/sdk', () => ({
  LinearClient: vi.fn().mockImplementation(function () { return {
    issues: vi.fn(),
    issue: vi.fn(),
    updateIssue: vi.fn(),
    createIssue: vi.fn(),
    createComment: vi.fn(),
    createAttachment: vi.fn(),
    teams: vi.fn(),
    searchIssues: vi.fn(),
  }; }),
}));

describe('LinearTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw TrackerAuthError when API key is missing', () => {
      expect(() => new LinearTracker('')).toThrow(TrackerAuthError);
      expect(() => new LinearTracker('')).toThrow('API key is required');
    });

    it('should create tracker with valid API key', () => {
      const constructorTracker = new LinearTracker('test-api-key');
      expect(constructorTracker.name).toBe('linear');
    });

    it('should accept optional team parameter', () => {
      const constructorTracker = new LinearTracker('test-api-key', { team: 'MIN' });
      expect(constructorTracker.name).toBe('linear');
    });
  });

  describe('listIssues', () => {
    it('should return normalized issues', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      const mockState = { type: 'started' };
      const mockAssignee = { name: 'John Doe' };
      const mockLabels = { nodes: [{ name: 'bug' }, { name: 'urgent' }] };

      const mockIssue = {
        id: 'issue-123',
        identifier: 'MIN-42',
        title: 'Test Issue',
        description: 'Test description',
        url: 'https://linear.app/issue/MIN-42',
        priority: 2,
        dueDate: new Date('2024-12-31'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        state: Promise.resolve(mockState),
        assignee: Promise.resolve(mockAssignee),
        labels: () => Promise.resolve(mockLabels),
      };

      (mockClient.issues as any).mockResolvedValue({
        nodes: [mockIssue],
      });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      // Replace internal client with mock
      (tracker as any).client = mockClient;

      const issues = await tracker.listIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        id: 'issue-123',
        ref: 'MIN-42',
        title: 'Test Issue',
        description: 'Test description',
        state: 'in_progress',
        labels: ['bug', 'urgent'],
        assignee: 'John Doe',
        tracker: 'linear',
        priority: 2,
      });
    });

    it('should apply filters correctly', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      (mockClient.issues as any).mockResolvedValue({ nodes: [] });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      await tracker.listIssues({
        team: 'MIN',
        state: 'open',
        labels: ['bug'],
        assignee: 'John',
        limit: 25,
      });

      expect(mockClient.issues).toHaveBeenCalledWith({
        first: 25,
        filter: expect.objectContaining({
          team: { key: { eq: 'MIN' } },
          state: { type: { eq: 'unstarted' } },
          labels: { name: { in: ['bug'] } },
          assignee: { name: { containsIgnoreCase: 'John' } },
        }),
      });
    });
  });

  describe('getIssue', () => {
    it('should get issue by UUID', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      const mockState = { type: 'backlog' };
      const mockIssue = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        identifier: 'MIN-42',
        title: 'Test Issue',
        description: 'Description',
        url: 'https://linear.app/issue/MIN-42',
        priority: 3,
        dueDate: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        state: Promise.resolve(mockState),
        assignee: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
      };

      (mockClient.issue as any).mockResolvedValue(mockIssue);

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      const issue = await tracker.getIssue('550e8400-e29b-41d4-a716-446655440000');

      expect(issue.ref).toBe('MIN-42');
      expect(issue.state).toBe('open');
    });

    it('should get issue by identifier', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      const mockState = { type: 'completed' };
      const mockIssue = {
        id: 'issue-uuid',
        identifier: 'MIN-630',
        title: 'Issue by Identifier',
        description: '',
        url: 'https://linear.app/issue/MIN-630',
        priority: 1,
        dueDate: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        state: Promise.resolve(mockState),
        assignee: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
      };

      (mockClient.searchIssues as any).mockResolvedValue({
        nodes: [mockIssue],
      });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      const issue = await tracker.getIssue('MIN-630');

      expect(mockClient.searchIssues).toHaveBeenCalledWith('MIN-630', { first: 1 });
      expect(issue.ref).toBe('MIN-630');
      expect(issue.state).toBe('closed');
    });

    it('should throw IssueNotFoundError for non-existent issue', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      (mockClient.searchIssues as any).mockResolvedValue({ nodes: [] });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      await expect(tracker.getIssue('MIN-999')).rejects.toThrow(IssueNotFoundError);
    });
  });

  describe('createIssue', () => {
    it('should create issue with required fields', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      (mockClient.teams as any).mockResolvedValue({
        nodes: [{ id: 'team-uuid', key: 'MIN' }],
      });

      const mockState = { type: 'backlog' };
      const createdIssue = {
        id: 'new-issue-uuid',
        identifier: 'MIN-100',
        title: 'New Issue',
        description: 'New description',
        url: 'https://linear.app/issue/MIN-100',
        priority: 3,
        dueDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        state: Promise.resolve(mockState),
        assignee: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
      };

      (mockClient.createIssue as any).mockResolvedValue({
        issue: Promise.resolve(createdIssue),
      });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      const issue = await tracker.createIssue({
        title: 'New Issue',
        description: 'New description',
        team: 'MIN',
      });

      expect(mockClient.createIssue).toHaveBeenCalledWith({
        teamId: 'team-uuid',
        title: 'New Issue',
        description: 'New description',
        priority: undefined,
        dueDate: undefined,
      });
      expect(issue.ref).toBe('MIN-100');
    });

    it('should throw error when team is missing', async () => {
      const tracker: any = wrap(new LinearTracker('test-api-key'));

      await expect(
        tracker.createIssue({ title: 'No Team Issue' })
      ).rejects.toThrow('Team is required');
    });

    it('should throw error when team not found', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      (mockClient.teams as any).mockResolvedValue({ nodes: [] });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      await expect(
        tracker.createIssue({ title: 'Issue', team: 'INVALID' })
      ).rejects.toThrow('Team not found: INVALID');
    });
  });

  describe('addComment', () => {
    it('should add comment to issue', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      const mockComment = {
        id: 'comment-uuid',
        body: 'Test comment',
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      };

      (mockClient.createComment as any).mockResolvedValue({
        comment: Promise.resolve(mockComment),
      });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      const comment = await tracker.addComment('issue-uuid', 'Test comment');

      expect(mockClient.createComment).toHaveBeenCalledWith({
        issueId: 'issue-uuid',
        body: 'Test comment',
      });
      expect(comment.body).toBe('Test comment');
      expect(comment.author).toBe('Panopticon');
    });
  });

  describe('linkPR', () => {
    it('should create attachment for PR', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      // Mock getIssue dependency
      const mockState = { type: 'started' };
      const mockIssue = {
        id: 'issue-uuid',
        identifier: 'MIN-42',
        title: 'Test',
        description: '',
        url: 'https://linear.app/issue/MIN-42',
        priority: 3,
        dueDate: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        state: Promise.resolve(mockState),
        assignee: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
      };

      (mockClient.searchIssues as any).mockResolvedValue({ nodes: [mockIssue] });
      (mockClient.createAttachment as any).mockResolvedValue({ success: true });

      const tracker: any = wrap(new LinearTracker('test-api-key'));
      (tracker as any).client = mockClient;

      await tracker.linkPR('MIN-42', 'https://github.com/org/repo/pull/123');

      expect(mockClient.createAttachment).toHaveBeenCalledWith({
        issueId: 'issue-uuid',
        title: 'Pull Request',
        url: 'https://github.com/org/repo/pull/123',
      });
    });
  });

  describe('state mapping', () => {
    it('should map Linear states correctly', async () => {
      const { LinearClient } = await import('@linear/sdk');
      const mockClient = new LinearClient({ apiKey: 'test' });

      const stateTests = [
        { type: 'backlog', expected: 'open' },
        { type: 'unstarted', expected: 'open' },
        { type: 'started', expected: 'in_progress' },
        { type: 'completed', expected: 'closed' },
        { type: 'canceled', expected: 'closed' },
      ];

      for (const test of stateTests) {
        const mockIssue = {
          id: 'test-id',
          identifier: 'MIN-1',
          title: 'Test',
          description: '',
          url: 'https://linear.app',
          priority: 3,
          dueDate: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          state: Promise.resolve({ type: test.type }),
          assignee: Promise.resolve(null),
          labels: () => Promise.resolve({ nodes: [] }),
        };

        (mockClient.issue as any).mockResolvedValue(mockIssue);

        const tracker: any = wrap(new LinearTracker('test-api-key'));
        (tracker as any).client = mockClient;

        const issue = await tracker.getIssue('550e8400-e29b-41d4-a716-446655440000');
        expect(issue.state).toBe(test.expected);
      }
    });
  });
});
