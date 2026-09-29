import type { IssueId } from '@overdeck/contracts';
import type { DashboardState } from '../../lib/store';
import { useDashboardStore } from '../../lib/store';
import type { ActivitySessionFeedEntry } from './types';

export const MAX_ACTIVITY_ENTRY_FEED_ENTRIES = 500;

/**
 * Activity sources that report system-level news (dashboard restarts,
 * supervisor watchdog actions, deploy-script restarts). These entries are
 * relevant regardless of which project is active, so the feed shows them in
 * every scope instead of dropping them through the issue-id filter.
 */
export const SYSTEM_ACTIVITY_SOURCES = new Set(['dashboard', 'supervisor', 'deploy-script']);

interface ActivityEntryShape {
  id?: unknown;
  timestamp?: unknown;
  source?: unknown;
  level?: unknown;
  message?: unknown;
  details?: unknown;
  issueId?: unknown;
  link?: unknown;
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
        const link = typeof entry.link === 'string' ? entry.link : undefined;
        const tags = level ? [sourceName, level] : [sourceName];
        return {
          kind: 'activity',
          activityClass: 'operational',
          id,
          timestamp,
          workspaceId: null,
          issueId,
          headline: message || sourceName,
          summary: sourceName,
          narrative: details,
          files: [],
          tags,
          link,
          systemWide: SYSTEM_ACTIVITY_SOURCES.has(sourceName),
        };
      })
      .filter((entry): entry is ActivitySessionFeedEntry => entry !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    // PAN-1556, widened by PAN-4301 FR-14: collapse every per-issue entry, not
    // only review kickoffs. The list is newest-first, so the first entry per
    // issue (case-insensitive) is the issue's current state and carries the
    // headline; each older entry for that issue adds one to its stepCount.
    // Entries without an issue pass through untouched.
    const byIssue = new Map<string, ActivitySessionFeedEntry>();
    const collapsed: ActivitySessionFeedEntry[] = [];
    for (const entry of lastResult) {
      if (!entry.issueId) {
        collapsed.push(entry);
        continue;
      }
      const key = entry.issueId.toLowerCase();
      const head = byIssue.get(key);
      if (head) {
        head.stepCount = (head.stepCount ?? 1) + 1;
        continue;
      }
      const first = { ...entry, stepCount: 1 };
      byIssue.set(key, first);
      collapsed.push(first);
    }
    lastResult = collapsed.slice(0, MAX_ACTIVITY_ENTRY_FEED_ENTRIES);
    return lastResult;
  };
}

const selectActivityEntryFeed = createActivityEntryFeedSelector();

export function useActivityEntryFeed(): ActivitySessionFeedEntry[] {
  return useDashboardStore(selectActivityEntryFeed);
}
