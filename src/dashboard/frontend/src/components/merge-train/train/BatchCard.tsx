/**
 * One batch (= generation) of a project's merge train (PAN-4753 WI-10),
 * carried over from the pre-PAN-4753 batch card and extended:
 *
 * - every status renders, with a badge (ready to test, assembling,
 *   superseded, voided, merged) and, for superseded and voided batches, the
 *   stored status reason (WI-3);
 * - **Merge batch (N) to main** asks inline ("Lands exactly the tree you
 *   tested."), with the version field when version sync is configured;
 * - WI-9: when promote answers `stack-unhealthy`, the card shows the message
 *   and a "Merge anyway…" form that requires a reason and re-posts with
 *   `overrideStackHealth`;
 * - each member chip of a `ready` or `assembling` batch opens a menu with
 *   **Merge alone…**, which confirms that it voids this batch (R3, D2) and
 *   posts `merge-next` for that member.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '../../DialogProvider';
import { MergeTrainRequestError, generationParam, postJson } from '../mergeTrainApi';
import { promoteFailureCopy } from '../mergeTrainCopy';
import type { UatGenerationPayload } from './boardTypes';
import { Pill, TONE_CLASS, type Tone } from './CarStatusPill';
import {
  MERGE_ALONE_LABEL,
  MERGE_BATCH_CONFIRM_NOTE,
  NO_UAT_STEPS_LINE,
  OPEN_UAT_LABEL,
  PLAN_NOT_FOUND_LINE,
  REBUILD_LABEL,
  SHIP_VERSION_LABEL,
  STACK_OVERRIDE_REASON_LABEL,
  STACK_OVERRIDE_REASON_REQUIRED,
  STACK_OVERRIDE_SUBMIT,
  STACK_UNHEALTHY_MERGE_ANYWAY,
  START_UAT_LABEL,
  batchStatusText,
  builtAgo,
  mergeAloneConfirm,
  mergeBatchLabel,
  resolvedLine,
  shortName,
  whatToUatLabel,
} from './trainCopy';
import { useInvalidateBoard, useNow } from './useMergeTrainBoard';

/** Statuses `POST …/promote` accepts (`PROMOTABLE`, uat-promote.ts). */
export function isPromotable(status: UatGenerationPayload['status']): boolean {
  return status === 'ready' || status === 'superseded';
}

export function batchTone(gen: Pick<UatGenerationPayload, 'status' | 'shipStatus'>): Tone {
  switch (gen.status) {
    case 'ready': return 'warning';
    case 'assembling': return 'info';
    case 'promoted': return gen.shipStatus?.status === 'passed' ? 'success' : 'warning';
    case 'failed': return 'destructive';
    default: return 'muted';
  }
}

const BUTTON = 'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:brightness-110 disabled:opacity-50';

type PromoteBody = { shipVersion?: string; overrideStackHealth?: true; overrideReason?: string };
type MergeNextResult = { outcomes?: Array<{ issueId: string; result: string; reason?: string }> };

export interface BatchCardProps {
  gen: UatGenerationPayload;
  projectKey: string;
  projectName: string;
  /** The hero batch opens "What to UAT" by default and gets the accent border. */
  hero?: boolean;
  /** False hides Merge alone: merge-next refuses while the train is off. Defaults to true. */
  mergeEnabled?: boolean;
  onNavigateIssue?: (issueId: string) => void;
}

