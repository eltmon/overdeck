/**
 * PAN-5244 · the drawer's compact pipeline strip.
 *
 * One row under the drawer title: the six phases as compact buttons on the
 * left, a right-hand cluster (checks chip, pickup controls) on the right. It
 * replaces the tall phase rail and the always-visible specialist cards in
 * drawer density. A phase button opens that phase's agent conversation.
 *
 * The rail state comes from the same derivation `IssuePhaseRail` uses, so the
 * strip and the rail never disagree. This file must not import
 * `IssueDetailShell` or `DrawerAgentSession` (conformance gate).
 */
import { Fragment, useMemo, type ReactNode } from 'react';
import { Check, CircleAlert, Pause } from 'lucide-react';
import { presenceForPaneState } from '@overdeck/contracts';

import type { Agent } from '../../types';
import { cn } from '../../lib/utils';
import { derivePipelineState } from '../../lib/issuePipelineState';
import { PHASES, phaseLabel, phaseRailState, type Phase, type PhaseRailState, type PhaseStepState } from '../../lib/simple/phases';
import { useIssueData } from '../drawer/useDrawerData';
import type { PhaseAgentInfo } from '../issue-detail/PhaseRail';
import { LEGACY_WHEN_TO_PHASE, ROLE_TO_PHASE, agentPhaseInfo, pickPhaseAgent } from '../issue-detail/IssuePhaseRail';
import { agentsToReviewerSessions, deriveSpecialistChips } from '../issue-detail/deriveSpecialists';

export type PipelineStepKind = 'done' | 'live' | 'paused' | 'attention' | 'next' | 'pending';

/** D-6: the look of one phase button. First match wins. */
export function pipelineStepKind(phase: Phase, state: PhaseStepState, live: boolean, paused: boolean): PipelineStepKind {
  if (paused) return 'paused';
  if (live) return 'live';
  if (state === 'attention') return 'attention';
  if (state === 'done') return 'done';
  if (state === 'current') return phase === 'done' ? 'done' : 'next';
  return 'pending';
}

/** Rail state and date stamps for an issue: the same derivation IssuePhaseRail uses. */
export function usePipelineRail(issueId: string) {
  const { issue, derived, panes, phaseTimeline } = useIssueData(issueId);
  const rail = useMemo(
    () => phaseRailState(derivePipelineState({
      derived: derived ?? null,
      panes,
      issueCanonicalState: issue?.state ?? issue?.status ?? null,
    })),
    [issue, derived, panes],
  );
  const meta = useMemo(() => {
    const out: Partial<Record<Phase, string>> = {};
    for (const step of phaseTimeline) {
      const phase = LEGACY_WHEN_TO_PHASE[step.id];
      if (phase && step.when !== '—') out[phase] = step.when;
    }
    return out;
  }, [phaseTimeline]);
  return { rail, meta, derived, panes };
}

const KIND_TEXT: Record<PipelineStepKind, string> = {
  paused: 'text-warning-foreground font-medium',
  live: 'text-info-foreground font-medium',
  attention: 'text-destructive-foreground font-medium',
  done: 'text-body-foreground font-medium',
  next: 'text-body-foreground font-medium',
  pending: 'text-muted-foreground font-normal',
};

function glyph(kind: PipelineStepKind): ReactNode {
  switch (kind) {
    case 'paused':
      return <Pause className="h-3 w-3" />;
    case 'live':
      return <span data-testid="pipeline-step-pulse" className="h-2 w-2 animate-pulse rounded-full bg-info motion-reduce:animate-none" />;
    case 'attention':
      return <CircleAlert className="h-3 w-3" />;
    case 'done':
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case 'next':
      return <span className="h-2 w-2 rounded-full border-[1.5px] border-current" />;
    case 'pending':
      return <span className="h-[5px] w-[5px] rounded-full bg-current" />;
  }
}

function stepTitle(phase: Phase, kind: PipelineStepKind, state: PhaseStepState, date: string | undefined, clickable: boolean): string {
  const label = phaseLabel(phase);
  let title: string;
  switch (kind) {
    case 'paused':
      title = `${label} agent is paused`;
      break;
    case 'live':
      title = `${label} is running`;
      break;
    case 'attention':
      title = `${label} needs a look`;
      break;
    case 'done':
      title = phase === 'done' && state === 'current'
        ? 'Merged. Close-out has not run yet.'
        : date ? `${label} finished ${date}` : `${label} finished`;
      break;
    case 'next':
      title = `${label} is next. No agent is running.`;
      break;
    case 'pending':
      title = 'Not started';
      break;
  }
  return clickable ? `${title}. Open its conversation.` : title;
}

export interface PipelineStripViewProps {
  rail: PhaseRailState;
  agents?: Partial<Record<Phase, PhaseAgentInfo>>;
  pausedPhases?: ReadonlySet<Phase>;
  /** Phases with a live backend pane of that role, agent or not (D-13, FR-7). */
  livePhases?: ReadonlySet<Phase>;
  meta?: Partial<Record<Phase, string>>;
  /** The phase whose agent's conversation is showing. */
  activePhase?: Phase | null;
  reviewCount?: { done: number; total: number } | null;
  onSelectPhase?: (phase: Phase) => void;
  /** Right-hand cluster: checks chip, pickup controls. */
  children?: ReactNode;
  className?: string;
}

