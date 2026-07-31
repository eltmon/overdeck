import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { shortName, useMergeTrainData } from '../merge-train/MergeTrainView';

interface VersionSyncConfig {
  set?: Array<{ path: string; json_field: string }>;
  command?: string;
  command_cwd?: string;
  command_image?: string;
  expect?: Array<{ path: string; pattern: string }>;
  commit_message?: string;
  push?: string[];
}

interface VersionShipOutcome {
  status: 'pending' | 'passed' | 'partial' | 'failed';
  version?: string;
  batch: string;
  paths?: Array<{ path: string; ok: boolean; detail: string }>;
  errorCode?: string;
  at: string;
}

interface VersionSyncPayload {
  config: VersionSyncConfig | null;
  lastOutcome: VersionShipOutcome | null;
}

interface VersionSyncDraft {
  set: Array<{ path: string; json_field: string }>;
  command: string;
  command_cwd: string;
  command_image: string;
  expect: Array<{ path: string; pattern: string }>;
  commit_message: string;
  push: string[];
}

const emptyVersionSyncDraft = (): VersionSyncDraft => ({
  set: [],
  command: '',
  command_cwd: '',
  command_image: '',
  expect: [],
  commit_message: '',
  push: [],
});

function versionSyncDraft(config: VersionSyncConfig | null): VersionSyncDraft {
  return {
    set: config?.set?.map(entry => ({ ...entry })) ?? [],
    command: config?.command ?? '',
    command_cwd: config?.command_cwd ?? '',
    command_image: config?.command_image ?? '',
    expect: config?.expect?.map(entry => ({ ...entry })) ?? [],
    commit_message: config?.commit_message ?? '',
    push: [...(config?.push ?? [])],
  };
}

function compactVersionSyncDraft(draft: VersionSyncDraft): VersionSyncConfig {
  return {
    ...(draft.set.length > 0 ? { set: draft.set.map(entry => ({ path: entry.path.trim(), json_field: entry.json_field.trim() })) } : {}),
    ...(draft.command.trim() ? { command: draft.command.trim() } : {}),
    ...(draft.command_cwd.trim() ? { command_cwd: draft.command_cwd.trim() } : {}),
    ...(draft.command_image.trim() ? { command_image: draft.command_image.trim() } : {}),
    ...(draft.expect.length > 0 ? { expect: draft.expect.map(entry => ({ path: entry.path.trim(), pattern: entry.pattern })) } : {}),
    ...(draft.commit_message.trim() ? { commit_message: draft.commit_message.trim() } : {}),
    ...(draft.push.length > 0 ? { push: draft.push.map(path => path.trim()) } : {}),
  };
}

class VersionSyncSaveError extends Error {
  constructor(readonly errors: string[]) {
    super(errors[0] ?? 'Failed to save version sync');
  }
}

function versionSyncFieldErrors(errors: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const error of errors) {
    const field = /^version_sync\.([^\s]+)\s/.exec(error)?.[1]?.replace(/\[(\d+)\]/g, '.$1') ?? '_form';
    result[field] = error;
  }
  return result;
}

function VersionShipOutcomeView({ outcome }: { outcome: VersionShipOutcome | null }) {
  if (!outcome) return <p className="text-[11px] text-muted-foreground">No batch version ship has been recorded yet.</p>;
  if (outcome.status === 'passed') {
    return (
      <p className="text-[11px] text-emerald-400">
        Version {outcome.version ?? 'unknown'} shipped for {shortName(outcome.batch)} at {new Date(outcome.at).toLocaleString()}.
      </p>
    );
  }
  if (outcome.status === 'pending') {
    return (
      <p className="text-[11px] text-amber-400">
        batch {shortName(outcome.batch)} merged without a version — ship one from the batch card&apos;s Ship version action.
      </p>
    );
  }
  if (outcome.status === 'partial') {
    const failed = outcome.paths?.filter(path => !path.ok) ?? [];
    return (
      <div className="text-[11px] text-amber-400">
        <p>Partial propagation — these paths do not report {outcome.version ?? 'the requested version'}:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[10.5px]">
          {failed.map(path => <li key={path.path}>{path.path}</li>)}
        </ul>
      </div>
    );
  }
  return (
    <p className="text-[11px] text-red-400">
      Version ship failed for {shortName(outcome.batch)}: {outcome.errorCode ?? 'unknown failure'}
    </p>
  );
}

