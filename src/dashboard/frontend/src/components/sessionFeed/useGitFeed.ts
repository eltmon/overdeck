import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IssueId } from '@panctl/contracts';
import type { GitSessionFeedEntry } from './types';

export interface GitActivityEntry {
  id: string;
  timestamp: string;
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  details?: string | null;
  issueId?: string | null;
  category?: string | null;
  triggeringEvent?: string | null;
}

interface GitFeedFetchResult {
  entries: GitActivityEntry[];
  error: Error | null;
}

export interface UseGitFeedResult {
  entries: GitSessionFeedEntry[];
  isLoading: boolean;
  error: Error | null;
}

export async function fetchGitFeedEntries(): Promise<GitFeedFetchResult> {
  try {
    const res = await fetch('/api/git-activity');
    if (!res.ok) {
      return { entries: [], error: new Error('Failed to fetch git activity') };
    }
    return { entries: await res.json() as GitActivityEntry[], error: null };
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export function mapGitActivityToFeedEntry(entry: GitActivityEntry): GitSessionFeedEntry {
  return {
    kind: 'git',
    id: entry.id,
    timestamp: entry.timestamp,
    workspaceId: null,
    issueId: entry.issueId as IssueId | null ?? null,
    source: entry.source,
    level: entry.level,
    message: entry.message,
    details: entry.details,
    category: entry.category,
    triggeringEvent: entry.triggeringEvent,
  };
}

export function useGitFeed(): UseGitFeedResult {
  const query = useQuery({
    queryKey: ['session-feed-git'],
    queryFn: fetchGitFeedEntries,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const sourceEntries = query.data?.entries ?? [];
  const entries = useMemo(() => sourceEntries.map(mapGitActivityToFeedEntry), [sourceEntries]);

  return {
    entries,
    isLoading: query.isLoading,
    error: query.data?.error ?? (query.error instanceof Error ? query.error : null),
  };
}
