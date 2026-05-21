import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Cause, Effect, Exit } from 'effect';
import { RallyTracker } from '../../../src/lib/tracker/rally.js';
import { TrackerAuthError, IssueNotFoundError } from '../../../src/lib/tracker/interface.js';
import { TrackerError } from '../../../src/lib/errors.js';

// Mock RallyRestApi — all methods return Effects (PAN-1249 Effect migration).
// Tests script behaviour via mockQuery.mockResolvedValue / mockRejectedValue
// (legacy Promise pattern). The production code expects Effect-returning
// methods, so each mock is wrapped via Effect.tryPromise to translate the
// Promise behaviour from vi.fn() into an Effect at the call site.
const mockQuery = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

// Suspend so mockQuery is invoked inside the Effect runtime; `Promise.resolve`
// auto-unwraps mock return values whether they are sync values or Promises
// (vi.fn().mockResolvedValue / mockRejectedValue return Promises directly).
const queryEffect = (...args: any[]) => Effect.tryPromise({
  try: () => Promise.resolve().then(() => mockQuery(...args)),
  catch: (cause) => cause as any,
});
const createEffect = (...args: any[]) => Effect.tryPromise({
  try: () => Promise.resolve().then(() => mockCreate(...args)),
  catch: (cause) => cause as any,
});
const updateEffect = (...args: any[]) => Effect.tryPromise({
  try: () => Promise.resolve().then(() => mockUpdate(...args)),
  catch: (cause) => cause as any,
});

vi.mock('../../../src/lib/tracker/rally-api.js', () => ({
  RallyRestApi: vi.fn().mockImplementation(function () { return {
    query: queryEffect,
    create: createEffect,
    update: updateEffect,
    server: 'https://rally1.rallydev.com',
  }; }),
}));

// Helpers to run Effects returned by tracker methods. Tests in this file
// originally `await`ed Promise-returning tracker methods; post-migration the
// methods return Effects, so each call site is wrapped via run()/runFail().
function run<A, E>(eff: Effect.Effect<A, E, never>): Promise<A> {
  return Effect.runPromise(eff);
}
async function runFail<A, E>(eff: Effect.Effect<A, E, never>): Promise<unknown> {
  const exit = await Effect.runPromise(Effect.exit(eff));
  if (Exit.isSuccess(exit))
    throw new Error('Expected effect to fail, got: ' + JSON.stringify(exit.value));
  return Cause.squash(exit.cause);
}

/**
 * Wraps a RallyTracker so each Effect-returning method becomes Promise-returning
 * (auto-runs the Effect, throws the cause on failure). Keeps the legacy test
 * shape `await tracker.X(...)` working unchanged.
 */
