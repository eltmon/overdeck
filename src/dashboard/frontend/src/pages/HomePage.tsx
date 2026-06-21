import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { AgentSnapshot, FeatureRegistryEntry, MemoryHealthSnapshot, MemoryObservation, MemoryStatus, ReviewStatusSnapshot } from '@overdeck/contracts';
import { WorkspaceStatusCard, type WorkspaceStatusStats } from '../components/CommandDeck/WorkspaceStatusCard';
import { fetchProjects, type ProjectData } from '../components/CommandDeck/projectsData';
import { useDashboardStore, selectLatestMemoryFailure } from '../lib/store';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { bucketByTime, type TimeBucketKey } from '../lib/timeBuckets';
import type { Issue } from '../types';

interface FeatureRegistryResponse {
  entries: FeatureRegistryEntry[];
}

interface MetricsSummaryResponse {
  today?: {
    totalCost?: number;
  };
}

interface HomeSummaryCards {
  runningAgents: number;
  gatedAgents: number;
  recentMerges: number;
  failedVerifications: number;
  dailyCost: number | null;
}

interface SummaryCardView {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}

interface HomePageProps {
  onOpenWorkspaceHome?: (issueId: string) => void;
  /** PAN-1970: open the New Project modal. */
  onNewProject?: () => void;
  /** PAN-1969: open a registered project's deck (same path as the sidebar). */
  onSelectProject?: (projectName: string) => void;
  /** Open Settings (Memory tab) — used by the memory-extraction failure notice. */
  onOpenSettings?: () => void;
  now?: Date;
}

interface HomeWorkspaceSources {
  issuesRaw: unknown[];
  statusByIssueId?: Record<string, MemoryStatus>;
  observationsByIssueId?: Record<string, MemoryObservation[]>;
  agentsById?: Record<string, AgentSnapshot>;
  reviewStatusByIssueId?: Record<string, ReviewStatusSnapshot>;
}

interface HomeWorkspaceCard {
  issue: Pick<Issue, 'identifier' | 'title' | 'description'>;
  status?: MemoryStatus;
  observations: MemoryObservation[];
  stats: WorkspaceStatusStats;
}

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

async function fetchFeatureRegistry(): Promise<FeatureRegistryEntry[]> {
  const response = await fetch('/api/registry/features');
  if (!response.ok) throw new Error(`Registry request failed (${response.status})`);
  const data = await response.json() as Partial<FeatureRegistryResponse>;
  return Array.isArray(data.entries) ? data.entries : [];
}

async function fetchMetricsSummary(): Promise<MetricsSummaryResponse> {
  const response = await fetch('/api/metrics/summary');
  if (!response.ok) throw new Error(`Metrics summary request failed (${response.status})`);
  return response.json() as Promise<MetricsSummaryResponse>;
}

