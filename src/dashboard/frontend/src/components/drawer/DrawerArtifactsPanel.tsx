import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtifactListEntry, ArtifactListResponse, ArtifactUnshareResponse } from '@panctl/contracts';

import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { cn } from '../../lib/utils';

type ArtifactFilter = 'all' | 'published' | 'pending' | 'unshared';
type ArtifactSort = 'recent' | 'title';

function artifactTitle(entry: ArtifactListEntry) {
  return entry.artifact.title || entry.artifact.slug;
}

function formatArtifactDate(value?: string | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit', year: '2-digit' });
}

function makerLabel(entry: ArtifactListEntry) {
  const target = entry.artifact.issueId ?? entry.artifact.workspaceId ?? 'unscoped work';
  return `Made by ${entry.artifact.agentRole} via ${entry.artifact.agentHarness} for ${target}`;
}

function filterArtifact(entry: ArtifactListEntry, filter: ArtifactFilter) {
  if (filter === 'pending') return entry.status.pendingChanges;
  if (filter === 'unshared') return entry.status.unshared;
  if (filter === 'published') return Boolean(entry.artifact.publishedAt || entry.status.lastPublishedHash) && !entry.status.unshared;
  return true;
}

function sortArtifacts(a: ArtifactListEntry, b: ArtifactListEntry, sort: ArtifactSort) {
  if (sort === 'title') return artifactTitle(a).localeCompare(artifactTitle(b));
  const aTime = new Date(a.artifact.publishedAt ?? a.artifact.createdAt).getTime();
  const bTime = new Date(b.artifact.publishedAt ?? b.artifact.createdAt).getTime();
  return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
}