function isEffect(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  // Effect 4.x exposes a single internal key `~effect/Effect/args`. Detect by
  // checking for any key in that namespace.
  for (const key of Object.getOwnPropertyNames(v)) {
    if (key.startsWith('~effect/Effect/')) return true;
  }
  return false;
}
function wrap(t: RallyTracker): any {
  const handler: ProxyHandler<RallyTracker> = {
    get(target, prop) {
      const value = (target as any)[prop];
      if (typeof value !== 'function') return value;
      return (...args: any[]) => {
        const result = value.apply(target, args);
        if (isEffect(result)) {
          return Effect.runPromise(result as any).catch((err) => {
            // Effect.runPromise wraps the cause in a FiberFailure — unwrap to
            // the original tagged error class instance for `.rejects.toThrow`.
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
  };
  return new Proxy(t, handler);
}

/** Helper: build a WSAPI response wrapping the given results. */
function wsapiResponse(results: any[], totalCount?: number) {
  return {
    QueryResult: {
      Results: results,
      TotalResultCount: totalCount ?? results.length,
      Errors: [],
      Warnings: [],
    },
  };
}

/** Helper: return an empty WSAPI result for every call. */
function setupEmptyResults() {
  mockQuery.mockReturnValue(wsapiResponse([]));
}

/**
 * Helper: set up mockQuery to return specific results for each artifact type
 * in the order: hierarchicalrequirement, defect, task, portfolioitem/feature (matching QUERYABLE_TYPES).
 */
function setupTypeResults(
  stories: any[] = [],
  defects: any[] = [],
  tasks: any[] = [],
  features: any[] = [],
) {
  mockQuery
    .mockReturnValueOnce(wsapiResponse(stories))
    .mockReturnValueOnce(wsapiResponse(defects))
    .mockReturnValueOnce(wsapiResponse(tasks))
    .mockReturnValueOnce(wsapiResponse(features));
}

const sampleStory = {
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
};

const sampleDefect = {
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
};

const sampleTask = {
  ObjectID: '11111',
  FormattedID: 'TA111',
  Name: 'Task Title',
  Description: 'Task description',
  ScheduleState: null,
  State: 'In-Progress',
  Tags: { _tagsNameArray: ['backend'] },
  Owner: { _refObjectName: 'Jane Smith' },
  Priority: 'Low',
  DueDate: null,
  CreationDate: '2024-01-03T00:00:00Z',
  LastUpdateDate: '2024-01-17T00:00:00Z',
  Parent: null,
  _type: 'Task',
};

const sampleFeature = {
  ObjectID: '50000',
  FormattedID: 'F100',
  Name: 'Feature Title',
  Description: 'Feature description',
  ScheduleState: null,
  State: 'Developing',
  Tags: { _tagsNameArray: [] },
  Owner: { _refObjectName: 'Bob Builder' },
  Priority: 'High',
  DueDate: null,
  CreationDate: '2024-01-01T00:00:00Z',
  LastUpdateDate: '2024-01-20T00:00:00Z',
  Parent: null,
  _type: 'PortfolioItem/Feature',
};

const sampleStoryWithParent = {
  ...sampleStory,
  ObjectID: '12346',
  FormattedID: 'US124',
  Name: 'Child Story',
  PortfolioItem: {
    _ref: '/portfolioitem/feature/50000',
    _refObjectName: 'Feature Title',
    FormattedID: 'F100',
  },
};

describe('RallyTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
  });

  describe('constructor', () => {
    it('should throw TrackerAuthError when API key is missing', () => {
      expect(() => new RallyTracker({ apiKey: '' })).toThrow(TrackerAuthError);
      expect(() => new RallyTracker({ apiKey: '' })).toThrow('API key is required');
    });

    it('should create tracker with valid API key', () => {
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
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
    it('should query each artifact type separately and merge results (PAN-168)', async () => {
      setupTypeResults([sampleStory], [sampleDefect], [sampleTask]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      // Should make 4 separate queries (one per type)
      expect(mockQuery).toHaveBeenCalledTimes(4);

      // Verify query types
      expect(mockQuery.mock.calls[0][0].type).toBe('hierarchicalrequirement');
      expect(mockQuery.mock.calls[1][0].type).toBe('defect');
      expect(mockQuery.mock.calls[2][0].type).toBe('task');
      expect(mockQuery.mock.calls[3][0].type).toBe('portfolioitem/feature');

      // Should return all 3 merged results (features returned empty)
      expect(issues).toHaveLength(3);
    });

    it('should normalize issues from all types correctly', async () => {
      setupTypeResults([sampleStory], [sampleDefect], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      // Issues sorted by updatedAt descending: defect (Jan 16) then story (Jan 15)
      expect(issues).toHaveLength(2);
      expect(issues[0]).toMatchObject({
        id: '67890',
        ref: 'DE456',
        title: 'Defect Title',
        state: 'open', // Defined maps to open
        priority: 2,   // Normal
      });
      expect(issues[1]).toMatchObject({
        id: '12345',
        ref: 'US123',
        title: 'User Story Title',
        state: 'in_progress',
        labels: ['tag1', 'tag2'],
        assignee: 'John Doe',
        tracker: 'rally',
        priority: 1, // High
      });
    });

    it('should sort results by updatedAt descending', async () => {
      setupTypeResults([sampleStory], [sampleDefect], [sampleTask]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      // Task (Jan 17) > Defect (Jan 16) > Story (Jan 15)
      expect(issues[0].ref).toBe('TA111');
      expect(issues[1].ref).toBe('DE456');
      expect(issues[2].ref).toBe('US123');
    });

    it('should apply limit across merged results', async () => {
      setupTypeResults([sampleStory], [sampleDefect], [sampleTask]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues({ limit: 2 });

      // Should pass limit to each individual query
      expect(mockQuery.mock.calls[0][0].limit).toBe(2);

      // But only return top 2 after merging
      expect(issues).toHaveLength(2);
    });

    it('should pass workspace and project to each type query', async () => {
      setupTypeResults([], [], []);

      const tracker = wrap(new RallyTracker({
        apiKey: 'test_key',
        workspace: '/workspace/12345',
        project: '/project/67890',
      }));
      await tracker.listIssues();

      for (const call of mockQuery.mock.calls) {
        expect(call[0].workspace).toBe('/workspace/12345');
        expect(call[0].project).toBe('/project/67890');
        expect(call[0].projectScopeDown).toBe(true);
      }
    });

    it('should continue if one type query fails (non-auth)', async () => {
      mockQuery
        .mockResolvedValueOnce(wsapiResponse([sampleStory])) // stories succeed
        .mockRejectedValueOnce(new TrackerError({ tracker: 'rally', operation: 'query', message: 'Some query error' }))  // defects fail
        .mockResolvedValueOnce(wsapiResponse([sampleTask]))   // tasks succeed
        .mockResolvedValueOnce(wsapiResponse([]));             // features empty

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      // Should still return stories + tasks
      expect(issues).toHaveLength(2);
      expect(issues.map(i => i.ref).sort()).toEqual(['TA111', 'US123']);
    });

    it('should throw TrackerAuthError on 401 error', async () => {
      mockQuery.mockRejectedValue(new TrackerAuthError({ tracker: 'rally', message: 'Unauthorized' }));

      const tracker = wrap(new RallyTracker({ apiKey: 'bad_key' }));

      await expect(tracker.listIssues()).rejects.toThrow(TrackerAuthError);
    });

    it('should return empty array when all types have no results', async () => {
      setupTypeResults([], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues).toHaveLength(0);
    });
  });

  describe('getIssue', () => {
    it('should get issue by FormattedID', async () => {
      const mockResults = [{
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
      }];

      mockQuery.mockResolvedValue(wsapiResponse(mockResults));

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issue = await tracker.getIssue('US999');

      // getIssue still uses generic artifact endpoint (no state filter)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'artifact',
          query: '(FormattedID = "US999")',
        })
      );
      expect(issue.ref).toBe('US999');
    });

    it('should throw IssueNotFoundError when issue not found', async () => {
      mockQuery.mockResolvedValue(wsapiResponse([]));

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));

      await expect(tracker.getIssue('US999')).rejects.toThrow(IssueNotFoundError);
    });
  });

  describe('updateIssue', () => {
    it('should update issue title and description', async () => {
      // Mock combined fetch (all fields + ObjectID/_ref/_type)
      mockQuery.mockResolvedValueOnce(wsapiResponse([{
        ...sampleStory,
        ObjectID: '12345',
        _ref: '/hierarchicalrequirement/12345',
        _type: 'HierarchicalRequirement',
      }]));

      mockUpdate.mockResolvedValue({
        OperationResult: { Object: {}, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
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

    it('should update state for User Story using ScheduleState', async () => {
      mockQuery
        .mockResolvedValueOnce(wsapiResponse([{
          ...sampleStory,
          ObjectID: '12345',
          _ref: '/hierarchicalrequirement/12345',
          _type: 'HierarchicalRequirement',
        }]))
;

      mockUpdate.mockResolvedValue({
        OperationResult: { Object: {}, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
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
      mockQuery
        .mockResolvedValueOnce(wsapiResponse([{
          ...sampleDefect,
          ObjectID: '67890',
          _ref: '/defect/67890',
          _type: 'Defect',
        }]));

      mockUpdate.mockResolvedValue({
        OperationResult: { Object: {}, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.updateIssue('DE456', { state: 'closed' });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            State: 'Closed',
          }),
        })
      );
    });

    it('should update priority', async () => {
      mockQuery.mockResolvedValue(wsapiResponse([{
        ...sampleStory,
        ObjectID: '12345',
        _ref: '/hierarchicalrequirement/12345',
        _type: 'HierarchicalRequirement',
      }]));

      mockUpdate.mockResolvedValue({
        OperationResult: { Object: {}, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
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
          Object: { FormattedID: 'US200', ObjectID: '200', _ref: '/hierarchicalrequirement/200' },
          Errors: [],
          Warnings: [],
        },
      });

      mockQuery.mockResolvedValue(wsapiResponse([{
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
      }]));

      const tracker = wrap(new RallyTracker({
        apiKey: 'test_key',
        project: '/project/123',
      }));

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
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));

      await expect(tracker.createIssue({ title: 'Test' })).rejects.toThrow(
        'Project is required'
      );
    });
  });

  describe('getComments', () => {
    it('should return comments for issue', async () => {
      // First query: get artifact with Discussion
      mockQuery.mockResolvedValueOnce(wsapiResponse([{
        ObjectID: '12345',
        _ref: '/hierarchicalrequirement/12345',
        Discussion: { _ref: '/discussion/111' },
      }]))
      // Second query: get conversation posts
      .mockResolvedValueOnce(wsapiResponse([
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
      ]));

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
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
      // First query: get artifact with no Discussion
      mockQuery.mockResolvedValueOnce(wsapiResponse([{
        ObjectID: '12345',
        _ref: '/hierarchicalrequirement/12345',
        Discussion: null,
      }]));

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const comments = await tracker.getComments('US123');

      expect(comments).toEqual([]);
    });
  });

  describe('addComment', () => {
    it('should add comment to issue with existing discussion', async () => {
      mockQuery.mockResolvedValue(wsapiResponse([{
        ...sampleStory,
        _ref: '/hierarchicalrequirement/12345',
      }]));

      mockCreate.mockResolvedValue({
        CreateResult: { Object: { ObjectID: '2001' }, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const comment = await tracker.addComment('US123', 'New comment');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversationpost',
          data: expect.objectContaining({ Text: 'New comment' }),
        })
      );
      expect(comment.body).toBe('New comment');
    });

    it('should create discussion if none exists', async () => {
      mockQuery.mockResolvedValue(wsapiResponse([{
        ...sampleStory,
        _ref: '/hierarchicalrequirement/12345',
      }]));

      mockCreate.mockResolvedValue({
        CreateResult: { Object: { ObjectID: '2001' }, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const comment = await tracker.addComment('US123', 'First comment');

      expect(mockCreate).toHaveBeenCalled();
      expect(comment.body).toBe('First comment');
    });
  });

  describe('transitionIssue', () => {
    it('should transition issue state', async () => {
      mockQuery.mockResolvedValue(wsapiResponse([{
        ...sampleStory,
        _ref: '/hierarchicalrequirement/12345',
      }]));

      mockUpdate.mockResolvedValue({
        OperationResult: { Object: {}, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.transitionIssue('US123', 'closed');

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ScheduleState: 'Completed' }),
        })
      );
    });
  });

  describe('linkPR', () => {
    it('should add comment with PR link', async () => {
      mockQuery.mockResolvedValue(wsapiResponse([{
        ...sampleStory,
        _ref: '/hierarchicalrequirement/12345',
      }]));

      mockCreate.mockResolvedValue({
        CreateResult: { Object: { ObjectID: '3001' }, Errors: [], Warnings: [] },
      });

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
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

  describe('buildQueryStringForType (via listIssues)', () => {
    // Helper to get the query passed to mockQuery for a specific type index
    // 0 = hierarchicalrequirement, 1 = defect, 2 = task
    function getQueryForType(typeIndex: number): string {
      return mockQuery.mock.calls[typeIndex][0].query;
    }

    it('should return empty string when includeClosed is true and no other filters', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ includeClosed: true });

      for (let i = 0; i < 4; i++) {
        expect(getQueryForType(i)).toBe('');
      }
    });

    it('should use ScheduleState for stories and State for defects/tasks/features (PAN-168)', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ includeClosed: false });

      // Stories: exclude by ScheduleState
      const storyQuery = getQueryForType(0);
      expect(storyQuery).toBe('((ScheduleState != "Completed") AND (ScheduleState != "Accepted"))');

      // Defects: exclude by State
      const defectQuery = getQueryForType(1);
      expect(defectQuery).toBe('(State != "Closed")');

      // Tasks: exclude by State
      const taskQuery = getQueryForType(2);
      expect(taskQuery).toBe('(State != "Completed")');

      // Features: exclude by State
      const featureQuery = getQueryForType(3);
      expect(featureQuery).toBe('(State != "Done")');
    });

    it('should use type-specific state field for state filter', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ state: 'in_progress' });

      // Stories: ScheduleState
      const storyQuery = getQueryForType(0);
      expect(storyQuery).toContain('(ScheduleState = "In-Progress")');

      // Defects: State (defect "in_progress" maps to "Open")
      const defectQuery = getQueryForType(1);
      expect(defectQuery).toContain('(State = "Open")');

      // Tasks: State (tasks use story vocabulary)
      const taskQuery = getQueryForType(2);
      expect(taskQuery).toContain('(State = "In-Progress")');

      // Features: State (features "in_progress" maps to "Developing")
      const featureQuery = getQueryForType(3);
      expect(featureQuery).toContain('(State = "Developing")');
    });

    it('should generate correct query for assignee filter', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ assignee: 'John Doe', includeClosed: true });

      // All types should have same assignee filter
      for (let i = 0; i < 4; i++) {
        expect(getQueryForType(i)).toBe('(Owner.Name contains "John Doe")');
      }
    });

    it('should generate correct query for labels filter', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ labels: ['bug', 'urgent'], includeClosed: true });

      for (let i = 0; i < 4; i++) {
        expect(getQueryForType(i)).toBe('((Tags.Name contains "bug") AND (Tags.Name contains "urgent"))');
      }
    });

    it('should generate correct query for search query filter', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ query: 'login error', includeClosed: true });

      for (let i = 0; i < 4; i++) {
        expect(getQueryForType(i)).toBe('((Name contains "login error") OR (Description contains "login error"))');
      }
    });

    it('should generate correct compound query for stories (multiple closed states)', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ includeClosed: false, assignee: 'John Doe' });

      const storyQuery = getQueryForType(0);
      expect(storyQuery).toBe('(((ScheduleState != "Completed") AND (ScheduleState != "Accepted")) AND (Owner.Name contains "John Doe"))');
    });

    it('should generate correct compound query for defects (single closed state)', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ includeClosed: false, assignee: 'Jane Smith' });

      const defectQuery = getQueryForType(1);
      expect(defectQuery).toBe('((State != "Closed") AND (Owner.Name contains "Jane Smith"))');
    });

    it('should handle single label filter', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ labels: ['enhancement'], includeClosed: true });

      for (let i = 0; i < 4; i++) {
        expect(getQueryForType(i)).toBe('(Tags.Name contains "enhancement")');
      }
    });

    it('should generate correct query with all filters combined', async () => {
      setupEmptyResults();
      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({
        state: 'in_progress',
        includeClosed: false,
        assignee: 'Jane Smith',
        labels: ['feature'],
        query: 'dashboard',
      });

      const storyQuery = getQueryForType(0);
      // stories: state + exclude-closed + assignee + labels + search
      expect(storyQuery).toContain('ScheduleState = "In-Progress"');
      expect(storyQuery).toContain('ScheduleState != "Completed"');
      expect(storyQuery).toContain('Owner.Name contains "Jane Smith"');
      expect(storyQuery).toContain('Tags.Name contains "feature"');
      expect(storyQuery).toContain('Name contains "dashboard"');

      const defectQuery = getQueryForType(1);
      // defects: state + exclude-closed + assignee + labels + search
      expect(defectQuery).toContain('State = "Open"');
      expect(defectQuery).toContain('State != "Closed"');
      expect(defectQuery).toContain('Owner.Name contains "Jane Smith"');
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

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));

      for (const test of stateTests) {
        mockQuery.mockResolvedValueOnce(wsapiResponse([{
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
        }]));

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

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));

      for (const test of priorityTests) {
        mockQuery.mockResolvedValueOnce(wsapiResponse([{
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
        }]));

        const issue = await tracker.getIssue('US1');
        expect(issue.priority).toBe(test.expected);
      }
    });
  });

  describe('parentRef and artifactType (PAN-192, PAN-202)', () => {
    it('should return parentRef from PortfolioItem.FormattedID (PAN-202)', async () => {
      setupTypeResults([sampleStoryWithParent], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues).toHaveLength(1);
      expect(issues[0].parentRef).toBe('F100');
    });

    it('should prefer PortfolioItem over Parent for parentRef (PAN-202)', async () => {
      const storyWithBothParents = {
        ...sampleStory,
        PortfolioItem: {
          _ref: '/portfolioitem/feature/50000',
          _refObjectName: 'Feature Title',
          FormattedID: 'F100',
        },
        Parent: {
          _ref: '/hierarchicalrequirement/99999',
          _refObjectName: 'Parent Story',
          FormattedID: 'US999',
        },
      };

      setupTypeResults([storyWithBothParents], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].parentRef).toBe('F100');
    });

    it('should fall back to Parent when no PortfolioItem (PAN-202)', async () => {
      const storyWithParentOnly = {
        ...sampleStory,
        Parent: {
          _ref: '/hierarchicalrequirement/99999',
          _refObjectName: 'Parent Story',
          FormattedID: 'US999',
        },
      };

      setupTypeResults([storyWithParentOnly], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].parentRef).toBe('US999');
    });

    it('should fall back to PortfolioItem._refObjectName when FormattedID is absent', async () => {
      const storyWithPartialPortfolioItem = {
        ...sampleStory,
        PortfolioItem: {
          _ref: '/portfolioitem/feature/50000',
          _refObjectName: 'Feature Title',
          // No FormattedID
        },
      };

      setupTypeResults([storyWithPartialPortfolioItem], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].parentRef).toBe('Feature Title');
    });

    it('should fall back to Parent._refObjectName when FormattedID is absent', async () => {
      const storyWithPartialParent = {
        ...sampleStory,
        Parent: {
          _ref: '/hierarchicalrequirement/99999',
          _refObjectName: 'Parent Story',
          // No FormattedID
        },
      };

      setupTypeResults([storyWithPartialParent], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].parentRef).toBe('Parent Story');
    });

    it('should return undefined parentRef when no parent', async () => {
      setupTypeResults([sampleStory], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].parentRef).toBeUndefined();
    });

    it('should return artifactType from _type field', async () => {
      setupTypeResults([sampleStory], [sampleDefect], [], [sampleFeature]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      const story = issues.find(i => i.ref === 'US123');
      const defect = issues.find(i => i.ref === 'DE456');
      const feature = issues.find(i => i.ref === 'F100');

      expect(story?.artifactType).toBe('HierarchicalRequirement');
      expect(defect?.artifactType).toBe('Defect');
      expect(feature?.artifactType).toBe('PortfolioItem/Feature');
    });
  });

  describe('rawState preservation (PAN-192 Phase 2)', () => {
    it('should preserve raw ScheduleState on user stories', async () => {
      setupTypeResults([sampleStory], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('In-Progress');
    });

    it('should preserve raw State on defects', async () => {
      setupTypeResults([], [sampleDefect], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('Defined');
    });

    it('should preserve raw State on features', async () => {
      setupTypeResults([], [], [], [sampleFeature]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('Developing');
    });

    it('should default rawState to Defined when neither ScheduleState nor State is set', async () => {
      const storyNoState = {
        ...sampleStory,
        ScheduleState: null,
        State: null,
      };
      setupTypeResults([storyNoState], [], [], []);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('Defined');
    });

    it('should extract Name from object State on features (PAN-201)', async () => {
      const featureWithObjectState = {
        ...sampleFeature,
        State: {
          _ref: 'https://rally1.rallydev.com/slm/webservice/v2.0/state/12345',
          _refObjectName: 'Developing',
          Name: 'Developing',
          ObjectID: 12345,
        },
      };
      setupTypeResults([], [], [], [featureWithObjectState]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('Developing');
      expect(issues[0].state).toBe('in_progress');
    });

    it('should fall back to _refObjectName when object State has no Name (PAN-201)', async () => {
      const featureWithPartialState = {
        ...sampleFeature,
        State: {
          _ref: 'https://rally1.rallydev.com/slm/webservice/v2.0/state/99999',
          _refObjectName: 'Done',
        },
      };
      setupTypeResults([], [], [], [featureWithPartialState]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('Done');
      expect(issues[0].state).toBe('closed');
    });

    it('should default to Defined when object State has no Name or _refObjectName (PAN-201)', async () => {
      const featureWithEmptyState = {
        ...sampleFeature,
        State: {
          _ref: 'https://rally1.rallydev.com/slm/webservice/v2.0/state/0',
          ObjectID: 0,
        },
      };
      setupTypeResults([], [], [], [featureWithEmptyState]);

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      const issues = await tracker.listIssues();

      expect(issues[0].rawState).toBe('Defined');
      expect(issues[0].state).toBe('open');
    });
  });

  describe('project scoping (PAN-192)', () => {
    it('should add Project.ObjectID condition to query when project is set', async () => {
      setupEmptyResults();

      const tracker = wrap(new RallyTracker({
        apiKey: 'test_key',
        project: '/project/822404704163',
      }));
      await tracker.listIssues({ includeClosed: true });

      for (let i = 0; i < 4; i++) {
        const query = mockQuery.mock.calls[i][0].query;
        expect(query).toContain('(Project.ObjectID = "822404704163")');
      }
    });

    it('should combine project scoping with other filters', async () => {
      setupEmptyResults();

      const tracker = wrap(new RallyTracker({
        apiKey: 'test_key',
        project: '/project/12345',
      }));
      await tracker.listIssues({ assignee: 'John', includeClosed: true });

      const storyQuery = mockQuery.mock.calls[0][0].query;
      expect(storyQuery).toContain('(Project.ObjectID = "12345")');
      expect(storyQuery).toContain('(Owner.Name contains "John")');
    });

    it('should not add project scoping when no project is set', async () => {
      setupEmptyResults();

      const tracker = wrap(new RallyTracker({ apiKey: 'test_key' }));
      await tracker.listIssues({ includeClosed: true });

      for (let i = 0; i < 4; i++) {
        const query = mockQuery.mock.calls[i][0].query;
        expect(query).not.toContain('Project.ObjectID');
      }
    });
  });
});
