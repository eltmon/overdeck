import { useMemo } from 'react';
import type { GauntletRunSessionFeedEntry, SessionFeedEntry, SessionFeedTab } from './types';
import { useActivityEntryFeed } from './useActivityEntryFeed';
import { useConversationFeed } from './useConversationFeed';
import { useObservationFeed } from './useObservationFeed';

/** PAN-4301: All shows transitions from the last 24 h; Chats shows recency within it. */
export const FEED_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/**
 * PAN-4301 tab rules (D2): All keeps activity, conversations whose lifecycle
 * timestamp (started / ended) is inside the window, and run cards; Chats is a
 * windowed recency index that re-dates conversations to `recencyAt`. A run card
 * shows in both while any lane is alive or its latest event is in the window.
 */
export function filterSessionFeedEntriesForTab(
  entries: readonly SessionFeedEntry[],
  tab: SessionFeedTab,
  now: number = Date.now(),
): SessionFeedEntry[] {
  const inWindow = (iso: string) => now - Date.parse(iso) <= FEED_WINDOW_MS;
  const runVisible = (entry: GauntletRunSessionFeedEntry) => entry.anyAlive || inWindow(entry.latest.at);
  switch (tab) {
    case 'all':
      return entries.filter((entry) =>
        entry.kind === 'activity'
        || (entry.kind === 'conversation' && inWindow(entry.timestamp))
        || (entry.kind === 'gauntlet_run' && runVisible(entry)));
    case 'chats':
      return entries
        .flatMap((entry): SessionFeedEntry[] => {
          if (entry.kind === 'conversation') {
            return entry.sessionAlive || inWindow(entry.recencyAt)
              ? [{ ...entry, timestamp: entry.recencyAt, timestampLabel: 'active' }]
              : [];
          }
          if (entry.kind === 'gauntlet_run') return runVisible(entry) ? [entry] : [];
          return [];
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    case 'activity':
      return entries.filter((entry) => entry.kind === 'activity');
    case 'git':
    case 'files':
    case 'comments':
      return [];
  }
}

/** `now` is epoch ms; the sidebar passes its own clock so bucketing and windowing agree. */
export function useMergedFeed(tab: SessionFeedTab, now: number = Date.now()): UseMergedFeedResult {
  const conversations = useConversationFeed();
  const observations = useObservationFeed();
  const activityEntries = useActivityEntryFeed();

  const allEntries = useMemo(
    () => mergeSessionFeedEntries(conversations.entries, activityEntries, observations),
    [conversations.entries, activityEntries, observations],
  );
  const entries = useMemo(() => filterSessionFeedEntriesForTab(allEntries, tab, now), [allEntries, tab, now]);

  return {
    entries,
    allEntries,
    isLoading: conversations.isLoading,
    error: conversations.error,
  };
}