function ArtifactBadge({ children, tone }: { children: string; tone: 'published' | 'pending' | 'unshared' }) {
  return (
    <span
      data-testid={`artifact-badge-${tone}`}
      className={cn(
        'rounded-full border px-[7px] py-[2px] text-[10px] font-medium leading-none',
        tone === 'published' && 'border-success/40 bg-success/10 text-success-foreground',
        tone === 'pending' && 'border-warning/40 bg-warning/10 text-warning-foreground',
        tone === 'unshared' && 'border-muted-foreground/30 bg-muted/40 text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function updateUnsharedArtifact(
  current: ArtifactListResponse | undefined,
  slug: string,
  response: ArtifactUnshareResponse,
): ArtifactListResponse | undefined {
  if (!current) return current;
  return {
    artifacts: current.artifacts.map((entry) => {
      if (entry.artifact.slug !== slug) return entry;
      return {
        ...entry,
        artifact: response.artifact,
        status: response.status,
      };
    }),
  };
}

export default function DrawerArtifactsPanel({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const [sort, setSort] = useState<ArtifactSort>('recent');
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const queryKey = ['drawer-artifacts', issueId] as const;

  const { data, isLoading, isError } = useQuery<ArtifactListResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}/artifacts`);
      if (!res.ok) throw new Error(`Failed to load artifacts for ${issueId}`);
      return res.json() as Promise<ArtifactListResponse>;
    },
    retry: false,
  });

  const unshare = useMutation({
    mutationFn: async (slug: string) => {
      const res = await fetch(`/api/artifacts/${slug}/unshare`, {
        method: 'POST',
        headers: await dashboardMutationJsonHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to unshare artifact ${slug}`);
      return { slug, response: await res.json() as ArtifactUnshareResponse };
    },
    onSuccess: ({ slug, response }) => {
      queryClient.setQueryData<ArtifactListResponse>(queryKey, (current) => updateUnsharedArtifact(current, slug, response));
    },
  });

  const artifacts = useMemo(() => {
    return [...(data?.artifacts ?? [])]
      .filter((entry) => filterArtifact(entry, filter))
      .sort((a, b) => sortArtifacts(a, b, sort));
  }, [data?.artifacts, filter, sort]);

  const copyLink = async (entry: ArtifactListEntry) => {
    await navigator.clipboard?.writeText(entry.urls.wrapperUrl);
    setCopiedSlug(entry.artifact.slug);
  };

  return (
    <div data-testid="drawer-tab-panel-artifacts" className="space-y-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-[var(--radius)] border border-border bg-card p-[12px]">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Artifacts</div>
          <div className="mt-[2px] text-[13px] text-muted-foreground">Browser-viewable work products for this issue.</div>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <label className="flex items-center gap-[6px] text-[12px] text-muted-foreground">
            Filter
            <select
              aria-label="Filter artifacts"
              className="rounded-[var(--radius-sm)] border border-border bg-background px-[8px] py-[5px] text-[12px] text-foreground"
              value={filter}
              onChange={(event) => setFilter(event.target.value as ArtifactFilter)}
            >
              <option value="all">All</option>
              <option value="published">Published</option>
              <option value="pending">Pending changes</option>
              <option value="unshared">Unshared</option>
            </select>
          </label>
          <label className="flex items-center gap-[6px] text-[12px] text-muted-foreground">
            Sort
            <select
              aria-label="Sort artifacts"
              className="rounded-[var(--radius-sm)] border border-border bg-background px-[8px] py-[5px] text-[12px] text-foreground"
              value={sort}
              onChange={(event) => setSort(event.target.value as ArtifactSort)}
            >
              <option value="recent">Most recent</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card/60 p-[18px] text-[13px] text-muted-foreground">
          Loading artifacts…
        </div>
      ) : isError ? (
        <div className="rounded-[var(--radius)] border border-dashed border-destructive/40 bg-card/60 p-[18px] text-[13px] text-destructive-foreground">
          Failed to load artifacts
        </div>
      ) : artifacts.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card/60 p-[18px] text-[13px] text-muted-foreground">
          No artifacts published for this issue yet.
        </div>
      ) : (
        <div className="grid gap-[12px] md:grid-cols-2" data-testid="drawer-artifact-grid">
          {artifacts.map((entry) => (
            <article
              key={entry.artifact.artifactId}
              data-testid={`drawer-artifact-card-${entry.artifact.slug}`}
              className="overflow-hidden rounded-[var(--radius)] border border-border bg-card"
            >
              <div className="aspect-video border-b border-border bg-muted/30">
                {entry.thumbnailUrl ? (
                  <img
                    src={entry.thumbnailUrl}
                    alt={`Thumbnail for ${artifactTitle(entry)}`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground">
                    {entry.artifact.slug}
                  </div>
                )}
              </div>
              <div className="space-y-[10px] p-[12px]">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-medium text-foreground" title={artifactTitle(entry)}>
                    {artifactTitle(entry)}
                  </h3>
                  <div className="mt-[3px] text-[12px] text-muted-foreground" data-testid="drawer-artifact-maker">
                    {makerLabel(entry)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-[8px] font-mono text-[10px] text-muted-foreground">
                  <div>
                    <span className="block uppercase tracking-[0.08em]">Created</span>
                    <span className="text-foreground">{formatArtifactDate(entry.artifact.createdAt)}</span>
                  </div>
                  <div>
                    <span className="block uppercase tracking-[0.08em]">Workspace</span>
                    <span className="text-foreground">{entry.artifact.workspaceId ?? '—'}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-[6px]">
                  {entry.artifact.publishedAt || entry.status.lastPublishedHash ? <ArtifactBadge tone="published">Published</ArtifactBadge> : null}
                  {entry.status.pendingChanges ? <ArtifactBadge tone="pending">Pending Changes</ArtifactBadge> : null}
                  {entry.status.unshared ? <ArtifactBadge tone="unshared">Unshared</ArtifactBadge> : null}
                </div>
                <div className="flex flex-wrap gap-[8px] pt-[2px]">
                  <a
                    href={entry.urls.wrapperUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[var(--radius-sm)] border border-border px-[9px] py-[5px] text-[12px] text-foreground transition-colors hover:bg-accent"
                  >
                    Open Wrapper
                  </a>
                  <button
                    type="button"
                    className="rounded-[var(--radius-sm)] border border-border px-[9px] py-[5px] text-[12px] text-foreground transition-colors hover:bg-accent"
                    onClick={() => void copyLink(entry)}
                  >
                    {copiedSlug === entry.artifact.slug ? 'Copied' : 'Copy Link'}
                  </button>
                  <button
                    type="button"
                    className="rounded-[var(--radius-sm)] border border-border px-[9px] py-[5px] text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={entry.status.unshared || unshare.isPending}
                    onClick={() => unshare.mutate(entry.artifact.slug)}
                  >
                    Unshare
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
