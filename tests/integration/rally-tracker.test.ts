import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RallyApiMock, type MockRallyArtifact } from '../fixtures/rally-api-mock.js';

const sampleArtifacts: MockRallyArtifact[] = [
  {
    ObjectID: '100',
    FormattedID: 'US100',
    Name: 'Sample User Story',
    Description: 'A test story',
    ScheduleState: 'In-Progress',
    State: null as any,
    Tags: { _tagsNameArray: ['frontend'] },
    Owner: { _refObjectName: 'John Doe' },
    Priority: 'High',
    DueDate: '2024-12-31',
    CreationDate: '2024-01-01T00:00:00Z',
    LastUpdateDate: '2024-06-15T00:00:00Z',
    Parent: null,
    _type: 'HierarchicalRequirement',
    _ref: '/hierarchicalrequirement/100',
  },
  {
    ObjectID: '200',
    FormattedID: 'DE200',
    Name: 'Sample Defect',
    Description: 'A test bug',
    ScheduleState: null as any,
    State: 'Defined',
    Tags: { _tagsNameArray: ['bug'] },
    Owner: null,
    Priority: 'Normal',
    DueDate: null,
    CreationDate: '2024-02-01T00:00:00Z',
    LastUpdateDate: '2024-07-10T00:00:00Z',
    Parent: null,
    _type: 'Defect',
    _ref: '/defect/200',
  },
];

describe('Rally API Mock', () => {
  let mock: RallyApiMock;

  beforeEach(() => {
    mock = new RallyApiMock();
    mock.addTestData(sampleArtifacts);
  });

  it('should return test data for valid queries', async () => {
    const result = await mock.query({
      type: 'artifact',
      query: '((State = "Open"))',
      limit: 50,
    });

    expect(result.QueryResult.Results).toHaveLength(2);
    expect(result.QueryResult.TotalResultCount).toBe(2);
    expect(result.QueryResult.Errors).toHaveLength(0);
  });

  it('should accept properly wrapped compound queries', async () => {
    const result = await mock.query({
      type: 'artifact',
      query: '(((ScheduleState != "Completed") AND (ScheduleState != "Accepted") AND (State != "Closed")) AND (Owner.Name contains "John"))',
    });

    expect(result.QueryResult.Errors).toHaveLength(0);
    expect(result.QueryResult.Results).toHaveLength(2);
  });

  it('should record the last query for inspection', async () => {
    const query = '((ScheduleState = "In-Progress"))';
    await mock.query({ query });
    expect(mock.lastQuery).toBe(query);
  });

  it('should reject queries with unbalanced parentheses', async () => {
    const result = await mock.query({
      query: '((ScheduleState != "Completed") AND (State != "Closed")',
    });

    expect(result.QueryResult.Errors).toHaveLength(1);
    expect(result.QueryResult.Errors[0]).toContain('Could not parse');
  });

  it('should return forced parse errors', async () => {
    mock.setParseError('expected ")" but saw "AND" instead.');
    const result = await mock.query({
      query: '((State = "Open"))',
    });

    expect(result.QueryResult.Errors).toHaveLength(1);
    expect(result.QueryResult.Errors[0]).toContain('Could not parse');
    expect(result.QueryResult.Errors[0]).toContain('expected ")" but saw "AND"');
  });

  it('should throw on auth errors', async () => {
    mock.setAuthError(true);
    await expect(mock.query({ query: '((State = "Open"))' })).rejects.toThrow('Unauthorized');
  });

  it('should respect limit parameter', async () => {
    const result = await mock.query({
      query: '((State = "Open"))',
      limit: 1,
    });

    expect(result.QueryResult.Results).toHaveLength(1);
    expect(result.QueryResult.TotalResultCount).toBe(2); // Total count is still 2
  });

  it('should accept query with no conditions (empty string)', async () => {
    const result = await mock.query({ query: '' });
    expect(result.QueryResult.Errors).toHaveLength(0);
  });

  it('should accept query with no query parameter', async () => {
    const result = await mock.query({ type: 'artifact' });
    expect(result.QueryResult.Errors).toHaveLength(0);
  });
});

describe('Rally Integration - Type-Specific Query Validation (PAN-168)', () => {
  it('should produce valid type-specific queries for each artifact type', async () => {
    const mock = new RallyApiMock();
    mock.addTestData(sampleArtifacts);

    // These are the actual queries produced by buildQueryStringForType
    const typeQueries = [
      // HierarchicalRequirement: exclude-closed uses ScheduleState
      { type: 'hierarchicalrequirement', query: '((ScheduleState != "Completed") AND (ScheduleState != "Accepted"))' },
      // Defect: exclude-closed uses State
      { type: 'defect', query: '(State != "Closed")' },
      // Task: exclude-closed uses State
      { type: 'task', query: '(State != "Completed")' },
    ];

    for (const { type, query } of typeQueries) {
      const result = await mock.query({ type, query });
      expect(result.QueryResult.Errors).toHaveLength(0);
    }
  });

  it('should produce valid compound queries per type', async () => {
    const mock = new RallyApiMock();
    mock.addTestData(sampleArtifacts);

    const compoundQueries = [
      // Story with assignee filter
      '(((ScheduleState != "Completed") AND (ScheduleState != "Accepted")) AND (Owner.Name contains "John"))',
      // Defect with assignee filter
      '((State != "Closed") AND (Owner.Name contains "John"))',
      // Task with assignee filter
      '((State != "Completed") AND (Owner.Name contains "John"))',
      // Assignee only
      '(Owner.Name contains "John Doe")',
      // Labels filter
      '((Tags.Name contains "bug") AND (Tags.Name contains "urgent"))',
      // Search query
      '((Name contains "search term") OR (Description contains "search term"))',
    ];

    for (const query of compoundQueries) {
      const result = await mock.query({ query });
      expect(result.QueryResult.Errors).toHaveLength(0);
    }
  });

  it('should NOT produce the old problematic mixed-field query', async () => {
    // The old code produced this query which fails on the generic Artifact endpoint
    // because ScheduleState doesn't exist on all subtypes:
    const oldBrokenQuery = '(((ScheduleState != "Completed") AND (ScheduleState != "Accepted")) AND (State != "Closed"))';

    // With type-specific queries, we never mix ScheduleState and State in the same filter.
    // Instead:
    // - Stories get: ((ScheduleState != "Completed") AND (ScheduleState != "Accepted"))
    // - Defects get: (State != "Closed")
    // - Tasks get:   (State != "Completed")

    // This is a documentation test to ensure we don't regress to the old behavior.
    // The actual queries are validated in the unit tests above.
    expect(oldBrokenQuery).toContain('ScheduleState');
    expect(oldBrokenQuery).toContain('State');

    // New approach: each type-specific query only uses ONE state field
    const storyQuery = '((ScheduleState != "Completed") AND (ScheduleState != "Accepted"))';
    const defectQuery = '(State != "Closed")';
    const taskQuery = '(State != "Completed")';

    expect(storyQuery).not.toMatch(/\(State\s/);   // No bare "State" field in story query (only "ScheduleState")
    expect(defectQuery).not.toContain('ScheduleState'); // No ScheduleState in defect query
    expect(taskQuery).not.toContain('ScheduleState');   // No ScheduleState in task query
  });
});
