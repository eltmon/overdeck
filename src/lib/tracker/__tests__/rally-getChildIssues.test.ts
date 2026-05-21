import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import { RallyTracker } from '../rally.js';

const mockQuery = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../rally-api.js', () => ({
  RallyRestApi: vi.fn().mockImplementation(function () {
    return {
      query: mockQuery,
      create: mockCreate,
      update: mockUpdate,
      server: 'https://rally1.rallydev.com',
    };
  }),
}));

describe('RallyTracker.getChildIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries hierarchicalrequirement and defect by PortfolioItem.FormattedID', async () => {
    const tracker = new RallyTracker({
      apiKey: 'test-key',
      server: 'https://rally1.rallydev.com',
      workspace: '/workspace/123',
      project: '/project/456',
    });

    mockQuery.mockReturnValue(
      Effect.succeed({
        QueryResult: {
          Results: [],
          TotalResultCount: 0,
          Errors: [],
          Warnings: [],
        },
      }),
    );

    const result = await Effect.runPromise(tracker.getChildIssues('F123'));

    expect(result).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const hrQuery = mockQuery.mock.calls.find(
      (call) => call[0].type === 'hierarchicalrequirement',
    );
    expect(hrQuery).toBeDefined();
    expect(hrQuery[0].query).toContain('PortfolioItem.FormattedID = "F123"');

    const defectQuery = mockQuery.mock.calls.find(
      (call) => call[0].type === 'defect',
    );
    expect(defectQuery).toBeDefined();
    expect(defectQuery[0].query).toContain('PortfolioItem.FormattedID = "F123"');
  });

  it('returns normalized child issues sorted by ref', async () => {
    const tracker = new RallyTracker({
      apiKey: 'test-key',
      server: 'https://rally1.rallydev.com',
      workspace: '/workspace/123',
      project: '/project/456',
    });

    mockQuery.mockImplementation((config: any) => {
      if (config.type === 'hierarchicalrequirement') {
        return Effect.succeed({
          QueryResult: {
            Results: [
              {
                ObjectID: '2001',
                FormattedID: 'US200',
                Name: 'Story B',
                Description: 'Desc B',
                ScheduleState: 'Defined',
                _type: 'HierarchicalRequirement',
                CreationDate: '2024-01-01T00:00:00.000Z',
                LastUpdateDate: '2024-01-01T00:00:00.000Z',
              },
              {
                ObjectID: '2002',
                FormattedID: 'US100',
                Name: 'Story A',
                Description: 'Desc A',
                ScheduleState: 'In-Progress',
                _type: 'HierarchicalRequirement',
                PortfolioItem: { FormattedID: 'F123' },
                CreationDate: '2024-01-01T00:00:00.000Z',
                LastUpdateDate: '2024-01-01T00:00:00.000Z',
              },
            ],
            TotalResultCount: 2,
            Errors: [],
            Warnings: [],
          },
        });
      }
      // defect query returns empty
      return Effect.succeed({
        QueryResult: { Results: [], TotalResultCount: 0, Errors: [], Warnings: [] },
      });
    });

    const result = await Effect.runPromise(tracker.getChildIssues('F123'));

    expect(result).toHaveLength(2);
    expect(result[0].ref).toBe('US100');
    expect(result[0].title).toBe('Story A');
    expect(result[0].state).toBe('in_progress');
    expect(result[0].parentRef).toBe('F123');
    expect(result[1].ref).toBe('US200');
    expect(result[1].title).toBe('Story B');
    expect(result[1].state).toBe('open');
  });

  it('gracefully handles query errors by returning empty array', async () => {
    const tracker = new RallyTracker({
      apiKey: 'test-key',
      server: 'https://rally1.rallydev.com',
      workspace: '/workspace/123',
      project: '/project/456',
    });

    mockQuery.mockReturnValue(
      Effect.fail(
        // Use a TrackerError so the per-type catchTag swallows it (matches production
        // behaviour where downstream RallyRestApi only emits TrackerError | TrackerAuthError).
        new (await import('../../errors.js')).TrackerError({
          tracker: 'rally',
          operation: 'test',
          message: 'Network error',
        }),
      ),
    );

    const result = await Effect.runPromise(tracker.getChildIssues('F123'));
    expect(result).toEqual([]);
  });
});