function VersionShipSettings({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['project-version-sync', projectKey] as const;
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async (): Promise<VersionSyncPayload> => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/version-sync`);
      const payload = await res.json().catch(() => ({})) as Partial<VersionSyncPayload> & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? 'Failed to load version sync');
      return { config: payload.config ?? null, lastOutcome: payload.lastOutcome ?? null };
    },
    enabled: !!projectKey,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VersionSyncDraft>(emptyVersionSyncDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: async (config: VersionSyncConfig | null) => {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/version-sync`, {
        method: 'PUT',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ config }),
      });
      const payload = await res.json().catch(() => ({})) as { config?: VersionSyncConfig | null; errors?: string[]; error?: string };
      if (!res.ok) throw new VersionSyncSaveError(payload.errors ?? [payload.error ?? 'Failed to save version sync']);
      return payload.config ?? null;
    },
    onSuccess: (config) => {
      queryClient.setQueryData<VersionSyncPayload>(queryKey, current => ({
        config,
        lastOutcome: current?.lastOutcome ?? null,
      }));
      setEditing(false);
      setFieldErrors({});
    },
    onError: (error) => {
      setFieldErrors(versionSyncFieldErrors(error instanceof VersionSyncSaveError ? error.errors : [String(error)]));
    },
  });

  const beginEditing = () => {
    setDraft(versionSyncDraft(data?.config ?? null));
    setFieldErrors({});
    setEditing(true);
  };
  const fieldError = (field: string) => fieldErrors[field]
    ? <p className="mt-0.5 text-[10px] text-red-400">{fieldErrors[field]}</p>
    : null;
  const inputClass = 'w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary';

  return (
    <section className="mt-2 border-t border-border pt-3" data-testid="version-ship-settings">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-semibold text-foreground">Version ship</h4>
          <p className="text-[10.5px] text-muted-foreground">Propagates version strings after a tested batch merges. It does not publish, deploy, tag, or submit stores.</p>
        </div>
        {!editing && data?.config && (
          <button type="button" onClick={beginEditing} className="text-[11px] font-medium text-primary hover:underline">Edit</button>
        )}
      </div>

      {isLoading ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Loading version ship…</p>
      ) : editing ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[10.5px] text-muted-foreground">Command
              <input aria-label="Version sync command" className={inputClass} value={draft.command} onChange={event => setDraft({ ...draft, command: event.target.value })} placeholder="pnpm vsync" />
              {fieldError('command')}
            </label>
            <label className="text-[10.5px] text-muted-foreground">Command working directory
              <input aria-label="Version sync command cwd" className={inputClass} value={draft.command_cwd} onChange={event => setDraft({ ...draft, command_cwd: event.target.value })} placeholder="frontend" />
              {fieldError('command_cwd')}
            </label>
            <label className="text-[10.5px] text-muted-foreground">Sandbox image
              <input aria-label="Version sync command image" className={inputClass} value={draft.command_image} onChange={event => setDraft({ ...draft, command_image: event.target.value })} placeholder="myn-version-sync:latest" />
              {fieldError('command_image')}
            </label>
          </div>
          <label className="block text-[10.5px] text-muted-foreground">Commit message
            <input aria-label="Version sync commit message" className={inputClass} value={draft.commit_message} onChange={event => setDraft({ ...draft, commit_message: event.target.value })} placeholder="chore: bump version to {version}" />
            {fieldError('commit_message')}
          </label>

          <div>
            <div className="flex items-center justify-between"><span className="text-[10.5px] font-semibold text-foreground">JSON fields to set</span><button type="button" onClick={() => setDraft({ ...draft, set: [...draft.set, { path: '', json_field: 'version' }] })} className="text-[10px] text-primary hover:underline">Add target</button></div>
            <div className="mt-1 space-y-1.5">
              {draft.set.map((entry, index) => (
                <div key={index} className="grid grid-cols-[1fr_0.7fr_auto] gap-1.5">
                  <div><input aria-label={`Set path ${index + 1}`} className={inputClass} value={entry.path} onChange={event => setDraft({ ...draft, set: draft.set.map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) })} placeholder="package.json" />{fieldError(`set.${index}.path`)}</div>
                  <div><input aria-label={`Set JSON field ${index + 1}`} className={inputClass} value={entry.json_field} onChange={event => setDraft({ ...draft, set: draft.set.map((item, itemIndex) => itemIndex === index ? { ...item, json_field: event.target.value } : item) })} placeholder="version" />{fieldError(`set.${index}.json_field`)}</div>
                  <button type="button" aria-label={`Remove set target ${index + 1}`} onClick={() => setDraft({ ...draft, set: draft.set.filter((_, itemIndex) => itemIndex !== index) })} className="px-1 text-muted-foreground hover:text-foreground">×</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between"><span className="text-[10.5px] font-semibold text-foreground">Expected version strings</span><button type="button" onClick={() => setDraft({ ...draft, expect: [...draft.expect, { path: '', pattern: '' }] })} className="text-[10px] text-primary hover:underline">Add expectation</button></div>
            <div className="mt-1 space-y-1.5">
              {draft.expect.map((entry, index) => (
                <div key={index} className="grid grid-cols-[0.8fr_1fr_auto] gap-1.5">
                  <div><input aria-label={`Expect path ${index + 1}`} className={inputClass} value={entry.path} onChange={event => setDraft({ ...draft, expect: draft.expect.map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) })} placeholder="package.json" />{fieldError(`expect.${index}.path`)}</div>
                  <div><input aria-label={`Expect pattern ${index + 1}`} className={inputClass} value={entry.pattern} onChange={event => setDraft({ ...draft, expect: draft.expect.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value } : item) })} placeholder={'"version": "{version}"'} />{fieldError(`expect.${index}.pattern`)}</div>
                  <button type="button" aria-label={`Remove expectation ${index + 1}`} onClick={() => setDraft({ ...draft, expect: draft.expect.filter((_, itemIndex) => itemIndex !== index) })} className="px-1 text-muted-foreground hover:text-foreground">×</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between"><span className="text-[10.5px] font-semibold text-foreground">Repositories to push</span><button type="button" onClick={() => setDraft({ ...draft, push: [...draft.push, ''] })} className="text-[10px] text-primary hover:underline">Add repository</button></div>
            <div className="mt-1 space-y-1.5">
              {draft.push.map((path, index) => (
                <div key={index} className="grid grid-cols-[1fr_auto] gap-1.5">
                  <div><input aria-label={`Push repository ${index + 1}`} className={inputClass} value={path} onChange={event => setDraft({ ...draft, push: draft.push.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} placeholder="frontend" />{fieldError(`push.${index}`)}</div>
                  <button type="button" aria-label={`Remove push repository ${index + 1}`} onClick={() => setDraft({ ...draft, push: draft.push.filter((_, itemIndex) => itemIndex !== index) })} className="px-1 text-muted-foreground hover:text-foreground">×</button>
                </div>
              ))}
            </div>
          </div>

          {fieldError('_form')}
          <div className="flex items-center gap-2">
            <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(compactVersionSyncDraft(draft))} className="rounded bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50">{mutation.isPending ? 'Saving…' : 'Save'}</button>
            <button type="button" disabled={mutation.isPending} onClick={() => { setEditing(false); setFieldErrors({}); }} className="text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      ) : data?.config ? (
        <div className="mt-2 space-y-2">
          <div className="rounded border border-border bg-muted/20 p-2 font-mono text-[10.5px] text-muted-foreground">
            {data.config.command && <div>command: <span className="text-foreground">{data.config.command}</span>{data.config.command_cwd ? ` (cwd ${data.config.command_cwd})` : ''}{data.config.command_image ? ` in ${data.config.command_image}` : ''}</div>}
            {(data.config.set ?? []).map(entry => <div key={`${entry.path}:${entry.json_field}`}>set: <span className="text-foreground">{entry.path} → {entry.json_field}</span></div>)}
            {(data.config.expect ?? []).map(entry => <div key={`${entry.path}:${entry.pattern}`}>expect: <span className="text-foreground">{entry.path} / {entry.pattern}</span></div>)}
            {(data.config.push ?? []).map(path => <div key={path}>push: <span className="text-foreground">{path}</span></div>)}
            {data.config.commit_message && <div>commit: <span className="text-foreground">{data.config.commit_message}</span></div>}
          </div>
          <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(null)} className="text-[11px] text-red-400 hover:underline disabled:opacity-50">Remove version sync</button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-[11px] text-muted-foreground">This project skips ship: no version_sync is declared, so batch promotes will not touch version strings.</p>
          <button type="button" onClick={beginEditing} className="mt-1 text-[11px] font-medium text-primary hover:underline">Configure version sync</button>
        </div>
      )}

      <div className="mt-3 border-t border-border pt-2">
        <div className="mb-1 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">Latest outcome</div>
        <VersionShipOutcomeView outcome={data?.lastOutcome ?? null} />
      </div>
    </section>
  );
}

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
      <VersionShipSettings projectKey={projectKey} />
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
 * PAN-1696 ac3: the expanded panel's merge-train line. The count, batch name,
 * status, and the Awaiting Merge link all live on the COLLAPSED <summary> (see
 * ProjectSettingsSummary) because that is the surface the operator sees without
 * opening anything; this repeats the detail in context and deliberately does NOT
 * duplicate the link.
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
  // ac3 wants the ready count AND the current generation's STATUS legible without
  // opening the disclosure — a batch name alone does not say whether it is ready to
  // test, still assembling, or superseded.
  const trainLabel = trainSection && !trainSection.enabled
    ? 'Train off'
    : `Train ${readyCount} ready${currentBatch ? ` · ${shortName(currentBatch.name)} (${currentBatch.status})` : ' · no batch'}`;

  return (
    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted-foreground)', display: 'inline-flex', gap: 6, minWidth: 0 }} data-testid="project-settings-collapsed-summary">
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {autoMergeLabel} · {swarmLabel} · {trainLabel}
      </span>
      {/* The link lives in the <summary> so it works while collapsed. Clicking
          anything inside a <summary> toggles the disclosure, so stop propagation
          as well as the default navigation. */}
      <a
        href="/awaiting-merge"
        onClick={(event) => { event.stopPropagation(); goToAwaitingMerge(event); }}
        className="shrink-0 font-medium text-primary hover:underline"
      >
        Awaiting Merge →
      </a>
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
