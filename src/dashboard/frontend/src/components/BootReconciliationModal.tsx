import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock3, Pause, Play, Snowflake } from 'lucide-react';
import { useAlert } from './DialogProvider';

export type BootReconciliationDecision = 'pending' | 'resume_all' | 'hold_all' | 'per_agent';
export type BootReconciliationPerAgentAction = 'resume' | 'hold';
export type BootReconciliationConcern = 'running_remote' | 'orphaned' | 'stopped_cleanly' | 'paused_troubled';

export interface BootReconciliationAgent {
  id: string;
  issueId: string;
  role: string;
  model: string | null;
  whyStopped: string;
  concern: BootReconciliationConcern;
  lastActivity: string | null;
  cost: number | null;
  remote: boolean;
  readOnly: boolean;
}

export interface BootReconciliationState {
  decision: BootReconciliationDecision | null;
  perAgent: Record<string, BootReconciliationPerAgentAction>;
  decidedAt: string | null;
  bootId: string | null;
  graceDeadline: string | null;
  set: BootReconciliationAgent[];
}

export const BOOT_RECONCILIATION_QUERY_KEY = ['boot-reconciliation'] as const;

async function fetchBootReconciliation(): Promise<BootReconciliationState> {
  const res = await fetch('/api/boot-reconciliation');
  if (!res.ok) throw new Error(`GET /api/boot-reconciliation -> ${res.status}`);
  return res.json();
}

async function postBootReconciliationDecision(input: {
  decision: Exclude<BootReconciliationDecision, 'pending'>;
  perAgent?: Record<string, BootReconciliationPerAgentAction>;
}): Promise<{ ok: boolean; count: number; resumed: string[]; skipped: Record<string, number>; deferred: number }> {
  const res = await fetch('/api/boot-reconciliation/decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `POST /api/boot-reconciliation/decision -> ${res.status}`);
  }
  return res.json();
}

async function freezeDeacon(): Promise<{ paused: boolean }> {
  const res = await fetch('/api/deacon/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paused: true }),
  });
  if (!res.ok) throw new Error(`POST /api/deacon/pause -> ${res.status}`);
  return res.json();
}

function formatTime(value: string | null): string {
  if (!value) return 'startup';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatRelative(value: string | null): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function useCountdown(deadline: string | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!deadline) return 0;
  const ms = Date.parse(deadline) - now;
  return Math.max(0, Math.ceil(ms / 1000));
}

function concernLabel(concern: BootReconciliationConcern): string {
  switch (concern) {
    case 'running_remote':
      return 'Running remote ($)';
    case 'orphaned':
      return 'Orphaned (tmux gone)';
    case 'paused_troubled':
      return 'Paused / troubled';
    case 'stopped_cleanly':
    default:
      return 'Stopped cleanly';
  }
}

const CONCERN_ORDER: BootReconciliationConcern[] = [
  'running_remote',
  'orphaned',
  'stopped_cleanly',
  'paused_troubled',
];

function formatDecisionSkipSummary(skipped: Record<string, number> = {}, deferred = 0): string {
  const labels: Record<string, string> = {
    workspace_missing: 'workspace missing',
    merged: 'already merged',
    completed: 'completed',
    other: 'not resumable',
  };
  const parts = Object.entries(labels)
    .map(([key, label]) => ({ count: skipped[key] ?? 0, label }))
    .filter((item) => item.count > 0)
    .map((item) => `${item.count} ${item.label}`);
  if (deferred > 0) parts.push(`${deferred} deferred`);
  return parts.join(', ');
}

