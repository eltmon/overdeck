import { Activity, Boxes, GitBranch, Loader2, Sparkles } from 'lucide-react';
import { selectIsBootstrapped, useDashboardStore } from '../lib/store';

const SECTIONS = [
  {
    title: 'System summary',
    description: 'Running agents, merge pressure, verification status, and cost rollups will appear here.',
    empty: 'No live summary data is available yet.',
    icon: Sparkles,
  },
  {
    title: 'Activity feed',
    description: 'Recent memory observations and actionable workspace updates will collect here.',
    empty: 'No observations yet. Activity will appear after memory extraction creates it.',
    icon: Activity,
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
          {SECTIONS.map((section) => (
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
              Waiting for live Home data
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Home sections">
          {SECTIONS.map(({ title, description, empty, icon: Icon }) => (
            <article key={title} className="flex min-h-56 flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
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
        </section>
      </div>
    </div>
  );
}
