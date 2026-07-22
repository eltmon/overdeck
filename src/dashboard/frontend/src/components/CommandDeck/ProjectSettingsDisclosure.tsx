import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
    </div>
  );
}

function ProjectDisclosure({
  title,
  summary,
  badges,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  badges?: string[];
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
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
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{title}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted-foreground)' }}>{summary}</span>
        </span>
        {badges && badges.length > 0 && (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {badges.map((badge) => (
              <span
                key={badge}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 999,
                  padding: '2px 7px',
                  background: 'var(--secondary)',
                  color: 'var(--foreground)',
                  fontSize: 11,
                  fontWeight: 650,
                  whiteSpace: 'nowrap',
                }}
              >
                {badge}
              </span>
            ))}
          </span>
        )}
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
      summary="Auto-merge default and project-level merge policy"
      badges={['collapsed']}
    >
      <ProjectSettingsSection projectKey={projectKey} />
    </ProjectDisclosure>
  );
}