export function HomePage({ onOpenWorkspaceHome, onNewProject, onSelectProject, onOpenSettings, now }: HomePageProps = {}) {
  const registryQuery = useQuery({
    queryKey: ['feature-registry'],
    queryFn: fetchFeatureRegistry,
    staleTime: 30_000,
    retry: false,
  });
  const metricsQuery = useQuery({
    queryKey: ['metrics-summary'],
    queryFn: fetchMetricsSummary,
    staleTime: 30_000,
    retry: false,
  });
  const projectsQuery = useQuery({
    queryKey: ['command-deck-projects'],
    queryFn: fetchProjects,
    staleTime: 30_000,
    retry: false,
  });
  const projects: ProjectData[] = projectsQuery.data ?? [];
  const issuesRaw = useDashboardStore((state) => state.issuesRaw);
  const statusByIssueId = useDashboardStore((state) => state.statusByIssueId);
  const observationsByIssueId = useDashboardStore((state) => state.observationsByIssueId);
  const agentsById = useDashboardStore((state) => state.agentsById);
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const memoryFailure = useDashboardStore(selectLatestMemoryFailure);
  const currentTime = now ?? new Date();
  const workspaceCards = useMemo(() => buildHomeWorkspaceCards({
    issuesRaw,
    statusByIssueId,
    observationsByIssueId,
    agentsById,
    reviewStatusByIssueId,
  }), [agentsById, issuesRaw, observationsByIssueId, reviewStatusByIssueId, statusByIssueId]);
  const actionObservations = useMemo(() => selectActionObservations(observationsByIssueId), [observationsByIssueId]);
  const summaryCards = useMemo(() => buildSummaryCardViews(buildHomeSummaryCards({
    agentsById,
    reviewStatusByIssueId,
    dailyCost: metricsQuery.data?.today?.totalCost,
    now: currentTime,
  })), [agentsById, currentTime, metricsQuery.data?.today?.totalCost, reviewStatusByIssueId]);

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <header className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Overdeck Home</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">System briefing</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            A live landing page for current workspace context, cross-workspace ownership, and memory-first guidance.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Home summary">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums ${card.tone ?? 'text-foreground'}`}>{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
            </div>
          ))}
        </section>

        <HomeActivityFeed observations={actionObservations} failure={memoryFailure} onOpenSettings={onOpenSettings} now={currentTime} />

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="workspace-status-title">
          <div>
            <h2 id="workspace-status-title" className="text-lg font-semibold text-foreground">Workspaces</h2>
            <p className="text-sm text-muted-foreground">Live workspace status rollups from memory observations.</p>
          </div>

          <div className="mt-4">
            {workspaceCards.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {workspaceCards.map((workspace) => (
                  <WorkspaceStatusCard
                    key={workspace.issue.identifier}
                    issue={workspace.issue}
                    status={workspace.status}
                    observations={workspace.observations}
                    stats={workspace.stats}
                    onOpenWorkspaceHome={() => onOpenWorkspaceHome?.(workspace.issue.identifier)}
                    now={now}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No workspace status is available yet.</p>
                <p className="mt-1">Workspace cards will appear after memory status or observations are recorded for an issue.</p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="knowledge-registry-title">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="knowledge-registry-title" className="text-lg font-semibold text-foreground">Knowledge Registry</h2>
              <p className="text-sm text-muted-foreground">Feature ownership across issues, workspaces, and agents.</p>
            </div>
            {registryQuery.isFetching && (
              <span className="mt-2 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground sm:mt-0">Refreshing</span>
            )}
          </div>

          <div className="mt-4">
            {registryQuery.isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
                Knowledge Registry could not be loaded. The rest of Home is still available.
              </div>
            ) : registryQuery.isLoading ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">Loading registry entries…</div>
            ) : registryQuery.data && registryQuery.data.length > 0 ? (
              <FeatureRegistryTable entries={registryQuery.data} />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No features are registered yet.</p>
                <p className="mt-1">
                  Add one with <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">pan registry tag &lt;issueId&gt; &lt;feature&gt;</code>. Automatic classification will populate future entries as issue and workspace lifecycle wiring lands.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="home-projects-title" data-testid="home-projects">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="home-projects-title" className="text-lg font-semibold text-foreground">Projects</h2>
              <p className="text-sm text-muted-foreground">Your registered projects — click one to open its deck.</p>
            </div>
            {onNewProject && (
              <button
                data-testid="home-new-project"
                onClick={onNewProject}
                className="rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                + New project
              </button>
            )}
          </div>

          <div className="mt-4">
            {projectsQuery.isLoading ? (
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">Loading projects…</div>
            ) : projectsQuery.isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" role="alert">
                Projects could not be loaded. The rest of Home is still available.
              </div>
            ) : projects.length > 0 ? (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {projects.map((project) => {
                  const hasActivity = project.features.length > 0;
                  return (
                    <li key={project.path}>
                      <button
                        data-testid={`home-project-${project.name}`}
                        onClick={() => onSelectProject?.(project.name)}
                        title={project.path}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${hasActivity ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{project.name}</span>
                        {hasActivity && (
                          <span className="ml-auto text-xs text-muted-foreground">{project.features.length}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div data-testid="home-projects-empty" className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">No projects yet.</p>
                <p className="mt-1">Create your first project to get started.</p>
                {onNewProject && (
                  <button
                    data-testid="home-new-project-empty"
                    onClick={onNewProject}
                    className="mt-3 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    + New project
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function HomeActivityFeed({ observations, failure, onOpenSettings, now }: { observations: Array<MemoryObservation & { actionStatus: string }>; failure?: MemoryHealthSnapshot | null; onOpenSettings?: () => void; now: Date }) {
  const buckets = useMemo(() => bucketByTime(observations, (observation) => observation.timestamp, now), [observations, now]);

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="home-activity-title" data-testid="home-activity-feed">
      <div>
        <h2 id="home-activity-title" className="text-lg font-semibold text-foreground">Activity Feed</h2>
        <p className="text-sm text-muted-foreground">Recent actionable memory observations across workspaces.</p>
      </div>

      {failure && <MemoryFailureNotice failure={failure} onOpenSettings={onOpenSettings} />}

      {observations.length === 0 ? (
        <div data-testid="home-activity-empty" className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No actionable observations yet.</p>
          <p className="mt-1">Observations are extracted from running work agents — they appear here once an agent makes a change worth recording.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {BUCKET_ORDER.map((bucketKey) => {
            const items = buckets[bucketKey];
            if (items.length === 0) return null;

            return (
              <section key={bucketKey} data-testid={`home-activity-bucket-${bucketKey}`}>
                <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {BUCKET_LABELS[bucketKey]}
                </h3>
                <ul className="space-y-2">
                  {items.map((observation) => <HomeActivityFeedItem key={observation.id} observation={observation} now={now} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MemoryFailureNotice({ failure, onOpenSettings }: { failure: MemoryHealthSnapshot; onOpenSettings?: () => void }) {
  const guidance = explainMemoryFailure(failure);
  return (
    <div
      data-testid="home-memory-failure"
      className="mt-4 rounded-lg border border-destructive/32 bg-destructive/8 p-4 text-sm text-foreground"
      role="alert"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium text-destructive">Memory extraction is failing</p>
          <p className="mt-1 text-muted-foreground">{guidance}</p>
          {failure.detail ? (
            <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">{failure.detail}</p>
          ) : null}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Memory observations and agent memory injection are disabled until this is fixed.
          </p>
          {onOpenSettings ? (
            <button
              onClick={onOpenSettings}
              className="mt-3 rounded-sm border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              Open Settings › Memory
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Map a memory-extraction failure into one actionable sentence for the operator. */
function explainMemoryFailure(failure: MemoryHealthSnapshot): string {
  const detail = (failure.detail ?? '').toLowerCase();
  if (detail.includes('could not resolve authentication') || detail.includes('anthropic_api_key') || detail.includes('x-api-key')) {
    return 'The Anthropic API provider has no API key. Switch the extraction provider to cliproxy (your ChatGPT subscription) in Settings › Memory.';
  }
  if (detail.includes('unknown provider for model') || detail.includes('does not exist') || detail.includes('unknown model')) {
    return 'The configured extraction model is not available on cliproxy. Pick a served model (e.g. gpt-5.4-mini) in Settings › Memory.';
  }
  if (detail.includes('401') || detail.includes('unauthorized') || detail.includes('expired')) {
    return 'The extraction provider rejected the credentials — the codex/ChatGPT subscription token used by cliproxy may have expired. Re-authenticate, then it will recover automatically.';
  }
  return 'Background memory-extraction calls are failing. Check the extraction provider and model in Settings › Memory.';
}

function HomeActivityFeedItem({ observation, now }: { observation: MemoryObservation & { actionStatus: string }; now: Date }) {
  return (
    <li className="rounded-lg border border-border bg-background p-3 text-xs">
      <p className="font-semibold text-foreground">{observation.actionStatus}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {observation.workspaceId} · {observation.issueId} · <time dateTime={observation.timestamp}>{formatRelativeTime(observation.timestamp, now)}</time>
      </p>
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

function buildHomeSummaryCards({
  agentsById = {},
  reviewStatusByIssueId = {},
  dailyCost,
  now,
}: {
  agentsById?: Record<string, AgentSnapshot>;
  reviewStatusByIssueId?: Record<string, ReviewStatusSnapshot>;
  dailyCost?: number;
  now: Date;
}): HomeSummaryCards {
  const agents = Object.values(agentsById);
  const reviewStatuses = Object.values(reviewStatusByIssueId);
  return {
    runningAgents: agents.filter(isRunningAgent).length,
    gatedAgents: agents.filter(isGatedAgent).length,
    recentMerges: reviewStatuses.filter((status) => isRecentMerge(status, now)).length,
    failedVerifications: reviewStatuses.filter(needsVerificationAttention).length,
    dailyCost: typeof dailyCost === 'number' && Number.isFinite(dailyCost) ? dailyCost : null,
  };
}

function buildSummaryCardViews(summary: HomeSummaryCards): SummaryCardView[] {
  return [
    {
      label: 'Running agents',
      value: String(summary.runningAgents),
      detail: 'Live or starting sessions',
      tone: summary.runningAgents > 0 ? 'text-primary' : undefined,
    },
    {
      label: 'Paused / troubled',
      value: String(summary.gatedAgents),
      detail: 'Agents gated by pause or failures',
      tone: summary.gatedAgents > 0 ? 'text-warning' : undefined,
    },
    {
      label: 'Merged today',
      value: String(summary.recentMerges),
      detail: 'Merges in the last 24 hours',
      tone: summary.recentMerges > 0 ? 'text-success' : undefined,
    },
    {
      label: 'Needs verification',
      value: String(summary.failedVerifications),
      detail: 'Failed checks or merge blockers',
      tone: summary.failedVerifications > 0 ? 'text-destructive' : undefined,
    },
    {
      label: 'Cost today',
      value: summary.dailyCost === null ? 'Unavailable' : `$${summary.dailyCost.toFixed(2)}`,
      detail: 'UTC daily cost summary',
      tone: summary.dailyCost === null ? 'text-muted-foreground' : 'text-success',
    },
  ];
}

function isRunningAgent(agent: AgentSnapshot): boolean {
  return agent.hasLiveTmuxSession === true || agent.status === 'running' || agent.status === 'starting';
}

function isGatedAgent(agent: AgentSnapshot): boolean {
  return agent.paused === true || agent.troubled === true || (agent.consecutiveFailures ?? 0) > 0;
}

function isRecentMerge(status: ReviewStatusSnapshot, now: Date): boolean {
  if (status.mergeStatus !== 'merged' || !status.updatedAt) return false;
  const timestamp = Date.parse(status.updatedAt);
  return !Number.isNaN(timestamp) && now.getTime() - timestamp <= 24 * 60 * 60 * 1000;
}

function needsVerificationAttention(status: ReviewStatusSnapshot): boolean {
  return status.verificationStatus === 'failed' ||
    status.testStatus === 'failed' ||
    status.uatStatus === 'failed' ||
    (status.blockerReasons?.length ?? 0) > 0;
}

function selectActionObservations(observationsByIssueId: Record<string, MemoryObservation[]>): Array<MemoryObservation & { actionStatus: string }> {
  return Object.values(observationsByIssueId)
    .flatMap((observations) => observations)
    .filter((observation): observation is MemoryObservation & { actionStatus: string } => observation.actionStatus !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function buildHomeWorkspaceCards({
  issuesRaw,
  statusByIssueId = {},
  observationsByIssueId = {},
  agentsById = {},
  reviewStatusByIssueId = {},
}: HomeWorkspaceSources): HomeWorkspaceCard[] {
  const issueById = new Map<string, Pick<Issue, 'identifier' | 'title' | 'description'>>();
  for (const rawIssue of issuesRaw) {
    const issue = readIssue(rawIssue);
    if (issue) issueById.set(issue.identifier, issue);
  }

  const issueIds = new Set<string>();
  for (const issueId of Object.keys(statusByIssueId)) issueIds.add(issueId);
  for (const [issueId, observations] of Object.entries(observationsByIssueId)) {
    if (observations.length > 0) issueIds.add(issueId);
  }
  for (const agent of Object.values(agentsById)) {
    if (agent.issueId && isActiveWorkspaceAgent(agent)) issueIds.add(agent.issueId);
  }

  return [...issueIds].sort().map((issueId) => {
    const status = statusByIssueId[issueId];
    const observations = observationsByIssueId[issueId] ?? [];
    return {
      issue: issueById.get(issueId) ?? {
        identifier: issueId,
        title: status?.headline || issueId,
        description: status?.summary,
      },
      status,
      observations,
      stats: buildWorkspaceStats(observations, reviewStatusByIssueId[issueId]),
    };
  });
}

function isActiveWorkspaceAgent(agent: AgentSnapshot): boolean {
  return agent.hasLiveTmuxSession === true || ['healthy', 'running', 'starting', 'stuck', 'warning'].includes(agent.status);
}

function buildWorkspaceStats(
  observations: readonly MemoryObservation[],
  reviewStatus: ReviewStatusSnapshot | undefined,
): WorkspaceStatusStats {
  return {
    additions: 0,
    deletions: 0,
    commits: observations.filter(hasCommitTag).length,
    prs: reviewStatus?.prUrl ? 1 : 0,
  };
}

function hasCommitTag(observation: MemoryObservation): boolean {
  return observation.tags.some((tag) => ['commit', 'commits', 'git.commit'].includes(tag.toLowerCase()));
}

function readIssue(value: unknown): Pick<Issue, 'identifier' | 'title' | 'description'> | null {
  if (!isRecord(value) || typeof value.identifier !== 'string' || typeof value.title !== 'string') return null;
  return {
    identifier: value.identifier,
    title: value.title,
    description: typeof value.description === 'string' ? value.description : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function FeatureRegistryTable({ entries }: { entries: FeatureRegistryEntry[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Feature</th>
              <th scope="col" className="px-4 py-3 font-semibold">Issue</th>
              <th scope="col" className="px-4 py-3 font-semibold">Workspace</th>
              <th scope="col" className="px-4 py-3 font-semibold">Agent</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">Updated</th>
              <th scope="col" className="px-4 py-3 font-semibold">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {entries.map((entry) => (
              <tr key={entry.featureId}>
                <td className="px-4 py-3 font-medium text-foreground">{entry.featureName}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.owningIssueId ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.owningWorkspaceId ?? '—'}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{entry.owningAgentId ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-border bg-muted/30 px-2 py-1 text-xs font-medium text-foreground">{entry.status}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{formatUpdatedAt(entry.updatedAt)}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{entry.tags.length > 0 ? entry.tags.join(', ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