export function BootReconciliationModal() {
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const [reviewMode, setReviewMode] = useState(false);
  const [perAgent, setPerAgent] = useState<Record<string, BootReconciliationPerAgentAction>>({});

  const { data } = useQuery({
    queryKey: BOOT_RECONCILIATION_QUERY_KEY,
    queryFn: fetchBootReconciliation,
    staleTime: 5_000,
    refetchInterval: (query) => {
      const decision = query.state.data?.decision;
      if (decision === 'pending') return 10_000;
      // Held states keep the banner's count fresh (same cadence as the old NoResumeBanner).
      if (decision === 'hold_all' || decision === 'per_agent') return 30_000;
      return false;
    },
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: BOOT_RECONCILIATION_QUERY_KEY });
    };
    window.addEventListener('overdeck:reconnected', refetch);
    return () => window.removeEventListener('overdeck:reconnected', refetch);
  }, [queryClient]);

  useEffect(() => {
    if (!data) return;
    const agents = Array.isArray(data.set) ? data.set : [];
    const selected = data.perAgent ?? {};
    setPerAgent(Object.fromEntries(
      agents
        .filter((agent) => !agent.readOnly)
        .map((agent) => [agent.issueId, selected[agent.issueId] ?? 'resume']),
    ));
  }, [data]);

  const decisionMutation = useMutation({
    mutationFn: postBootReconciliationDecision,
    onSuccess: ({ count, skipped, deferred }) => {
      void queryClient.invalidateQueries({ queryKey: BOOT_RECONCILIATION_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      const skipSummary = formatDecisionSkipSummary(skipped, deferred);
      const message = count > 0
        ? `Boot decision saved. Resuming ${count} agent${count === 1 ? '' : 's'}.${skipSummary ? ` Also skipped ${skipSummary}.` : ''}`
        : `Boot decision saved. No agents resumed${skipSummary ? ` — ${skipSummary}` : ''}.`;
      showAlert({
        message,
        variant: 'success',
      });
    },
    onError: (error: Error) => {
      showAlert({ message: `Boot reconciliation failed: ${error.message}`, variant: 'error' });
    },
  });

  const freezeMutation = useMutation({
    mutationFn: freezeDeacon,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deacon', 'pause'] });
      decisionMutation.mutate({ decision: 'hold_all' });
    },
    onError: (error: Error) => {
      showAlert({ message: `Freeze failed: ${error.message}`, variant: 'error' });
    },
  });

  const grouped = useMemo(() => {
    const groups = new Map<BootReconciliationConcern, BootReconciliationAgent[]>();
    for (const concern of CONCERN_ORDER) groups.set(concern, []);
    const agents = Array.isArray(data?.set) ? data.set : [];
    for (const agent of agents) {
      groups.get(agent.concern)?.push(agent);
    }
    return groups;
  }, [data?.set]);

  const secondsLeft = useCountdown(data?.graceDeadline ?? null);

  // PAN-2278: a hold_all / per_agent decision must stay visible — the boot
  // choice silently parks agents otherwise (the affordance NoResumeBanner used
  // to provide before PAN-2076 replaced it with this modal).
  if (data && (data.decision === 'hold_all' || data.decision === 'per_agent')) {
    const perAgentChoices = data.perAgent ?? {};
    const heldAgents = (Array.isArray(data.set) ? data.set : []).filter((agent) =>
      !agent.readOnly && (data.decision !== 'per_agent' || perAgentChoices[agent.issueId] !== 'resume'));
    if (heldAgents.length === 0) return null;
    const bannerPending = decisionMutation.isPending;
    return (
      <div
        className="sticky top-0 z-40 bg-orange-950/70 border-b-2 border-orange-400/70 px-4 py-2 flex items-center gap-3 shrink-0"
        data-testid="boot-reconciliation-held-banner"
      >
        <Pause className="w-5 h-5 text-orange-300 shrink-0" />
        <p className="text-orange-100 text-sm font-medium flex-1">
          Boot reconciliation is holding {heldAgents.length} stopped agent{heldAgents.length === 1 ? '' : 's'} from
          the boot at {formatTime(data.decidedAt ?? data.graceDeadline)}. Held agents will not pick up work until
          resumed. Click <span className="font-semibold">Resume all</span> to put them back to work, or use{' '}
          <code className="font-mono text-xs bg-orange-500/20 px-1 rounded">pan start &lt;id&gt;</code>{' '}
          to spawn one individually.
        </p>
        <button
          type="button"
          onClick={() => decisionMutation.mutate({ decision: 'resume_all' })}
          disabled={bannerPending}
          data-testid="boot-reconciliation-held-resume-all"
          className="shrink-0 inline-flex items-center gap-1.5 h-[32px] rounded-[var(--radius-sm)] bg-orange-400 px-[14px] text-[12px] font-medium text-orange-950 transition-opacity hover:bg-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {bannerPending ? 'Resuming…' : 'Resume all'}
        </button>
      </div>
    );
  }

  if (data?.decision !== 'pending') return null;

  const agentSet = Array.isArray(data.set) ? data.set : [];
  const resumableCount = agentSet.filter((agent) => !agent.readOnly).length;
  const pending = decisionMutation.isPending || freezeMutation.isPending;

  const submitReview = () => {
    decisionMutation.mutate({ decision: 'per_agent', perAgent });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-8 backdrop-blur-sm">
      <section
        className="w-full max-w-5xl rounded-lg border border-orange-300/40 bg-neutral-950 text-neutral-100 shadow-2xl"
        data-testid="boot-reconciliation-modal"
        aria-label="Boot reconciliation"
      >
        <div className="border-b border-orange-300/20 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-orange-300">
                <AlertTriangle className="h-4 w-4" />
                Unverified dashboard boot
              </div>
              <h2 className="mt-1 text-xl font-semibold text-neutral-50">Boot Reconciliation</h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-300">
                Agents are held from the boot at {formatTime(data.decidedAt ?? data.graceDeadline)}.
                Resume all now, keep them stopped, or choose per agent. The server timer is
                authoritative; no agent resumes before this boot decision is applied.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-md border border-orange-300/25 bg-orange-400/10 px-3 py-2">
              <div className="grid h-12 w-12 place-items-center rounded-full border-4 border-orange-400/70 text-sm font-semibold text-orange-100">
                {secondsLeft}
              </div>
              <div className="text-sm">
                <div className="font-semibold text-orange-100">Auto-resuming all in 0:{String(secondsLeft).padStart(2, '0')}</div>
                <div className="text-xs text-orange-100/70">Concurrency brakes cap the rate.</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-4">
          {CONCERN_ORDER.map((concern) => {
            const agents = grouped.get(concern) ?? [];
            if (agents.length === 0) return null;
            return (
              <div key={concern} className="rounded-md border border-border/70 bg-background/60">
                <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
                  <h3 className="text-sm font-semibold text-neutral-100">{concernLabel(concern)}</h3>
                  <span className="text-xs text-muted-foreground">{agents.length}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {agents.map((agent) => {
                    const disposition = perAgent[agent.issueId] ?? 'resume';
                    return (
                      <div
                        key={agent.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
                        data-testid={`boot-reconciliation-row-${agent.issueId}`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-neutral-50">{agent.issueId}</span>
                            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300">{agent.role}</span>
                            {agent.remote && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-200">remote</span>}
                            {agent.readOnly && <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-[11px] text-zinc-200">read-only</span>}
                          </div>
                          <div className="mt-1 text-xs text-neutral-400">
                            {agent.model ?? 'unknown model'} - {agent.whyStopped} - last activity {formatRelative(agent.lastActivity)}
                            {agent.cost != null ? ` - $${agent.cost.toFixed(2)}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {reviewMode && !agent.readOnly ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setPerAgent((prev) => ({ ...prev, [agent.issueId]: 'resume' }))}
                                data-testid={`boot-reconciliation-resume-${agent.issueId}`}
                                className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium ${disposition === 'resume' ? 'bg-emerald-500 text-emerald-950' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                              >
                                <Play className="h-3.5 w-3.5" />
                                Resume
                              </button>
                              <button
                                type="button"
                                onClick={() => setPerAgent((prev) => ({ ...prev, [agent.issueId]: 'hold' }))}
                                data-testid={`boot-reconciliation-hold-${agent.issueId}`}
                                className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium ${disposition === 'hold' ? 'bg-sky-500 text-sky-950' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                              >
                                <Pause className="h-3.5 w-3.5" />
                                Keep
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-neutral-500">{agent.readOnly ? 'Not resumable here' : 'Resume candidate'}</span>
                          )}
                          <button
                            type="button"
                            disabled
                            title="Kill actions are supplied by the remote inventory contract."
                            className="inline-flex h-8 items-center rounded-md border border-neutral-700 px-2 text-xs text-neutral-500"
                          >
                            Kill
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/70 px-5 py-4">
          {reviewMode ? (
            <>
              <button
                type="button"
                onClick={submitReview}
                disabled={pending}
                data-testid="boot-reconciliation-apply-per-agent"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                Apply per-agent choices
              </button>
              <span className="text-xs text-muted-foreground">
                Resuming {Object.values(perAgent).filter((value) => value === 'resume').length} of {resumableCount}; read-only rows stay stopped.
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => decisionMutation.mutate({ decision: 'resume_all' })}
                disabled={pending}
                data-testid="boot-reconciliation-resume-all"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-orange-400 px-3 text-sm font-semibold text-orange-950 hover:bg-orange-300 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                Resume all now
              </button>
              <button
                type="button"
                onClick={() => decisionMutation.mutate({ decision: 'hold_all' })}
                disabled={pending}
                data-testid="boot-reconciliation-hold-all"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-neutral-800 px-3 text-sm font-medium text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
              >
                <Pause className="h-4 w-4" />
                Keep all stopped
              </button>
              <button
                type="button"
                onClick={() => setReviewMode(true)}
                disabled={pending}
                data-testid="boot-reconciliation-review-each"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 px-3 text-sm font-medium text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
              >
                <Clock3 className="h-4 w-4" />
                Review each
              </button>
              <button
                type="button"
                onClick={() => freezeMutation.mutate()}
                disabled={pending}
                data-testid="boot-reconciliation-freeze"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-red-500 px-3 text-sm font-semibold text-red-950 hover:bg-red-400 disabled:opacity-50"
              >
                <Snowflake className="h-4 w-4" />
                Freeze everything
              </button>
            </>
          )}
          <div className="ml-auto max-w-xl text-xs text-muted-foreground">
            Freeze uses the existing persisted Deacon pause surface. The boot choice is saved
            durably, so a watchdog restart does not re-prompt this boot.
          </div>
        </div>
      </section>
    </div>
  );
}
