import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { shortName, useMergeTrainData } from '../merge-train/MergeTrainView';

/** PAN-1693/1695: per-project settings in the cockpit — currently the auto-merge default. */
function ProjectSettingsSection({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['project-auto-merge-default', projectKey],
    queryFn: async (): Promise<{ value: 'auto' | 'hold' | null }> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/auto-merge-default`);
      if (!res.ok) return { value: null };
      return res.json();
    },
    enabled: !!projectKey,
  });
  const value = data?.value ?? null;
  const { data: swarmData } = useQuery({ queryKey: ['project-swarm-policy', projectKey], queryFn: async () => (await fetch(`/api/projects/${encodeURIComponent(projectKey)}/swarm-policy`)).json() as Promise<{ configured: { mode?: 'off' | 'auto' | 'always' } | null }> });
  const swarmMutation = useMutation({ mutationFn: async (mode: 'off' | 'auto' | 'always' | null) => { const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/swarm-policy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: mode ? { mode } : null }) }); if (!res.ok) throw new Error('Failed to save swarm policy'); }, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-swarm-policy', projectKey] }) });
  const { data: mergeTrainData } = useQuery({
    queryKey: ['project-merge-train', projectKey],
    queryFn: async (): Promise<{ value: 'enabled' | 'disabled' | null; effective: boolean }> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/merge-train`);
      if (!res.ok) return { value: null, effective: false };
      return res.json();
    },
    enabled: !!projectKey,
  });
  const mergeTrainMutation = useMutation({
    mutationFn: async (next: 'enabled' | 'disabled' | null) => {
      const headers = await dashboardMutationJsonHeaders();
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/merge-train`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error('Failed to save merge-train setting');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-merge-train', projectKey] }),
  });
  const mutation = useMutation({
    mutationFn: async (next: 'auto' | 'hold' | null) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/auto-merge-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error('Failed to save project setting');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-auto-merge-default', projectKey] }),
  });
  const options: Array<{ v: 'auto' | 'hold' | null; label: string; color: string }> = [
    { v: 'auto', label: '⚡ Auto', color: 'var(--success)' },
    { v: 'hold', label: '🔒 Hold for UAT', color: 'var(--warning)' },
    { v: null, label: 'Global default', color: 'var(--muted-foreground)' },
  ];
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 650, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--muted-foreground)' }}>Project settings</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--foreground)' }}>Auto-merge default</span>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {options.map((o, i) => {
            const active = value === o.v;
            return (
              <button
                key={String(o.v)}
                type="button"
                // Both this group and the merge-train group below offer a
                // "Global default" option; without a scoped accessible name the
                // two are indistinguishable to a screen reader (and to a query).
                aria-label={`Auto-merge default: ${o.label}`}
                aria-pressed={active}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate(o.v)}
                style={{
                  appearance: 'none',
                  border: 0,
                  borderLeft: i === 0 ? 0 : '1px solid var(--border)',
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? `color-mix(in srgb, ${o.color} 16%, transparent)` : 'transparent',
                  color: active ? o.color : 'var(--muted-foreground)',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
        Applies to this project's issues that have no explicit per-issue auto-merge setting.
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-3"><span className="text-[13px] text-foreground">Automatic swarming</span><select aria-label="Project swarm policy" className="rounded-md border border-input bg-background px-2 py-1.5 text-xs" value={swarmData?.configured?.mode ?? ''} onChange={e => { const value = e.target.value; swarmMutation.mutate(value === 'off' || value === 'auto' || value === 'always' ? value : null); }}><option value="">Inherit global</option><option value="off">Off</option><option value="auto">Auto</option><option value="always">Always</option></select><span className="text-[11px] text-muted-foreground">Future dispatches only</span></div>
      <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-3"><span className="text-[13px] text-foreground">Merge train</span><div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { v: 'enabled' as const, label: 'Enabled' },
          { v: 'disabled' as const, label: 'Disabled' },
          { v: null, label: 'Global default' },
        ].map((o, i) => {
          const active = mergeTrainData?.value === o.v;
          return (
            <button
              key={String(o.v)}
              type="button"
              aria-label={`Merge train: ${o.label}`}
              aria-pressed={active}
              disabled={mergeTrainMutation.isPending}
              onClick={() => mergeTrainMutation.mutate(o.v)}
              style={{
                appearance: 'none',
                border: 0,
                borderLeft: i === 0 ? 0 : '1px solid var(--border)',
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: active ? 'color-mix(in srgb, var(--primary) 16%, transparent)' : 'transparent',
                color: active ? 'var(--primary)' : 'var(--muted-foreground)',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {/* PAN-1696 ac1: "Global default" alone does not tell the operator whether
          the train is actually running here, so resolve it from the endpoint's
          effective field. An explicit Enabled/Disabled needs no gloss. */}
      {mergeTrainData && mergeTrainData.value === null && (
        <span className="text-[11px] text-muted-foreground" data-testid="merge-train-effective">
          Following the global default — currently {mergeTrainData.effective ? 'on' : 'off'} for this project.
        </span>
      )}
      </div>
      <MergeTrainSummary projectKey={projectKey} />
    </div>
  );
}

/** SPA navigation to a tab: the router keys off the path and listens for popstate. */
function goToAwaitingMerge(event: React.MouseEvent): void {
  event.preventDefault();
  window.history.pushState({}, '', '/awaiting-merge');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * PAN-1696 ac3: a compact per-project merge-train summary in the cockpit — how
 * many features are ready and what the current batch is — linking to the full
 * multi-project view on Awaiting Merge. Reads the aggregate endpoints and filters
 * to this project, so it needs no flywheel run.
 */
function MergeTrainSummary({ projectKey }: { projectKey: string }) {
  // Reuse the merge-train view's own reads instead of redeclaring queries under
  // the same react-query keys: duplicate definitions on one key mean whichever
  // component mounts first decides the fetcher and the polling interval, and the
  // two copies disagreed on error handling. One hook, one contract.
  const { sections, isLoading } = useMergeTrainData(false);
  const section = sections.find((s) => s.projectKey === projectKey);
  const readyCount = section?.queue.length ?? 0;
  const chain = section?.generations ?? [];
  // Newest testable batch first — the same precedence the merge-train view uses.
  const current = chain.find((g) => g.status === 'ready')
    ?? chain.find((g) => g.status === 'assembling')
    ?? chain.find((g) => g.status === 'superseded');

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[11px]" data-testid="merge-train-summary">
      <span className="text-muted-foreground">
        {isLoading
          ? 'Loading the merge train…'
          : `${readyCount} feature${readyCount === 1 ? '' : 's'} ready${
              current ? ` · batch ${shortName(current.name)} (${current.status})` : ' · no batch assembled'
            }`}
      </span>
      <a
        href="/awaiting-merge"
        onClick={goToAwaitingMerge}
        className="font-medium text-primary hover:underline"
      >
        Awaiting Merge →
      </a>
    </div>
  );
}

function ProjectSettingsSummary({ projectKey }: { projectKey: string }) {
  const { data } = useQuery({
    queryKey: ['project-auto-merge-default', projectKey],
    queryFn: async (): Promise<{ value: 'auto' | 'hold' | null }> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/auto-merge-default`);
      if (!res.ok) return { value: null };
      return res.json();
    },
    enabled: !!projectKey,
  });
  const { data: swarmData } = useQuery({ queryKey: ['project-swarm-policy', projectKey], queryFn: async () => (await fetch(`/api/projects/${encodeURIComponent(projectKey)}/swarm-policy`)).json() as Promise<{ configured: { mode?: 'off' | 'auto' | 'always' } | null }> });

  // PAN-1696 ac3: the merge-train state has to be legible while the disclosure is
  // COLLAPSED. The expanded panel's summary is invisible until the operator opens
  // it, so "the cockpit shows the ready-feature count" was only half true.
  const { sections } = useMergeTrainData(false);
  const trainSection = sections.find((sec) => sec.projectKey === projectKey);

  if (!data || !swarmData) return null;

  const autoMergeLabel = data.value === 'auto'
    ? '⚡ Auto'
    : data.value === 'hold'
      ? '🔒 Hold for UAT'
      : 'Global default';
  const swarmLabel = swarmData.configured?.mode === 'off'
    ? 'Swarm off'
    : swarmData.configured?.mode === 'auto'
      ? 'Swarm auto'
      : swarmData.configured?.mode === 'always'
        ? 'Swarm always'
        : 'Swarm inherit';

  const readyCount = trainSection?.queue.length ?? 0;
  const currentBatch = trainSection?.generations.find((g) => g.status === 'ready')
    ?? trainSection?.generations.find((g) => g.status === 'assembling')
    ?? trainSection?.generations.find((g) => g.status === 'superseded');
  const trainLabel = trainSection && !trainSection.enabled
    ? 'Train off'
    : `Train ${readyCount} ready${currentBatch ? ` · ${shortName(currentBatch.name)}` : ''}`;

  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)' }} data-testid="project-settings-collapsed-summary">
      {autoMergeLabel} · {swarmLabel} · {trainLabel}
    </span>
  );
}

function ProjectDisclosure({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--card)',
        overflow: 'hidden',
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 10,
          padding: '11px 12px',
          listStyle: 'none',
        }}
      >
        <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <ChevronRight size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{title}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted-foreground)' }}>{summary}</span>
        </span>
      </summary>
      <div style={{ borderTop: '1px solid var(--border)', padding: 12, background: 'var(--background)' }}>
        {children}
      </div>
    </details>
  );
}

export function ProjectSettingsDisclosure({ projectKey }: { projectKey: string }) {
  return (
    <ProjectDisclosure
      title="Project settings"
      summary={<ProjectSettingsSummary projectKey={projectKey} />}
    >
      <ProjectSettingsSection projectKey={projectKey} />
    </ProjectDisclosure>
  );
}
