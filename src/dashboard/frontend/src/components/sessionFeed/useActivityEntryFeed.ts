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

    // PAN-1556: collapse repeated review-kickoff entries per issue — keep only
    // the most-recent "Review role spawned for <ISSUE>" so re-reviews of the
    // same issue don't stack up and bury conversations. Verdicts/errors use
    // different messages and are left untouched.
    const seenReviewKickoff = new Set<string>();
    lastResult = lastResult
      .filter((entry) => {
        if (entry.issueId && entry.headline.startsWith('Review role spawned')) {
          if (seenReviewKickoff.has(entry.issueId)) return false;
          seenReviewKickoff.add(entry.issueId);
        }
        return true;
      })
      .slice(0, MAX_ACTIVITY_ENTRY_FEED_ENTRIES);
    return lastResult;
  };
}

const selectActivityEntryFeed = createActivityEntryFeedSelector();

export function useActivityEntryFeed(): ActivitySessionFeedEntry[] {
  return useDashboardStore(selectActivityEntryFeed);
}
