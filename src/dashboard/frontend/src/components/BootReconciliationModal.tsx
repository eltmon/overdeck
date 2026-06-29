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
}): Promise<{ ok: boolean; count: number; resumed: string[] }> {
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

export function BootReconciliationModal() {
  const queryClient = useQueryClient();
  const showAlert = useAlert();
  const [reviewMode, setReviewMode] = useState(false);
  const [perAgent, setPerAgent] = useState<Record<string, BootReconciliationPerAgentAction>>({});

  const { data } = useQuery({
    queryKey: BOOT_RECONCILIATION_QUERY_KEY,
    queryFn: fetchBootReconciliation,
    staleTime: 5_000,
    refetchInterval: (query) => query.state.data?.decision === 'pending' ? 10_000 : false,
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
    onSuccess: ({ count }) => {
      void queryClient.invalidateQueries({ queryKey: BOOT_RECONCILIATION_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
      showAlert({
        message: count > 0
          ? `Boot decision saved. Resuming ${count} agent${count === 1 ? '' : 's'}.`
          : 'Boot decision saved. No agents were resumed.',
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
        className="w-full max-w-5xl rounded-lg border badge-border-warning bg-card text-foreground shadow-2xl"
        data-testid="boot-reconciliation-modal"
        aria-label="Boot reconciliation"
      >
        <div className="border-b badge-border-warning px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-warning">
                <AlertTriangle className="h-4 w-4" />
                Unverified dashboard boot
              </div>
              <h2 className="mt-1 text-xl font-semibold text-foreground">Boot Reconciliation</h2>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Agents are held from the boot at {formatTime(data.decidedAt ?? data.graceDeadline)}.
                Resume all now, keep them stopped, or choose per agent. The server timer is
                authoritative; no agent resumes before this boot decision is applied.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-md border badge-border-warning badge-bg-warning px-3 py-2">
              <div className="grid h-12 w-12 place-items-center rounded-full border-4 border-warning/70 text-sm font-semibold text-warning-foreground">
                {secondsLeft}
              </div>
              <div className="text-sm">
                <div className="font-semibold text-warning-foreground">Auto-resuming all in 0:{String(secondsLeft).padStart(2, '0')}</div>
                <div className="text-xs text-warning-foreground/70">Concurrency brakes cap the rate.</div>
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
                  <h3 className="text-sm font-semibold text-foreground">{concernLabel(concern)}</h3>
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
                            <span className="font-mono text-sm font-semibold text-foreground">{agent.issueId}</span>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{agent.role}</span>
                            {agent.remote && <span className="rounded border badge-border-success badge-bg-success px-1.5 py-0.5 text-[11px] text-success-foreground">remote</span>}
                            {agent.readOnly && <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">read-only</span>}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
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
                                className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium ${disposition === 'resume' ? 'bg-success text-success-foreground hover:bg-success/90' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                              >
                                <Play className="h-3.5 w-3.5" />
                                Resume
                              </button>
                              <button
                                type="button"
                                onClick={() => setPerAgent((prev) => ({ ...prev, [agent.issueId]: 'hold' }))}
                                data-testid={`boot-reconciliation-hold-${agent.issueId}`}
                                className={`inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium ${disposition === 'hold' ? 'bg-warning text-warning-foreground hover:bg-warning/90' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                              >
                                <Pause className="h-3.5 w-3.5" />
                                Keep
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">{agent.readOnly ? 'Not resumable here' : 'Resume candidate'}</span>
                          )}
                          <button
                            type="button"
                            disabled
                            title="Kill actions are supplied by the remote inventory contract."
                            className="inline-flex h-8 items-center rounded-md border border-border px-2 text-xs text-muted-foreground"
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
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-success px-3 text-sm font-semibold text-success-foreground hover:bg-success/90 disabled:opacity-50"
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
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-warning px-3 text-sm font-semibold text-warning-foreground hover:bg-warning/90 disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                Resume all now
              </button>
              <button
                type="button"
                onClick={() => decisionMutation.mutate({ decision: 'hold_all' })}
                disabled={pending}
                data-testid="boot-reconciliation-hold-all"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-muted px-3 text-sm font-medium text-foreground hover:bg-muted/80 disabled:opacity-50"
              >
                <Pause className="h-4 w-4" />
                Keep all stopped
              </button>
              <button
                type="button"
                onClick={() => setReviewMode(true)}
                disabled={pending}
                data-testid="boot-reconciliation-review-each"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                <Clock3 className="h-4 w-4" />
                Review each
              </button>
              <button
                type="button"
                onClick={() => freezeMutation.mutate()}
                disabled={pending}
                data-testid="boot-reconciliation-freeze"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-3 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
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
