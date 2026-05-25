import type { IssueId } from '@panctl/contracts';
import type { DashboardState } from '../../lib/store';
import { useDashboardStore } from '../../lib/store';
import type { ActivitySessionFeedEntry } from './types';

export const MAX_ACTIVITY_ENTRY_FEED_ENTRIES = 500;

interface ActivityEntryShape {
  id?: unknown;
  timestamp?: unknown;
  source?: unknown;
  level?: unknown;
  message?: unknown;
  details?: unknown;
  issueId?: unknown;
}

export function createActivityEntryFeedSelector() {
  let lastSource: DashboardState['recentActivity'] | undefined;
  let lastResult: ActivitySessionFeedEntry[] | undefined;

  return (state: Pick<DashboardState, 'recentActivity'>): ActivitySessionFeedEntry[] => {
    const source = state.recentActivity;
    if (source === lastSource && lastResult) return lastResult;

    lastSource = source;
    lastResult = (source as ActivityEntryShape[])
      .map((entry): ActivitySessionFeedEntry | null => {
        const id = typeof entry.id === 'string' ? entry.id : null;
        const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null;
        if (!id || !timestamp) return null;
        const message = typeof entry.message === 'string' ? entry.message : '';
        const sourceName = typeof entry.source === 'string' ? entry.source : 'unknown';
        const level = typeof entry.level === 'string' ? entry.level : '';
        const details = typeof entry.details === 'string' ? entry.details : undefined;
        const issueId = typeof entry.issueId === 'string' ? (entry.issueId as IssueId) : null;
        const tags = level ? [sourceName, level] : [sourceName];
        return {
          kind: 'activity',
          id,
          timestamp,
          workspaceId: null,
          issueId,
          headline: message || sourceName,
          summary: sourceName,
          narrative: details,
          files: [],
          tags,
        };
      })
      .filter((entry): entry is ActivitySessionFeedEntry => entry !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_ACTIVITY_ENTRY_FEED_ENTRIES);
    return lastResult;
  };
}

const selectActivityEntryFeed = createActivityEntryFeedSelector();

export function useActivityEntryFeed(): ActivitySessionFeedEntry[] {
  return useDashboardStore(selectActivityEntryFeed);
}
