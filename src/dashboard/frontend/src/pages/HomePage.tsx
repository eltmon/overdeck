import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentSnapshot, FeatureRegistryEntry, MemoryObservation, MemoryStatus, ReviewStatusSnapshot } from '@panctl/contracts';
import { WorkspaceStatusCard, type WorkspaceStatusStats } from '../components/CommandDeck/WorkspaceStatusCard';
import { useDashboardStore } from '../lib/store';
import type { Issue } from '../types';

interface FeatureRegistryResponse {
  entries: FeatureRegistryEntry[];
}

interface HomePageProps {
  onOpenWorkspaceHome?: (issueId: string) => void;
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

async function fetchFeatureRegistry(): Promise<FeatureRegistryEntry[]> {
  const response = await fetch('/api/registry/features');
  if (!response.ok) throw new Error(`Registry request failed (${response.status})`);
  const data = await response.json() as Partial<FeatureRegistryResponse>;
  return Array.isArray(data.entries) ? data.entries : [];
}

export function HomePage({ onOpenWorkspaceHome, now }: HomePageProps = {}) {
  const registryQuery = useQuery({
    queryKey: ['feature-registry'],
    queryFn: fetchFeatureRegistry,
    staleTime: 30_000,
    retry: false,
  });
  const issuesRaw = useDashboardStore((state) => state.issuesRaw);
  const statusByIssueId = useDashboardStore((state) => state.statusByIssueId);
  const observationsByIssueId = useDashboardStore((state) => state.observationsByIssueId);
  const agentsById = useDashboardStore((state) => state.agentsById);
  const reviewStatusByIssueId = useDashboardStore((state) => state.reviewStatusByIssueId);
  const workspaceCards = useMemo(() => buildHomeWorkspaceCards({
    issuesRaw,
    statusByIssueId,
    observationsByIssueId,
    agentsById,
    reviewStatusByIssueId,
  }), [agentsById, issuesRaw, observationsByIssueId, reviewStatusByIssueId, statusByIssueId]);

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
        <header className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Panopticon Home</p>
          <h1 className="mt-2 text-3xl font-semibold text-foreground">System briefing</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            A live landing page for current workspace context, cross-workspace ownership, and memory-first guidance.
          </p>
        </header>

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
      </div>
    </div>
  );
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