export function BatchCard({ gen, projectKey, projectName, hero = false, mergeEnabled = true, onNavigateIssue }: BatchCardProps) {
  const confirm = useConfirm();
  const invalidate = useInvalidateBoard();
  const now = useNow(60_000);
  const [uatOpen, setUatOpen] = useState(hero && gen.status === 'ready');
  const [confirming, setConfirming] = useState(false);
  const [version, setVersion] = useState('');
  const [versionError, setVersionError] = useState<string | null>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [unhealthy, setUnhealthy] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const name = shortName(gen.name);

  const promote = useMutation({
    mutationFn: (body: PromoteBody) =>
      postJson<{ mergeSha?: string; members?: string[] }>(`/api/merge-train/generations/${generationParam(gen.name)}/promote`, body),
    onSuccess: (data) => {
      setConfirming(false);
      setUnhealthy(null);
      setOverrideOpen(false);
      const members = data.members ?? gen.members.map((m) => m.issueId);
      toast.success(`Merged ${members.length} feature${members.length === 1 ? '' : 's'} to main (${members.join(', ')})`);
      invalidate();
    },
    onError: (err) => {
      if (err instanceof MergeTrainRequestError && err.reason === 'stack-unhealthy') {
        setUnhealthy(err.message);
        return;
      }
      const copy = promoteFailureCopy(name, {
        message: err instanceof Error ? err.message : undefined,
        reason: err instanceof MergeTrainRequestError ? err.reason : undefined,
      });
      toast.error(copy.message, { duration: 10_000 });
      invalidate();
    },
  });

  const stack = useMutation({
    mutationFn: () => postJson<{ frontendUrl: string; evicted: string[] }>(`/api/merge-train/generations/${generationParam(gen.name)}/stack`),
    onSuccess: (data) => {
      if (data.evicted?.length > 0) toast.info(`Stopped older UAT stack ${data.evicted.map(shortName).join(', ')} (max 2 run at once)`);
      window.open(data.frontendUrl, '_blank', 'noopener,noreferrer');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not start the UAT stack'),
  });

  const ship = useMutation({
    mutationFn: (v: string) =>
      postJson<{ status: 'passed' | 'partial' | 'failed'; error?: string }>(`/api/merge-train/generations/${generationParam(gen.name)}/ship`, { version: v }),
    onSuccess: (data) => {
      setShipOpen(false);
      if (data.status === 'passed') toast.success('Version strings shipped');
      else toast.warning(data.error ?? `Version ship finished with status ${data.status}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Version ship failed'),
  });

  const rebuild = useMutation({
    mutationFn: () => postJson<{ projects?: Array<{ result?: { action: string }; error?: string }> }>('/api/merge-train/assemble', { project: projectKey }),
    onSuccess: (data) => {
      const action = data.projects?.[0]?.result?.action;
      if (action === 'assembled') toast.success('Rebuilt the batch');
      else toast.info(`Rebuild: ${action ?? data.projects?.[0]?.error ?? 'no change'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Rebuild failed'),
  });

  const mergeAlone = useMutation({
    mutationFn: (issueId: string) => postJson<MergeNextResult>('/api/merge-train/merge-next', { n: 1, project: projectKey, issueId }),
    onSuccess: (data, issueId) => {
      const first = data.outcomes?.[0];
      if (first?.result === 'merged') toast.success(`Merged ${first.issueId} to main`);
      else toast.warning(`${first?.issueId ?? issueId} did not merge: ${first?.reason ?? 'unknown'}`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Merge failed'),
  });

  const validVersion = (v: string) => /^\d+\.\d+\.\d+$/.test(v);

  const submitPromote = (override?: { reason: string }) => {
    const v = version.trim();
    if (v !== '' && !validVersion(v)) {
      setVersionError('version must look like 48.8.0');
      return;
    }
    promote.mutate({
      ...(v ? { shipVersion: v } : {}),
      ...(override ? { overrideStackHealth: true as const, overrideReason: override.reason } : {}),
    });
  };

  const submitOverride = () => {
    const reason = overrideReason.trim();
    if (!reason) {
      setOverrideError(STACK_OVERRIDE_REASON_REQUIRED);
      return;
    }
    submitPromote({ reason });
  };

  const onStack = async () => {
    const ok = await confirm({
      title: `Start a live UAT stack for ${name}?`,
      message: `Builds and runs a stack serving this exact batch (${gen.members.map((m) => m.issueId).join(', ')}), about a minute, then opens it.\n\nAt most two UAT stacks run at once, so starting this one may stop the oldest running stack.`,
      confirmLabel: START_UAT_LABEL,
    });
    if (ok) stack.mutate();
  };

  const onRebuild = async () => {
    const ok = await confirm({
      title: `Rebuild ${name} from current main?`,
      message: `Discards this batch and re-merges ${projectName}'s ready features onto a fresh branch off current main. Any UAT you already did against ${name} no longer applies.`,
      confirmLabel: 'Rebuild batch',
    });
    if (ok) rebuild.mutate();
  };

  const onShip = async () => {
    const v = version.trim();
    if (!validVersion(v)) {
      setVersionError('version must look like 48.8.0');
      return;
    }
    const ok = await confirm({
      title: `Ship version ${v} for ${name}?`,
      message: `Runs this project's configured version-string propagation for ${v}, verifies every declared target, commits only declared paths, and pushes the configured repositories. This does not publish packages, deploy, tag, or submit an app store build.`,
      confirmLabel: `Ship version ${v}`,
    });
    if (ok) ship.mutate(v);
  };

  const onMergeAlone = async (issueId: string) => {
    setMenuFor(null);
    if (await confirm(mergeAloneConfirm(issueId, gen.name))) mergeAlone.mutate(issueId);
  };

  // The member menu opens only when it has an item: Merge alone (train on) or Open issue.
  const live = (gen.status === 'ready' || gen.status === 'assembling') && (mergeEnabled || !!onNavigateIssue);
  const promotable = isPromotable(gen.status);
  const reasonShown = gen.statusReason && (gen.status === 'superseded' || gen.status === 'invalidated');
  const shipPending = gen.status === 'promoted' && gen.versionSyncConfigured === true && gen.shipStatus?.status !== 'passed';
  const built = builtAgo(gen.createdAt, now);
  const repos = gen.repos ?? [];
  const baseLine = repos.length > 1
    ? repos.map((r) => `${r.repoKey}@${r.baseSha.slice(0, 7)}`).join(' · ')
    : gen.baseSha.slice(0, 7);
  const stackLine = gen.stack.status === 'running'
    ? 'UAT stack running'
    : gen.stack.status === 'degraded'
      ? `UAT stack degraded: ${(gen.stack.downServices ?? []).join(', ') || 'a declared service'} not serving`
      : gen.stack.status === 'unknown' ? 'UAT stack state unknown' : null;
  const border = hero && gen.status === 'ready' ? 'badge-border-warning' : 'border-border';

  return (
    <div data-testid={`batch-card-${name}`} data-status={gen.status} className={`space-y-2 rounded-md border bg-card p-3 ${border}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-foreground">{name}</span>
        <Pill tone={batchTone(gen)} spin={gen.status === 'assembling'} testId={`batch-status-${name}`}>{batchStatusText(gen)}</Pill>
        {built && <span className="ml-auto text-[11px] text-muted-foreground">{built}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">
        base <span className="font-mono">{baseLine}</span>
        {stackLine && <span> · {stackLine}</span>}
      </div>
      {reasonShown && (
        <p className="text-[11px] leading-snug text-warning-foreground" data-testid={`batch-reason-${name}`}>{gen.statusReason}</p>
      )}
      {gen.members.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {gen.members.map((m) => (
            <span key={m.issueId} className="relative">
              <button
                type="button"
                onClick={() => (live ? setMenuFor((v) => (v === m.issueId ? null : m.issueId)) : onNavigateIssue?.(m.issueId))}
                aria-haspopup={live ? 'menu' : undefined}
                aria-expanded={live ? menuFor === m.issueId : undefined}
                title={m.title}
                data-testid={`batch-member-${m.issueId}`}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-accent"
              >
                {m.issueId}
              </button>
              {live && menuFor === m.issueId && (
                <span role="menu" className="absolute left-0 top-full z-10 mt-1 flex min-w-[9rem] flex-col rounded-md border border-border bg-popover p-1 shadow-floating">
                  {onNavigateIssue && (
                    <button type="button" role="menuitem" onClick={() => { setMenuFor(null); onNavigateIssue(m.issueId); }} className="rounded px-2 py-1 text-left text-[11px] text-foreground hover:bg-accent">
                      Open issue
                    </button>
                  )}
                  {mergeEnabled && (
                    <button
                      type="button"
                      role="menuitem"
                      disabled={mergeAlone.isPending}
                      onClick={() => void onMergeAlone(m.issueId)}
                      className="rounded px-2 py-1 text-left text-[11px] text-foreground hover:bg-accent disabled:opacity-50"
                    >
                      {MERGE_ALONE_LABEL}
                    </button>
                  )}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      {gen.heldOut.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {gen.heldOut.map((h) => (
            <span key={h.issueId} className={`rounded-md border px-1.5 py-0.5 text-[11px] ${TONE_CLASS.muted}`} data-testid={`batch-held-${h.issueId}`}>
              <span className="font-mono">{h.issueId}</span> held out · {h.reason}
            </span>
          ))}
        </div>
      )}
      {gen.resolutions.length > 0 && (
        <p className="break-words text-[11px] leading-snug text-muted-foreground">{resolvedLine(gen.resolutions)}</p>
      )}

      {(promotable || gen.status === 'ready' || shipPending) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {promotable && <StackButton gen={gen} pending={stack.isPending} onStart={() => void onStack()} />}
          {promotable && (
            <button type="button" className={PRIMARY} disabled={promote.isPending} onClick={() => setConfirming(true)} data-testid={`batch-merge-${name}`}>
              {promote.isPending ? 'Merging…' : mergeBatchLabel(gen.members.length)}
            </button>
          )}
          {gen.status === 'ready' && (
            <button type="button" className={BUTTON} disabled={rebuild.isPending} onClick={() => void onRebuild()}>
              {rebuild.isPending ? 'Rebuilding…' : REBUILD_LABEL}
            </button>
          )}
          {shipPending && (
            <button type="button" className={BUTTON} disabled={ship.isPending} onClick={() => setShipOpen(true)}>
              {ship.isPending ? 'Shipping…' : SHIP_VERSION_LABEL}
            </button>
          )}
        </div>
      )}

      {confirming && promotable && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted px-3 py-2 text-[11px]" data-testid={`batch-merge-confirm-${name}`}>
          <p className="text-foreground">
            {MERGE_BATCH_CONFIRM_NOTE} One merge to main containing {gen.members.map((m) => m.issueId).join(', ')}.
          </p>
          {gen.versionSyncConfigured && (
            <VersionField name={name} value={version} error={versionError} onChange={(v) => { setVersion(v); setVersionError(null); }} />
          )}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={PRIMARY} disabled={promote.isPending} onClick={() => submitPromote()} data-testid={`batch-merge-confirm-submit-${name}`}>
              {promote.isPending ? 'Merging…' : mergeBatchLabel(gen.members.length)}
            </button>
            <button type="button" className={BUTTON} onClick={() => { setConfirming(false); setUnhealthy(null); setOverrideOpen(false); }}>Cancel</button>
          </div>
          {unhealthy && (
            <div className="space-y-1.5 border-t border-border pt-1.5" data-testid={`batch-stack-unhealthy-${name}`}>
              <p className="text-warning-foreground">{unhealthy}</p>
              {!overrideOpen ? (
                <button type="button" className={BUTTON} onClick={() => setOverrideOpen(true)}>{STACK_UNHEALTHY_MERGE_ANYWAY}</button>
              ) : (
                <div className="space-y-1">
                  <label className="block text-foreground" htmlFor={`override-${name}`}>{STACK_OVERRIDE_REASON_LABEL}</label>
                  <textarea
                    id={`override-${name}`}
                    value={overrideReason}
                    onChange={(e) => { setOverrideReason(e.target.value); setOverrideError(null); }}
                    rows={2}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary"
                  />
                  {overrideError && <p className="text-destructive-foreground">{overrideError}</p>}
                  <button type="button" className={BUTTON} disabled={promote.isPending} onClick={submitOverride}>{STACK_OVERRIDE_SUBMIT}</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {shipOpen && shipPending && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted px-3 py-2 text-[11px]">
          <VersionField name={name} value={version} error={versionError} onChange={(v) => { setVersion(v); setVersionError(null); }} />
          <div className="flex gap-1.5">
            <button type="button" className={BUTTON} disabled={ship.isPending} onClick={() => void onShip()}>Continue to ship</button>
            <button type="button" className={BUTTON} onClick={() => setShipOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      {gen.members.length > 0 && gen.status !== 'invalidated' && gen.status !== 'failed' && (
        <div>
          <button
            type="button"
            aria-expanded={uatOpen}
            onClick={() => setUatOpen((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {uatOpen ? '▾' : '▸'} {whatToUatLabel(gen.members.length)}
          </button>
          {uatOpen && (
            <div className="mt-1.5 space-y-2 rounded-md border border-border p-2.5" data-testid={`batch-uat-${name}`}>
              {gen.members.map((member) => {
                const touchpoint = gen.resolutions.find((r) => r.issueIds[0] === member.issueId);
                return (
                  <div key={member.issueId} className="space-y-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{member.issueId}</span>
                      <span className="min-w-0 truncate text-[12px] font-medium text-foreground">{member.title}</span>
                    </div>
                    <ul className="space-y-0.5 pl-1">
                      {member.planResolved === false ? (
                        <li className="text-[11px] text-warning-foreground">{PLAN_NOT_FOUND_LINE}</li>
                      ) : member.acceptanceCriteria.length === 0 ? (
                        <li className="text-[11px] text-muted-foreground">{NO_UAT_STEPS_LINE}</li>
                      ) : (
                        member.acceptanceCriteria.map((ac, i) => (
                          <li key={i} className={`flex gap-1.5 text-[11px] leading-snug ${ac.status === 'completed' || ac.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                            <span className="text-muted-foreground">{ac.status === 'completed' || ac.status === 'done' ? '☑' : '☐'}</span>
                            <span>{ac.title}</span>
                          </li>
                        ))
                      )}
                      {touchpoint && (
                        <li className="flex gap-1.5 text-[11px] leading-snug text-warning-foreground">
                          <span>☐</span>
                          <span>
                            Conflict with {touchpoint.issueIds.filter((id) => id !== member.issueId).join(', ')} was resolved in this batch
                            ({touchpoint.files.join(', ')}). Check both features still behave at that touchpoint.
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VersionField({ name, value, error, onChange }: { name: string; value: string; error: string | null; onChange: (v: string) => void }) {
  return (
    <div className="space-y-0.5">
      <label className="block text-foreground" htmlFor={`version-${name}`}>Version (X.Y.Z)</label>
      <input
        id={`version-${name}`}
        aria-label={`Version for ${name}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="48.8.0"
        className="w-28 rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
      />
      {error
        ? <p className="text-destructive-foreground">{error}</p>
        : value.trim() === '' && (
          <p className="text-muted-foreground">No version: the batch merges without a version bump.</p>
        )}
    </div>
  );
}

/** Open the running UAT stack, restart a degraded one, or start one. */
function StackButton({ gen, pending, onStart }: { gen: UatGenerationPayload; pending: boolean; onStart: () => void }) {
  if (gen.stack.status === 'running') {
    return (
      <a href={gen.stack.frontendUrl} target="_blank" rel="noreferrer" className={BUTTON}>
        ▶ {OPEN_UAT_LABEL}
      </a>
    );
  }
  if (gen.stack.status === 'degraded' || gen.stack.status === 'unknown') {
    const unknown = gen.stack.status === 'unknown';
    const detail = Object.entries(gen.stack.serviceErrors ?? {}).map(([s, line]) => `${s}: ${line}`).join('\n');
    return (
      <button
        type="button"
        disabled={pending}
        onClick={onStart}
        title={unknown ? `Could not probe the stack: ${gen.stack.probeError ?? 'unknown error'}` : detail || 'Restart the stack'}
        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60 ${TONE_CLASS.warning}`}
      >
        {pending ? <><Loader2 className="h-3 w-3 animate-spin" /> Restarting…</> : unknown ? '⚠ Stack state unknown' : '⚠ Restart UAT stack'}
      </button>
    );
  }
  return (
    <button type="button" disabled={pending} onClick={onStart} className={BUTTON} title="Starts a live stack serving this exact batch (about a minute), then opens it">
      {pending ? <><Loader2 className="h-3 w-3 animate-spin" /> Starting…</> : <>▶ {START_UAT_LABEL}</>}
    </button>
  );
}
