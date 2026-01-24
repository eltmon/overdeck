import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSearch, SearchFilters } from '../useSearch';
import { useQueryClient } from '@tanstack/react-query';
import { Issue } from '../../types';

// Mock @tanstack/react-query
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(),
}));

describe('useSearch', () => {
  const mockIssues: Issue[] = [
    {
      id: '1',
      identifier: 'PAN-123',
      title: 'Fix dashboard search bug',
      description: 'The search feature has a critical issue',
      status: 'In Progress',
      priority: 1,
      assignee: { name: 'John Doe', email: 'john@example.com' },
      labels: ['bug'],
      url: 'https://example.com/PAN-123',
      createdAt: '2024-01-01',
      updatedAt: '2024-01-02',
      source: 'linear',
    },
    {
      id: '2',
      identifier: 'PAN-456',
      title: 'Add new feature',
      description: 'Implement search functionality',
      status: 'Todo',
      priority: 2,
      assignee: { name: 'Jane Doe', email: 'jane@example.com' },
      labels: ['feature'],
      url: 'https://example.com/PAN-456',
      createdAt: '2024-01-03',
      updatedAt: '2024-01-04',
      source: 'github',
    },
    {
      id: '3',
      identifier: 'PAN-789',
      title: 'Update documentation',
      description: 'Update user guide',
      status: 'Done',
      priority: 3,
      assignee: { name: 'Bob Smith', email: 'bob@example.com' },
      labels: ['docs'],
      url: 'https://example.com/PAN-789',
      createdAt: '2024-01-05',
      updatedAt: '2024-01-06',
      source: 'linear',
    },
    {
      id: '4',
      identifier: 'GH-42',
      title: 'GitHub issue for testing',
      description: 'This is a github issue',
      status: 'In Progress',
      priority: 2,
      assignee: { name: 'Alice', email: 'alice@example.com' },
      labels: [],
      url: 'https://github.com/test/42',
      createdAt: '2024-01-07',
      updatedAt: '2024-01-08',
      source: 'github',
    },
  ];

  const defaultFilters: SearchFilters = {
    sources: new Set(),
    includeCompleted: false,
    deepSearch: false,
  };

  let mockQueryClient: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockQueryClient = {
      getQueryData: vi.fn().mockReturnValue(mockIssues),
    };
    vi.mocked(useQueryClient).mockReturnValue(mockQueryClient);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Minimum query length', () => {
    it('should return empty results when query is less than 2 characters', () => {
      const { result } = renderHook(() => useSearch('a', defaultFilters));

      expect(result.current.results).toEqual([]);
      expect(result.current.hasResults).toBe(false);
      expect(result.current.resultCount).toBe(0);
    });

    it('should return empty results when query is empty', () => {
      const { result } = renderHook(() => useSearch('', defaultFilters));

      expect(result.current.results).toEqual([]);
      expect(result.current.hasResults).toBe(false);
      expect(result.current.resultCount).toBe(0);
    });

    it('should search when query is 2 or more characters', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.results.length).toBeGreaterThan(0);
    });
  });

  describe('Debouncing', () => {
    it('should debounce search input by 150ms', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      // Advance through full debounce time
      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      // After debounce time - search complete with results
      expect(result.current.isSearching).toBe(false);
      expect(result.current.results.length).toBeGreaterThan(0);
    });

    it('should reset debounce timer when query changes', async () => {
      const { result, rerender } = renderHook(
        ({ query }) => useSearch(query, defaultFilters),
        { initialProps: { query: 'PAN' } }
      );

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      // Change query before debounce completes
      rerender({ query: 'GH' });

      // New timer should require another 150ms
      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(result.current.isSearching).toBe(true);

      // Complete new timer
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      expect(result.current.isSearching).toBe(false);
    });
  });

  describe('Scoring algorithm', () => {
    it('should score exact identifier match as 100', async () => {
      const { result } = renderHook(() => useSearch('PAN-123', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.identifier === 'PAN-123');
      expect(match?.score).toBe(100);
      expect(match?.matchType).toBe('identifier');
    });

    it('should score identifier starts with query as 80', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.identifier === 'PAN-123');
      expect(match?.score).toBe(80);
      expect(match?.matchType).toBe('identifier');
    });

    it('should score identifier contains query as 60', async () => {
      const { result } = renderHook(() => useSearch('123', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.identifier === 'PAN-123');
      expect(match?.score).toBe(60);
      expect(match?.matchType).toBe('identifier');
    });

    it('should score title starts with query as 70', async () => {
      const { result } = renderHook(() => useSearch('Fix', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.title.startsWith('Fix'));
      expect(match?.score).toBe(70);
      expect(match?.matchType).toBe('title');
    });

    it('should score title contains query as 50', async () => {
      const { result } = renderHook(() => useSearch('search', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.title.includes('search'));
      expect(match?.score).toBe(50);
      expect(match?.matchType).toBe('title');
    });

    it('should score description contains query as 20 when deep search is enabled', async () => {
      const filters: SearchFilters = {
        ...defaultFilters,
        deepSearch: true,
      };

      const { result } = renderHook(() => useSearch('critical', filters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.description?.includes('critical'));
      expect(match?.score).toBe(20);
      expect(match?.matchType).toBe('description');
    });

    it('should not search description when deep search is disabled', async () => {
      const { result } = renderHook(() => useSearch('critical', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      // Should only find if the word is in title/identifier, not description
      const matches = result.current.results.filter(r =>
        r.issue.description?.includes('critical') &&
        !r.issue.title.toLowerCase().includes('critical') &&
        !r.issue.identifier.toLowerCase().includes('critical')
      );
      expect(matches.length).toBe(0);
    });

    it('should prefer higher score matches (identifier over title)', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      // PAN-123 should score higher (80) than issues that only have PAN in title
      const firstResult = result.current.results[0];
      expect(firstResult?.matchType).toBe('identifier');
    });
  });

  describe('Filtering', () => {
    it('should filter by source when sources filter is set', async () => {
      const filters: SearchFilters = {
        sources: new Set(['github']),
        includeCompleted: false,
        deepSearch: false,
      };

      const { result } = renderHook(() => useSearch('issue', filters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const allGithub = result.current.results.every(r => r.issue.source === 'github');
      expect(allGithub).toBe(true);
    });

    it('should filter by multiple sources', async () => {
      const filters: SearchFilters = {
        sources: new Set(['github', 'linear']),
        includeCompleted: false,
        deepSearch: false,
      };

      const { result } = renderHook(() => useSearch('PAN', filters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const allAllowed = result.current.results.every(r =>
        r.issue.source === 'github' || r.issue.source === 'linear'
      );
      expect(allAllowed).toBe(true);
    });

    it('should include all sources when sources filter is empty', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const sources = new Set(result.current.results.map(r => r.issue.source));
      expect(sources.size).toBeGreaterThan(1); // Multiple sources
    });

    it('should exclude completed issues by default', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const hasCompleted = result.current.results.some(r =>
        r.issue.status === 'Done' || r.issue.status === 'Completed' || r.issue.status === 'Closed'
      );
      expect(hasCompleted).toBe(false);
    });

    it('should include completed issues when includeCompleted is true', async () => {
      const filters: SearchFilters = {
        ...defaultFilters,
        includeCompleted: true,
      };

      const { result } = renderHook(() => useSearch('PAN', filters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const hasCompleted = result.current.results.some(r => r.issue.status === 'Done');
      expect(hasCompleted).toBe(true);
    });
  });

  describe('Sorting', () => {
    it('should sort results by score descending', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const scores = result.current.results.map(r => r.score);
      const sortedScores = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sortedScores);
    });

    it('should sort by identifier when scores are equal', async () => {
      // Search for something that gives same score to multiple issues
      const { result } = renderHook(() => useSearch('issue', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      // Find issues with same score
      const sameScoreGroups = result.current.results.reduce((acc, r) => {
        if (!acc[r.score]) acc[r.score] = [];
        acc[r.score].push(r);
        return acc;
      }, {} as Record<number, typeof result.current.results>);

      // Check that within same score, they're sorted by identifier
      Object.values(sameScoreGroups).forEach(group => {
        if (group.length > 1) {
          const identifiers = group.map(r => r.issue.identifier);
          const sortedIdentifiers = [...identifiers].sort();
          expect(identifiers).toEqual(sortedIdentifiers);
        }
      });
    });
  });

  describe('Grouping', () => {
    it('should group results by source', async () => {
      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const grouped = result.current.groupedResults;
      expect(Object.keys(grouped).length).toBeGreaterThan(0);

      // Each group should contain only issues from that source
      Object.entries(grouped).forEach(([source, results]) => {
        results.forEach(r => {
          expect(r.issue.source).toBe(source);
        });
      });
    });

    it('should include source in grouped results even with one issue', async () => {
      const filters: SearchFilters = {
        sources: new Set(['github']),
        includeCompleted: false,
        deepSearch: false,
      };

      const { result } = renderHook(() => useSearch('GH', filters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.groupedResults['github']).toBeDefined();
    });
  });

  describe('Result limiting', () => {
    it('should limit results to maxResults (default 20)', async () => {
      // Create a mock with many issues
      const manyIssues = Array.from({ length: 50 }, (_, i) => ({
        ...mockIssues[0],
        id: `${i}`,
        identifier: `PAN-${i}`,
      }));

      mockQueryClient.getQueryData.mockReturnValue(manyIssues);

      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.results.length).toBeLessThanOrEqual(20);
    });

    it('should respect custom maxResults', async () => {
      const manyIssues = Array.from({ length: 50 }, (_, i) => ({
        ...mockIssues[0],
        id: `${i}`,
        identifier: `PAN-${i}`,
      }));

      mockQueryClient.getQueryData.mockReturnValue(manyIssues);

      const { result } = renderHook(() =>
        useSearch('PAN', defaultFilters, { maxResults: 5 })
      );

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Edge cases', () => {
    it('should handle no cached issues gracefully', async () => {
      mockQueryClient.getQueryData.mockReturnValue(undefined);

      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.hasResults).toBe(false);
    });

    it('should handle empty cached issues array', async () => {
      mockQueryClient.getQueryData.mockReturnValue([]);

      const { result } = renderHook(() => useSearch('PAN', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.results).toEqual([]);
    });

    it('should handle issues without descriptions', async () => {
      const issuesWithoutDesc = mockIssues.map(issue => ({
        ...issue,
        description: undefined,
      }));

      mockQueryClient.getQueryData.mockReturnValue(issuesWithoutDesc);

      const filters: SearchFilters = {
        ...defaultFilters,
        deepSearch: true,
      };

      const { result } = renderHook(() => useSearch('PAN', filters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.results.length).toBeGreaterThan(0);
    });

    it('should handle case-insensitive searches', async () => {
      const { result } = renderHook(() => useSearch('pan-123', defaultFilters));

      await act(async () => {
        vi.advanceTimersByTime(150);
      });

      const match = result.current.results.find(r => r.issue.identifier === 'PAN-123');
      expect(match).toBeDefined();
    });
  });
});