export function PipelineStripView({ rail, agents, pausedPhases, livePhases, meta, activePhase, reviewCount, onSelectPhase, children, className }: PipelineStripViewProps) {
  return (
    <div
      data-component="pipeline-strip"
      data-testid="drawer-pipeline-strip"
      className={cn('relative flex flex-wrap items-center gap-x-[8px] gap-y-[6px]', className)}
    >
      <div role="group" aria-label="Pipeline" className="flex shrink-0 items-center">
        {PHASES.map((phase, index) => {
          const state = rail[phase];
          const info = agents?.[phase];
          const kind = pipelineStepKind(phase, state, info?.live === true || livePhases?.has(phase) === true, pausedPhases?.has(phase) === true);
          const clickable = !!onSelectPhase && info?.hasConversation === true;
          const selected = activePhase === phase;
          return (
            <Fragment key={phase}>
              {index > 0 && <span aria-hidden className="h-px w-[10px] shrink-0 bg-border" />}
              <button
                type="button"
                data-phase={phase}
                data-state={state}
                data-kind={kind}
                aria-pressed={selected}
                disabled={!clickable}
                title={stepTitle(phase, kind, state, meta?.[phase], clickable)}
                onClick={() => clickable && onSelectPhase?.(phase)}
                className={cn(
                  'inline-flex h-[26px] items-center gap-[6px] whitespace-nowrap rounded-[var(--radius)] border px-[8px] text-[12.5px] transition-colors',
                  KIND_TEXT[kind],
                  // .chip-selected lives in @layer components, so a
                  // border-transparent utility would override its border.
                  selected ? 'chip-selected text-foreground' : 'border-transparent',
                  clickable ? 'hover:bg-accent' : 'cursor-default',
                )}
              >
                <span aria-hidden className="grid h-[14px] w-[14px] place-items-center">{glyph(kind)}</span>
                {phaseLabel(phase)}
                {phase === 'review' && reviewCount ? (
                  <span
                    data-testid="pipeline-review-count"
                    title={`${reviewCount.done} of ${reviewCount.total} reviewers finished`}
                    className="font-mono-ui text-[11px] text-muted-foreground"
                  >
                    {reviewCount.done}/{reviewCount.total}
                  </span>
                ) : null}
              </button>
            </Fragment>
          );
        })}
      </div>
      {children ? <div className="ml-auto flex flex-wrap items-center gap-[6px]">{children}</div> : null}
    </div>
  );
}

export interface IssuePipelineStripProps {
  issueId: string;
  agents: Agent[];
  /** The agent whose conversation is showing; null when no conversation is showing. */
  activeAgentId?: string | null;
  onOpenAgentConversation: (agentId: string) => void;
  children?: ReactNode;
  className?: string;
}

export function IssuePipelineStrip({ issueId, agents, activeAgentId, onOpenAgentConversation, children, className }: IssuePipelineStripProps) {
  const { rail, meta, derived, panes } = usePipelineRail(issueId);

  const phaseAgents = useMemo(() => agentPhaseInfo(agents), [agents]);
  const pausedPhases = useMemo(() => {
    const out = new Set<Phase>();
    for (const agent of agents) {
      const phase = ROLE_TO_PHASE[agent.role ?? ''];
      if (phase && agent.paused === true) out.add(phase);
    }
    return out;
  }, [agents]);
  const livePhases = useMemo(() => {
    const out = new Set<Phase>();
    for (const pane of panes) {
      const phase = ROLE_TO_PHASE[pane.role];
      if (phase && presenceForPaneState(pane.state) === 'active') out.add(phase);
    }
    return out;
  }, [panes]);
  const activePhase = useMemo(
    () => ROLE_TO_PHASE[agents.find((agent) => agent.id === activeAgentId)?.role ?? ''] ?? null,
    [agents, activeAgentId],
  );
  // D-7: done/total over the specialist chips; hidden while every chip is queued.
  const reviewCount = useMemo(() => {
    const chips = deriveSpecialistChips(agentsToReviewerSessions(agents), derived);
    if (chips.length === 0 || chips.every((chip) => chip.status === 'queued')) return null;
    return { done: chips.filter((chip) => chip.status === 'done').length, total: chips.length };
  }, [agents, derived]);

  const onSelectPhase = (phase: Phase) => {
    const agent = pickPhaseAgent(agents, phase);
    if (agent) onOpenAgentConversation(agent.id);
  };

  return (
    <PipelineStripView
      rail={rail}
      agents={phaseAgents}
      pausedPhases={pausedPhases}
      livePhases={livePhases}
      meta={meta}
      activePhase={activePhase}
      reviewCount={reviewCount}
      onSelectPhase={onSelectPhase}
      className={className}
    >
      {children}
    </PipelineStripView>
  );
}
