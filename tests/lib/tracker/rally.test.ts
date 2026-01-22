import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RallyTracker } from '../../../src/lib/tracker/rally.js';
import { TrackerAuthError, IssueNotFoundError } from '../../../src/lib/tracker/interface.js';

// Mock rally SDK
const mockQuery = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('rally', () => ({
  default: vi.fn(() => ({
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

      mockQuery.mockImplementation((config, callback) => {
        callback(null, { Results: mockResults });
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
      mockQuery.mockImplementation((config, callback) => {
        callback(null, { Results: [] });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.listIssues({ limit: 25 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25 }),
        expect.any(Function)
      );
    });

    it('should throw TrackerAuthError on 401 error', async () => {
      mockQuery.mockImplementation((config, callback) => {
        callback({ message: 'Unauthorized' }, null);
      });

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

      mockQuery.mockImplementation((config, callback) => {
        callback(null, { Results: mockResults });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const issue = await tracker.getIssue('US999');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: '(FormattedID = "US999")',
        }),
        expect.any(Function)
      );
      expect(issue.ref).toBe('US999');
    });

    it('should throw IssueNotFoundError when issue not found', async () => {
      mockQuery.mockImplementation((config, callback) => {
        callback(null, { Results: [] });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });

      await expect(tracker.getIssue('US999')).rejects.toThrow(IssueNotFoundError);
    });
  });

  describe('updateIssue', () => {
    it('should update issue title and description', async () => {
      // Mock getIssue call
      mockQuery.mockImplementation((config, callback) => {
        if (config.query?.includes('FormattedID')) {
          callback(null, {
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
          });
        } else {
          callback(null, {
            Results: [{
              ObjectID: '12345',
              _ref: '/hierarchicalrequirement/12345',
              _type: 'HierarchicalRequirement',
            }],
          });
        }
      });

      mockUpdate.mockImplementation((config, callback) => {
        callback(null, { Object: {} });
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
        }),
        expect.any(Function)
      );
    });

    it('should update state for User Story', async () => {
      mockQuery.mockImplementation((config, callback) => {
        if (config.query?.includes('FormattedID')) {
          callback(null, {
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
          });
        } else {
          callback(null, {
            Results: [{
              ObjectID: '12345',
              _ref: '/hierarchicalrequirement/12345',
              _type: 'HierarchicalRequirement',
            }],
          });
        }
      });

      mockUpdate.mockImplementation((config, callback) => {
        callback(null, { Object: {} });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('US123', { state: 'in_progress' });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ScheduleState: 'In-Progress',
          }),
        }),
        expect.any(Function)
      );
    });

    it('should update state for Defect using State field', async () => {
      mockQuery.mockImplementation((config, callback) => {
        if (config.query?.includes('FormattedID')) {
          callback(null, {
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
          });
        } else {
          callback(null, {
            Results: [{
              ObjectID: '67890',
              _ref: '/defect/67890',
              _type: 'Defect',
            }],
          });
        }
      });

      mockUpdate.mockImplementation((config, callback) => {
        callback(null, { Object: {} });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('DE456', { state: 'closed' });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            State: 'Completed',
          }),
        }),
        expect.any(Function)
      );
    });

    it('should update priority', async () => {
      mockQuery.mockImplementation((config, callback) => {
        if (config.query?.includes('FormattedID')) {
          callback(null, {
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
          });
        } else {
          callback(null, {
            Results: [{
              ObjectID: '12345',
              _ref: '/hierarchicalrequirement/12345',
              _type: 'HierarchicalRequirement',
            }],
          });
        }
      });

      mockUpdate.mockImplementation((config, callback) => {
        callback(null, { Object: {} });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.updateIssue('US123', { priority: 1 }); // High priority

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Priority: 'High',
          }),
        }),
        expect.any(Function)
      );
    });
  });

  describe('createIssue', () => {
    it('should create issue with all fields', async () => {
      mockCreate.mockImplementation((config, callback) => {
        callback(null, {
          Object: {
            FormattedID: 'US200',
            ObjectID: '200',
            _ref: '/hierarchicalrequirement/200',
          },
        });
      });

      mockQuery.mockImplementation((config, callback) => {
        callback(null, {
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
          }],
        });
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
        }),
        expect.any(Function)
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
      let callCount = 0;
      mockQuery.mockImplementation((config, callback) => {
        callCount++;
        // First call is getIssue
        if (callCount === 1) {
          callback(null, {
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
            }],
          });
        }
        // Second call is for getting the artifact with Discussion
        else if (config.type === 'artifact') {
          callback(null, {
            Results: [{
              ObjectID: '12345',
              _ref: '/hierarchicalrequirement/12345',
              Discussion: { _ref: '/discussion/111' },
            }],
          });
        }
        // Third call is for getting conversation posts
        else if (config.type === 'conversationpost') {
          callback(null, {
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
          });
        }
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
      let callCount = 0;
      mockQuery.mockImplementation((config, callback) => {
        callCount++;
        // First call is getIssue
        if (callCount === 1) {
          callback(null, {
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
            }],
          });
        }
        // Second call is for getting the artifact with Discussion
        else {
          callback(null, {
            Results: [{
              ObjectID: '12345',
              _ref: '/hierarchicalrequirement/12345',
              Discussion: null,
            }],
          });
        }
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comments = await tracker.getComments('US123');

      expect(comments).toEqual([]);
    });
  });

  describe('addComment', () => {
    it('should add comment to issue with existing discussion', async () => {
      mockQuery.mockImplementation((config, callback) => {
        callback(null, {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            Discussion: { _ref: '/discussion/111' },
          }],
        });
      });

      mockCreate.mockImplementation((config, callback) => {
        callback(null, {
          Object: {
            ObjectID: '2001',
          },
        });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comment = await tracker.addComment('US123', 'New comment');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversationpost',
          data: expect.objectContaining({
            Text: 'New comment',
          }),
        }),
        expect.any(Function)
      );

      expect(comment.body).toBe('New comment');
    });

    it('should create discussion if none exists', async () => {
      mockQuery.mockImplementation((config, callback) => {
        callback(null, {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            Discussion: null,
          }],
        });
      });

      mockCreate.mockImplementation((config, callback) => {
        callback(null, {
          Object: {
            ObjectID: '2001',
          },
        });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      const comment = await tracker.addComment('US123', 'First comment');

      expect(mockCreate).toHaveBeenCalled();
      expect(comment.body).toBe('First comment');
    });
  });

  describe('transitionIssue', () => {
    it('should transition issue state', async () => {
      mockQuery.mockImplementation((config, callback) => {
        if (config.query?.includes('FormattedID')) {
          callback(null, {
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
          });
        } else {
          callback(null, {
            Results: [{
              ObjectID: '12345',
              _ref: '/hierarchicalrequirement/12345',
              _type: 'HierarchicalRequirement',
            }],
          });
        }
      });

      mockUpdate.mockImplementation((config, callback) => {
        callback(null, { Object: {} });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.transitionIssue('US123', 'closed');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ScheduleState: 'Completed',
          }),
        }),
        expect.any(Function)
      );
    });
  });

  describe('linkPR', () => {
    it('should add comment with PR link', async () => {
      mockQuery.mockImplementation((config, callback) => {
        callback(null, {
          Results: [{
            ObjectID: '12345',
            _ref: '/hierarchicalrequirement/12345',
            Discussion: { _ref: '/discussion/111' },
          }],
        });
      });

      mockCreate.mockImplementation((config, callback) => {
        callback(null, {
          Object: {
            ObjectID: '3001',
          },
        });
      });

      const tracker = new RallyTracker({ apiKey: 'test_key' });
      await tracker.linkPR('US123', 'https://github.com/owner/repo/pull/50');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            Text: 'Linked Pull Request: https://github.com/owner/repo/pull/50',
          }),
        }),
        expect.any(Function)
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

      for (const test of stateTests) {
        mockQuery.mockImplementation((config, callback) => {
          callback(null, {
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
            }],
          });
        });

        const tracker = new RallyTracker({ apiKey: 'test_key' });
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

      for (const test of priorityTests) {
        mockQuery.mockImplementation((config, callback) => {
          callback(null, {
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
            }],
          });
        });

        const tracker = new RallyTracker({ apiKey: 'test_key' });
        const issue = await tracker.getIssue('US1');
        expect(issue.priority).toBe(test.expected);
      }
    });
  });
});
