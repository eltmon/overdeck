import type { IssueId, MemoryObservation } from '@panctl/contracts';
import type { DashboardState } from '../../lib/store';
import { useDashboardStore } from '../../lib/store';
import type { ActivitySessionFeedEntry } from './types';

export const MAX_OBSERVATION_FEED_ENTRIES = 500;

export function createObservationFeedSelector() {
  let lastSource: DashboardState['observationsByIssueId'] | undefined;
  let lastResult: ActivitySessionFeedEntry[] | undefined;

  return (state: Pick<DashboardState, 'observationsByIssueId'>): ActivitySessionFeedEntry[] => {
    const source = state.observationsByIssueId;
    if (source === lastSource && lastResult) return lastResult;

    lastSource = source;
    lastResult = Object.values(source)
      .flatMap((observations) => observations)
      .filter((observation): observation is MemoryObservation & { actionStatus: string } => observation.actionStatus !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_OBSERVATION_FEED_ENTRIES)
      .map((observation) => ({
        kind: 'activity',
        id: observation.id,
        timestamp: observation.timestamp,
        workspaceId: observation.workspaceId,
        issueId: observation.issueId as IssueId,
        headline: observation.actionStatus,
        summary: observation.summary,
        narrative: observation.narrative,
        files: observation.files,
        tags: observation.tags,
      }));
    return lastResult;
  };
}

const selectObservationFeed = createObservationFeedSelector();

export function useObservationFeed(): ActivitySessionFeedEntry[] {
  return useDashboardStore(selectObservationFeed);
}
