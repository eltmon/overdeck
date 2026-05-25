import { useMemo } from 'react';
import { Activity, Boxes, GitBranch, Loader2, Sparkles } from 'lucide-react';
import type { MemoryObservation } from '@panctl/contracts';
import { selectIsBootstrapped, useDashboardStore } from '../lib/store';
import { bucketByTime, type TimeBucketKey } from '../lib/timeBuckets';
import { formatRelativeTime } from '../lib/formatRelativeTime';

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

const SECTIONS = [
  {
    title: 'System summary',
    description: 'Running agents, merge pressure, verification status, and cost rollups will appear here.',
    empty: 'No live summary data is available yet.',
    icon: Sparkles,
  },
  {
    title: 'Workspaces',
    description: 'Active workspace status cards will show phase, recent progress, and next steps.',
    empty: 'No workspace status has been reported yet.',
    icon: GitBranch,
  },
  {
    title: 'Knowledge registry',
    description: 'Feature ownership and registry entries will make active work discoverable.',
    empty: 'No registry entries yet.',
    icon: Boxes,
  },
];

function HomeLoadingState() {
  return (
    <div className="flex h-full w-full items-center justify-center p-6" data-testid="home-loading">
      <div className="w-full max-w-5xl space-y-6">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">Loading Home snapshot…</span>
          </div>
          <div className="mt-5 h-7 w-64 rounded bg-muted" />
          <div className="mt-3 h-4 w-full max-w-2xl rounded bg-muted/70" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[...SECTIONS, { title: 'Activity feed', description: '', empty: '', icon: Activity }].map((section) => (
            <div key={section.title} className="rounded-xl border border-border bg-card p-5">
              <div className="h-5 w-36 rounded bg-muted" />
              <div className="mt-4 h-16 rounded-lg bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HomePage() {
  const isBootstrapped = useDashboardStore(selectIsBootstrapped);

  if (!isBootstrapped) return <HomeLoadingState />;

  return (
    <div className="h-full w-full overflow-y-auto bg-background" data-testid="home-page">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Home</p>
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Panopticon briefing</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                A landing page for live system status, recent activity, active workspaces, and feature ownership.
              </p>
            </div>
            <div className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
              Live Home data
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]" aria-label="Home activity">
          <HomeActivityFeed />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            {SECTIONS.map(({ title, description, empty, icon: Icon }) => (
              <article key={title} className="flex min-h-44 flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg border border-border bg-background p-2 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">{title}</h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                  </div>
                </div>
                <div className="mt-6 flex flex-1 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center" data-testid="home-empty-state">
                  <p className="text-sm text-muted-foreground">{empty}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function HomeActivityFeed({ now = new Date() }: { now?: Date }) {
  const observationsByIssueId = useDashboardStore((state) => state.observationsByIssueId);
  const observations = useMemo(() => selectActionObservations(observationsByIssueId), [observationsByIssueId]);
  const buckets = useMemo(() => bucketByTime(observations, (observation) => observation.timestamp, now), [observations, now]);

  return (
    <article className="rounded-xl border border-border bg-card p-5 shadow-sm" data-testid="home-activity-feed">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border border-border bg-background p-2 text-primary">
          <Activity className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">Activity feed</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Recent actionable memory observations across workspaces.
          </p>
        </div>
      </div>

      {observations.length === 0 ? (
        <div data-testid="home-activity-empty" className="mt-6 rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-sm text-muted-foreground">
          Observations will appear after PAN-1052 memory extraction creates them.
        </div>
      ) : (
        <div className="mt-6 space-y-5">
          {BUCKET_ORDER.map((bucketKey) => {
            const items = buckets[bucketKey];
            if (items.length === 0) return null;

            return (
              <section key={bucketKey} data-testid={`home-activity-bucket-${bucketKey}`}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {BUCKET_LABELS[bucketKey]}
                </h3>
                <ul className="space-y-2">
                  {items.map((observation) => (
                    <HomeActivityFeedItem key={observation.id} observation={observation} now={now} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </article>
  );
}

function HomeActivityFeedItem({ observation, now }: { observation: MemoryObservation & { actionStatus: string }; now: Date }) {
  return (
    <li className="rounded-lg border border-border bg-background p-3 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-foreground">{observation.actionStatus}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {observation.workspaceId} · {observation.issueId} · <time dateTime={observation.timestamp}>{formatRelativeTime(observation.timestamp, now)}</time>
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm text-foreground">{observation.summary}</p>
      {observation.narrative ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{observation.narrative}</p> : null}
      {observation.files.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1" aria-label="Files">
          {observation.files.map((file) => (
            <code key={file} className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {file}
            </code>
          ))}
        </div>
      ) : null}
      {observation.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Tags">
          {observation.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function selectActionObservations(observationsByIssueId: Record<string, MemoryObservation[]>): Array<MemoryObservation & { actionStatus: string }> {
  return Object.values(observationsByIssueId)
    .flatMap((observations) => observations)
    .filter((observation): observation is MemoryObservation & { actionStatus: string } => observation.actionStatus !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
