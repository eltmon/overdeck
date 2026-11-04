/**
 * The cockpit Decisions tab for a Deft issue (PAN-4849 WI-7, FR-14, FR-16):
 * Deft's escalations (resolvable here), its decision records, and its policy.
 */
import { useState } from 'react';
import type { DeftEscalation } from '@overdeck/contracts';
import { toast } from 'sonner';
import { CockpitCard, CockpitPill } from '../Stage/cockpit/CockpitCard';
import { DeftPolicyPanel } from './DeftPolicyPanel';
import { type ResolveEscalationInput, useDeftIssueState, useResolveEscalation } from './queries';

const DECISIONS: ResolveEscalationInput['decision'][] = ['approved', 'denied', 'answered', 'dismissed'];

/** `2026-11-02 13:00Z`: stable across locales. */
export function formatDeftTime(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

function ResolveControl({ issueId, escalation }: { issueId: string; escalation: DeftEscalation }) {
  const decides = escalation.type === 'cmd_approval' || escalation.type === 'approval';
  const [decision, setDecision] = useState<ResolveEscalationInput['decision']>(decides ? 'approved' : 'answered');
  const [answer, setAnswer] = useState('');
  const resolve = useResolveEscalation(issueId);
  const submit = () => {
    const trimmed = answer.trim();
    resolve.mutate(
      { escId: escalation.id, decision, ...(trimmed ? { answer: trimmed } : {}) },
      { onError: (error) => toast.error(`Could not resolve ${escalation.id}: ${(error as Error).message}`) },
    );
  };
  return (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      <select
        aria-label={`Decision for ${escalation.id}`}
        value={decision}
        onChange={(event) => setDecision(event.target.value as ResolveEscalationInput['decision'])}
        className="rounded border border-border bg-background px-2 py-1 text-[12px]"
      >
        {DECISIONS.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <textarea
        aria-label={`Answer for ${escalation.id}`}
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        rows={1}
        className="min-w-[12rem] flex-1 rounded border border-border bg-background px-2 py-1 text-[12px]"
      />
      <button
        type="button"
        onClick={submit}
        disabled={resolve.isPending}
        className="rounded border border-border px-3 py-1 text-[12px] font-medium hover:bg-muted"
      >
        Resolve
      </button>
    </div>
  );
}

function EscalationRow({ issueId, escalation }: { issueId: string; escalation: DeftEscalation }) {
  return (
    <li data-testid={`deft-escalation-${escalation.id}`} className="border-b border-border py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <CockpitPill tone="muted">{escalation.type}</CockpitPill>
        <span className="text-[13px] font-medium text-foreground">{escalation.title}</span>
        {escalation.dangerous ? <CockpitPill tone="muted">dangerous</CockpitPill> : null}
        {escalation.overdue ? <CockpitPill tone="muted">overdue</CockpitPill> : null}
      </div>
      {escalation.body ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] text-muted-foreground">{escalation.body}</p> : null}
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        SLA {escalation.slaHours}h · due {formatDeftTime(escalation.dueAt)}
      </p>
      {escalation.status === 'open'
        ? <ResolveControl issueId={issueId} escalation={escalation} />
        : (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {escalation.resolution?.decision ?? 'resolved'} by {escalation.resolution?.resolvedBy ?? 'unknown'}
          </p>
        )}
    </li>
  );
}

export function DeftDecisionsTab({ issueId }: { issueId: string }) {
  const { data: state, isLoading, error } = useDeftIssueState(issueId);
  if (isLoading) return <p className="text-[12px] text-muted-foreground">Loading Deft state…</p>;
  if (error || !state) return <p className="text-[12px] text-muted-foreground">Deft state is not available.</p>;
  const escalations = [...state.escalations.filter((e) => e.status === 'open'), ...state.escalations.filter((e) => e.status !== 'open')];
  return (
    <div data-section="Deft decisions" className="space-y-3.5">
      <CockpitCard tone="muted" title="Escalations">
        {escalations.length === 0
          ? <p className="text-[12px] text-muted-foreground">No Deft escalations.</p>
          : <ul>{escalations.map((escalation) => <EscalationRow key={escalation.id} issueId={issueId} escalation={escalation} />)}</ul>}
      </CockpitCard>
      <CockpitCard tone="muted" title="Decision records">
        {state.decisions.length === 0
          ? <p className="text-[12px] text-muted-foreground">No Deft decision records.</p>
          : (
            <ul className="space-y-2">
              {state.decisions.map((record) => (
                <li key={record.id} className="text-[12px]">
                  <p className="font-medium text-foreground">{record.decision}</p>
                  <p className="text-muted-foreground">{record.whyWinner}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{record.confidence} · {formatDeftTime(record.timestamp)}</p>
                </li>
              ))}
            </ul>
          )}
      </CockpitCard>
      <CockpitCard tone="muted" title="Policy">
        <DeftPolicyPanel policy={state.policy} />
      </CockpitCard>
    </div>
  );
}
