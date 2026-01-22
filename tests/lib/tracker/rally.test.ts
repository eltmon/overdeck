import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RallyTracker } from '../../../src/lib/tracker/rally.js';
import { TrackerAuthError, IssueNotFoundError } from '../../../src/lib/tracker/interface.js';

// Mock RallyRestApi
const mockQuery = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../../../src/lib/tracker/rally-api.js', () => ({
  RallyRestApi: vi.fn().mockImplementation(() => ({
    query: mockQuery,
    create: mockCreate,
    update: mockUpdate,
    server: 'https://rally1.rallydev.com',
  })),
}));

describe('RallyTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should throw TrackerAuthError when API key is missing', () => {
      expect(() => new RallyTracker({ apiKey: '' })).toThrow(TrackerAuthError);
      expect(() => new RallyTracker({ apiKey: '' })).toThrow('API key is required');
    });

    it('should create tracker with valid API key', () => {
      const tracker = new RallyTracker({ apiKey: 'test_key' });
      expect(tracker.name).toBe('rally');
    });

    it('should accept optional server, workspace, and project', () => {
      const tracker = new RallyTracker({
        apiKey: 'test_key',
        server: 'https://custom.rallydev.com',
        workspace: '/workspace/12345',
        project: '/project/67890',
      });
      expect(tracker.name).toBe('rally');
    });
  });

  describe('listIssues', () => {
    it('should return normalized issues from Rally', async () => {
      const mockResults = [
        {
          ObjectID: '12345',
          FormattedID: 'US123',
          Name: 'User Story Title',
          Description: 'Story description',
          ScheduleState: 'In-Progress',
          State: null,
          Tags: { _tagsNameArray: ['tag1', 'tag2'] },
          Owner: { _refObjectName: 'John Doe' },
          Priority: 'High',
          DueDate: '2024-12-31',
          CreationDate: '2024-01-01T00:00:00Z',
          LastUpdateDate: '2024-01-15T00:00:00Z',
          Parent: null,
          _type: 'HierarchicalRequirement',
        },
        {
          ObjectID: '67890',
          FormattedID: 'DE456',
          Name: 'Defect Title',
          Description: 'Bug description',
          ScheduleState: null,
          State: 'Defined',
          Tags: { _tagsNameArray: [] },
          Owner: null,
          Priority: 'Normal',
          DueDate: null,
          CreationDate: '2024-01-02T00:00:00Z',
          LastUpdateDate: '2024-01-16T00:00:00Z',
          Parent: null,
          _type: 'Defect',
        },
      ];

      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: mockResults,
          TotalResultCount: 2,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const issues = await tracker.listIssues();

      expect(issues).toHaveLength(2);
      expect(issues[0]).toMatchObject({
        id: '12345',
        ref: 'US123',
        title: 'User Story Title',
        description: 'Story description',
        state: 'in_progress',
        labels: ['tag1', 'tag2'],
        assignee: 'John Doe',
        tracker: 'rally',
        priority: 1, // High priority maps to 1
      });

      expect(issues[1]).toMatchObject({
        id: '67890',
        ref: 'DE456',
        title: 'Defect Title',
        state: 'open', // Defined maps to open
        priority: 2, // Normal priority maps to 2
      });
    });

    it('should apply limit filter', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Issue',
            Description: 'Test description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.listIssues({ limit: 25 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 })
      );
    });

    it('should throw TrackerAuthError on 401 error', async () => {
      mockQuery.mockRejectedValue(new Error('Unauthorized'));

      const tracker = new RallyTracker({ apiKey: 'bad_key' });

      await expect(tracker.listIssues()).rejects.toThrow(TrackerAuthError);
    });
  });

  describe('getIssue', () => {
    it('should get issue by FormattedID', async () => {
      const mockResults = [
        {
          ObjectID: '99999',
          FormattedID: 'US999',
          Name: 'Feature Request',
          Description: 'Add this feature',
          ScheduleState: 'Defined',
          State: null,
          Tags: { _tagsNameArray: [] },
          Owner: null,
          Priority: 'Low',
          DueDate: null,
          CreationDate: '2024-01-01T00:00:00Z',
          LastUpdateDate: '2024-01-01T00:00:00Z',
          Parent: null,
          _type: 'HierarchicalRequirement',
        },
      ];

      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: mockResults,
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const issue = await tracker.getIssue('US999');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: '(FormattedID = "US999")',
        })
      );
      expect(issue.ref).toBe('US999');
    });

    it('should throw IssueNotFoundError when issue not found', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [],
          TotalResultCount: 0,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });

      await expect(tracker.getIssue('US999')).rejects.toThrow(IssueNotFoundError);
    });
  });

  describe('updateIssue', () => {
    it('should update issue title and description', async () => {
      // Mock getIssue call (first query)
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Original Title',
            Description: 'Original description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      // Mock query for ref (second query)
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            _type: 'HierarchicalRequirement',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      // Mock final getIssue call
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Updated Title',
            Description: 'Updated description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockUpdate.mockResolvedValue({
        OperationResult: {
          Object: {},
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('US123', {
        title: 'Updated Title',
        description: 'Updated description',
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Name: 'Updated Title',
            Description: 'Updated description',
          }),
        })
      );
    });

    it('should update state for User Story', async () => {
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Story',
            Description: '',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      }).mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            _type: 'HierarchicalRequirement',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      }).mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Story',
            Description: '',
            ScheduleState: 'In-Progress',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockUpdate.mockResolvedValue({
        OperationResult: {
          Object: {},
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('US123', { state: 'in_progress' });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ScheduleState: 'In-Progress',
          }),
        })
      );
    });

    it('should update state for Defect using State field', async () => {
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '67890',
            FormattedID: 'DE456',
            Name: 'Test Defect',
            Description: '',
            ScheduleState: null,
            State: 'Defined',
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'High',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'Defect',
            _ref: '/defect/67890',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      }).mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '67890',
            _ref: '/defect/67890',
            _type: 'Defect',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      }).mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '67890',
            FormattedID: 'DE456',
            Name: 'Test Defect',
            Description: '',
            ScheduleState: null,
            State: 'Completed',
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'High',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'Defect',
            _ref: '/defect/67890',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockUpdate.mockResolvedValue({
        OperationResult: {
          Object: {},
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('DE456', { state: 'closed' });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            State: 'Completed',
          }),
        })
      );
    });

    it('should update priority', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Issue',
            Description: 'Test description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockUpdate.mockResolvedValue({
        OperationResult: {
          Object: {},
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('US123', { priority: 1 }); // High priority

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Priority: 'High',
          }),
        })
      );
    });
  });

  describe('createIssue', () => {
    it('should create issue with all fields', async () => {
      mockCreate.mockResolvedValue({
        CreateResult: {
          Object: {
            FormattedID: 'US200',
            ObjectID: '200',
            _ref: '/hierarchicalrequirement/200',
          },
          Errors: [],
          Warnings: [],
        },
      });

      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '200',
            FormattedID: 'US200',
            Name: 'New Story',
            Description: 'Story description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'High',
            DueDate: '2024-12-31',
            CreationDate: '2024-01-15T00:00:00Z',
            LastUpdateDate: '2024-01-15T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/200',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({
        apiKey: 'test_key',
        project: '/project/123',
      });

      const issue = await tracker.createIssue({
        title: 'New Story',
        description: 'Story description',
        priority: 1,
        dueDate: '2024-12-31',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hierarchicalrequirement',
          data: expect.objectContaining({
            Name: 'New Story',
            Description: 'Story description',
            Priority: 'High',
            DueDate: '2024-12-31',
          }),
        })
      );

      expect(issue.ref).toBe('US200');
    });

    it('should throw error if no project configured', async () => {
      const tracker = new RallyTracker({ apiKey: 'test_key' });

      await expect(tracker.createIssue({ title: 'Test' })).rejects.toThrow(
        'Project is required'
      );
    });
  });

  describe('getComments', () => {
    it('should return comments for issue', async () => {
      // First query: getIssue
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test',
            Description: '',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      })
      // Second query: get artifact with Discussion
      .mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            Discussion: { _ref: '/discussion/111' },
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      })
      // Third query: get conversation posts
      .mockResolvedValueOnce({
        QueryResult: {
          Results: [
            {
              ObjectID: '1001',
              Text: 'First comment',
              User: { _refObjectName: 'John Doe' },
              CreationDate: '2024-01-10T00:00:00Z',
              PostNumber: 1,
            },
            {
              ObjectID: '1002',
              Text: 'Second comment',
              User: { _refObjectName: 'Jane Smith' },
              CreationDate: '2024-01-11T00:00:00Z',
              PostNumber: 2,
            },
          ],
          TotalResultCount: 2,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comments = await tracker.getComments('US123');

      expect(comments).toHaveLength(2);
      expect(comments[0]).toMatchObject({
        id: '1001',
        issueId: 'US123',
        body: 'First comment',
        author: 'John Doe',
      });
      expect(comments[1].body).toBe('Second comment');
    });

    it('should return empty array if no discussion', async () => {
      // First query: getIssue
      mockQuery.mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test',
            Description: '',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      })
      // Second query: get artifact with no Discussion
      .mockResolvedValueOnce({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            Discussion: null,
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comments = await tracker.getComments('US123');

      expect(comments).toEqual([]);
    });
  });

  describe('addComment', () => {
    it('should add comment to issue with existing discussion', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Issue',
            Description: 'Test description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockCreate.mockResolvedValue({
        CreateResult: {
          Object: {
            ObjectID: '2001',
          },
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comment = await tracker.addComment('US123', 'New comment');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversationpost',
          data: expect.objectContaining({
            Text: 'New comment',
          }),
        })
      );

      expect(comment.body).toBe('New comment');
    });

    it('should create discussion if none exists', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Issue',
            Description: 'Test description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockCreate.mockResolvedValue({
        CreateResult: {
          Object: {
            ObjectID: '2001',
          },
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comment = await tracker.addComment('US123', 'First comment');

      expect(mockCreate).toHaveBeenCalled();
      expect(comment.body).toBe('First comment');
    });
  });

  describe('transitionIssue', () => {
    it('should transition issue state', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Issue',
            Description: 'Test description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockUpdate.mockResolvedValue({
        OperationResult: {
          Object: {},
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.transitionIssue('US123', 'closed');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ScheduleState: 'Completed',
          }),
        })
      );
    });
  });

  describe('linkPR', () => {
    it('should add comment with PR link', async () => {
      mockQuery.mockResolvedValue({
        QueryResult: {
          Results: [{
            ObjectID: '12345',
            FormattedID: 'US123',
            Name: 'Test Issue',
            Description: 'Test description',
            ScheduleState: 'Defined',
            State: null,
            Tags: { _tagsNameArray: [] },
            Owner: null,
            Priority: 'Normal',
            DueDate: null,
            CreationDate: '2024-01-01T00:00:00Z',
            LastUpdateDate: '2024-01-01T00:00:00Z',
            Parent: null,
            _type: 'HierarchicalRequirement',
            _ref: '/hierarchicalrequirement/12345',
          }],
          TotalResultCount: 1,
          Errors: [],
          Warnings: [],
        },
      });

      mockCreate.mockResolvedValue({
        CreateResult: {
          Object: {
            ObjectID: '3001',
          },
          Errors: [],
          Warnings: [],
        },
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.linkPR('US123', 'https://github.com/owner/repo/pull/50');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Text: 'Linked Pull Request: https://github.com/owner/repo/pull/50',
          }),
        })
      );
    });
  });

  describe('state mapping', () => {
    it('should map Rally states correctly', async () => {
      const stateTests = [
        { rallyState: 'Defined', expected: 'open' },
        { rallyState: 'In-Progress', expected: 'in_progress' },
        { rallyState: 'Completed', expected: 'closed' },
        { rallyState: 'Accepted', expected: 'closed' },
      ];

      const tracker = new RallyTracker({ apiKey: 'test_key' });

      for (const test of stateTests) {
        mockQuery.mockResolvedValueOnce({
          QueryResult: {
            Results: [{
              ObjectID: '1',
              FormattedID: 'US1',
              Name: 'Test',
              Description: '',
              ScheduleState: test.rallyState,
              State: null,
              Tags: { _tagsNameArray: [] },
              Owner: null,
              Priority: 'Normal',
              DueDate: null,
              CreationDate: '2024-01-01T00:00:00Z',
              LastUpdateDate: '2024-01-01T00:00:00Z',
              Parent: null,
              _type: 'HierarchicalRequirement',
              _ref: '/hierarchicalrequirement/1',
            }],
            TotalResultCount: 1,
            Errors: [],
            Warnings: [],
          },
        });

        const issue = await tracker.getIssue('US1');
        expect(issue.state).toBe(test.expected);
      }
    });
  });

  describe('priority mapping', () => {
    it('should map Rally priorities correctly', async () => {
      const priorityTests = [
        { rallyPriority: 'Resolve Immediately', expected: 0 },
        { rallyPriority: 'High', expected: 1 },
        { rallyPriority: 'Normal', expected: 2 },
        { rallyPriority: 'Low', expected: 3 },
      ];

      const tracker = new RallyTracker({ apiKey: 'test_key' });

      for (const test of priorityTests) {
        mockQuery.mockResolvedValueOnce({
          QueryResult: {
            Results: [{
              ObjectID: '1',
              FormattedID: 'US1',
              Name: 'Test',
              Description: '',
              ScheduleState: 'Defined',
              State: null,
              Tags: { _tagsNameArray: [] },
              Owner: null,
              Priority: test.rallyPriority,
              DueDate: null,
              CreationDate: '2024-01-01T00:00:00Z',
              LastUpdateDate: '2024-01-01T00:00:00Z',
              Parent: null,
              _type: 'HierarchicalRequirement',
              _ref: '/hierarchicalrequirement/1',
            }],
            TotalResultCount: 1,
            Errors: [],
            Warnings: [],
          },
        });

        const issue = await tracker.getIssue('US1');
        expect(issue.priority).toBe(test.expected);
      }
    });
  });
});
