import { useMemo } from 'react';
import type { SessionFeedEntry, SessionFeedTab } from './types';
import { useConversationFeed } from './useConversationFeed';
import { useGitFeed } from './useGitFeed';
import { useObservationFeed } from './useObservationFeed';

export interface UseMergedFeedResult {
  entries: SessionFeedEntry[];
  allEntries: SessionFeedEntry[];
  isLoading: boolean;
  error: Error | null;
}

export function mergeSessionFeedEntries(...sources: readonly SessionFeedEntry[][]): SessionFeedEntry[] {
  const byId = new Map<string, SessionFeedEntry>();

  for (const source of sources) {
    for (const entry of source) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }

  return [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function filterSessionFeedEntriesForTab(entries: readonly SessionFeedEntry[], tab: SessionFeedTab): SessionFeedEntry[] {
  switch (tab) {
    case 'all':
      return [...entries];
    case 'chats':
      return entries.filter((entry) => entry.kind === 'conversation');
    case 'activity':
      return entries.filter((entry) => entry.kind === 'activity');
    case 'git':
      return entries.filter((entry) => entry.kind === 'git');
    case 'files':
    case 'comments':
      return [];
  }
}

export function useMergedFeed(tab: SessionFeedTab): UseMergedFeedResult {
  const conversations = useConversationFeed();
  const observations = useObservationFeed();
  const git = useGitFeed();

  const allEntries = useMemo(
    () => mergeSessionFeedEntries(conversations.entries, observations, git.entries),
    [conversations.entries, observations, git.entries],
  );
  const entries = useMemo(() => filterSessionFeedEntriesForTab(allEntries, tab), [allEntries, tab]);

  return {
    entries,
    allEntries,
    isLoading: conversations.isLoading || git.isLoading,
    error: conversations.error ?? git.error,
  };
}
