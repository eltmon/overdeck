import { useMemo } from 'react';
import type { MemoryObservation } from '@panctl/contracts';
import type { DashboardState } from '../../lib/store';
import { useDashboardStore } from '../../lib/store';
import { bucketByTime, type TimeBucketKey } from '../../lib/timeBuckets';
import { formatRelativeTime } from '../../lib/formatRelativeTime';

const BUCKET_LABELS: Record<TimeBucketKey, string> = {
  justNow: 'Just Now',
  earlierToday: 'Earlier Today',
  yesterday: 'Yesterday',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
};

const BUCKET_ORDER: readonly TimeBucketKey[] = [
  'justNow',
  'earlierToday',
  'yesterday',
  'thisWeek',
  'thisMonth',
  'older',
];

const EMPTY_OBSERVATIONS: readonly MemoryObservation[] = [];

export function createActionStatusObservationSelector(issueId: string) {
  let lastSource: readonly MemoryObservation[] | undefined;
  let lastResult: MemoryObservation[] | undefined;

  return (state: Pick<DashboardState, 'observationsByIssueId'>): MemoryObservation[] => {
    const source = state.observationsByIssueId[issueId] ?? EMPTY_OBSERVATIONS;
    if (source === lastSource && lastResult) return lastResult;

    lastSource = source;
    lastResult = source
      .filter((observation) => observation.actionStatus !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return lastResult;
  };
}

interface ActivityFeedSidebarProps {
  issueId: string;
  now?: Date;
}

export function ActivityFeedSidebar({ issueId, now = new Date() }: ActivityFeedSidebarProps) {
  const selectActionObservations = useMemo(() => createActionStatusObservationSelector(issueId), [issueId]);
  const observations = useDashboardStore(selectActionObservations);
  const buckets = useMemo(
    () => bucketByTime(observations, (observation) => observation.timestamp, now),
    [observations, now],
  );

  return (
    <aside data-testid="activity-feed-sidebar" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className="shrink-0">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Activity</h3>
        <p className="mt-1 text-xs text-muted-foreground/80">Recent workspace action updates</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {observations.length === 0 ? (
          <div data-testid="activity-feed-empty" className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No action status updates yet.
          </div>
        ) : (
          <div className="space-y-4">
            {BUCKET_ORDER.map((bucketKey) => {
              const items = buckets[bucketKey];
              if (items.length === 0) return null;

              return (
                <section key={bucketKey} data-testid={`activity-feed-bucket-${bucketKey}`}>
                  <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {BUCKET_LABELS[bucketKey]}
                  </h4>
                  <ul className="space-y-1.5">
                    {items.map((observation) => (
                      <li
                        key={observation.id}
                        className="rounded-lg border border-border bg-card p-2 text-xs"
                      >
                        <div className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">{observation.actionStatus}</p>
                            <div className="mt-1 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                              <span className="truncate">{observation.workspaceId} · {observation.issueId}</span>
                              <span aria-hidden="true">·</span>
                              <time dateTime={observation.timestamp} className="shrink-0">
                                {formatRelativeTime(observation.timestamp, now)}
                              </time>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
