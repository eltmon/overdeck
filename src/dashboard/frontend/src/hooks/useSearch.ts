import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Issue, IssueSource } from '../types';

export interface SearchFilters {
  sources: Set<IssueSource>;
  includeCompleted: boolean;
  deepSearch: boolean;
}

export interface SearchResult {
  issue: Issue;
  score: number;
  matchType: 'identifier' | 'title' | 'description';
}

export interface UseSearchOptions {
  cycleFilter?: 'current' | 'all' | 'backlog';
  includeCompletedFilter?: boolean;
  minQueryLength?: number;
  maxResults?: number;
  debounceMs?: number;
}

export function useSearch(query: string, filters: SearchFilters, options: UseSearchOptions = {}) {
  const {
    cycleFilter = 'current',
    includeCompletedFilter = false,
    minQueryLength = 2,
    maxResults = 20,
    debounceMs = 150,
  } = options;

  const queryClient = useQueryClient();
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  // Get issues from React Query cache
  const cachedIssues = queryClient.getQueryData<Issue[]>(['issues', cycleFilter, includeCompletedFilter]);

  // Search and score results
  const results = useMemo(() => {
    // Don't search if query is too short
    if (!debouncedQuery || debouncedQuery.trim().length < minQueryLength) {
      return [];
    }

    // Don't search if no cached issues
    if (!cachedIssues || cachedIssues.length === 0) {
      return [];
    }

    const searchTerm = debouncedQuery.toLowerCase().trim();
    const scored: SearchResult[] = [];

    for (const issue of cachedIssues) {
      // Apply source filter
      if (filters.sources.size > 0 && issue.source && !filters.sources.has(issue.source)) {
        continue;
      }

      // Apply completed filter
      if (!filters.includeCompleted && (issue.status === 'Done' || issue.status === 'Completed' || issue.status === 'Closed')) {
        continue;
      }

      let score = 0;
      let matchType: 'identifier' | 'title' | 'description' | null = null;

      // Check identifier
      const identifier = issue.identifier.toLowerCase();
      if (identifier === searchTerm) {
        score = 100;
        matchType = 'identifier';
      } else if (identifier.startsWith(searchTerm)) {
        score = 80;
        matchType = 'identifier';
      } else if (identifier.includes(searchTerm)) {
        score = 60;
        matchType = 'identifier';
      }

      // Check title
      const title = issue.title.toLowerCase();
      if (title.includes(searchTerm)) {
        const titleScore = title.startsWith(searchTerm) ? 70 : 50;
        if (titleScore > score) {
          score = titleScore;
          matchType = 'title';
        }
      }

      // Check description (if deep search is enabled)
      if (filters.deepSearch && issue.description) {
        const description = issue.description.toLowerCase();
        if (description.includes(searchTerm)) {
          const descScore = 20;
          if (descScore > score) {
            score = descScore;
            matchType = 'description';
          }
        }
      }

      // Add to results if we found a match
      if (score > 0 && matchType) {
        scored.push({ issue, score, matchType });
      }
    }

    // Sort by score (highest first), then by identifier
    scored.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.issue.identifier.localeCompare(b.issue.identifier);
    });

    // Limit results
    return scored.slice(0, maxResults);
  }, [debouncedQuery, cachedIssues, filters, minQueryLength, maxResults]);

  // Group results by source
  const groupedResults = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};

    for (const result of results) {
      const source = result.issue.source || 'unknown';
      if (!groups[source]) {
        groups[source] = [];
      }
      groups[source].push(result);
    }

    return groups;
  }, [results]);

  return {
    results,
    groupedResults,
    isSearching: query !== debouncedQuery,
    hasResults: results.length > 0,
    resultCount: results.length,
  };
}
