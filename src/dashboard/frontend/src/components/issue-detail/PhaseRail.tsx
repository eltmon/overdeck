/**
 * PAN-2908 · C-DETAIL/C-VOCAB — the ONE phase rail.
 *
 * Six phases (Plan → Work → Review → Test → Ship → Done), one vocabulary,
 * rendered by every issue surface. Presentational: the shell supplies the
 * rail state, per-phase agent info, truthful sublabels, and optional embedded
 * progress for the active phase.
 */
import type { ReactNode } from 'react';
import type { Phase, PhaseRailState, PhaseStepState } from '../../lib/simple/phases';
import { PHASES, phaseLabel } from '../../lib/simple/phases';
import { cn } from '../../lib/utils';

export interface PhaseAgentInfo {
  name: string;
  model?: string;
  runtime?: string;
  startedAt?: string;
  durationSeconds?: number;
  /** A live agent is working this phase right now (pulsing dot). */
  live?: boolean;
  /** This phase has a conversation/session worth opening. */
  hasConversation?: boolean;
}

export interface PhaseMeta {
  text: string;
  href?: string;
  skipped?: boolean;
}

export interface PhaseRailProps {
  rail: PhaseRailState;
  agents?: Partial<Record<Phase, PhaseAgentInfo>>;
  /** Optional per-phase metadata, including links for explicit skip reasons. */
  meta?: Partial<Record<Phase, string | PhaseMeta>>;
  /** Optional embedded content, such as compact live Ship progress. */
  trailing?: Partial<Record<Phase, ReactNode>>;
  /** The phase whose conversation/detail is currently open (highlighted). */
  activePhase?: Phase | null;
  onSelectPhase?: (phase: Phase) => void;
  className?: string;
}

const ACCENT: Record<PhaseStepState, string> = {
  done: 'bg-success',
  current: 'bg-info',
  attention: 'bg-destructive',
  pending: 'bg-muted opacity-60',
};

const NAME_TONE: Record<PhaseStepState, string> = {
  done: 'text-success-foreground',
  current: 'text-info-foreground',
  attention: 'text-destructive-foreground',
  pending: 'text-muted-foreground',
};

function normalizeMeta(value: string | PhaseMeta | undefined, state: PhaseStepState): PhaseMeta {
  if (typeof value === 'string') return { text: value };
  if (value) return value;
  return { text: state === 'done' ? 'Done' : state === 'current' ? 'Live' : state === 'attention' ? 'Needs attention' : 'Queued' };
}

export function PhaseRail({ rail, agents, meta, trailing, activePhase, onSelectPhase, className }: PhaseRailProps) {
  return (
    <div
      data-component="phase-rail"
      className={cn('grid auto-cols-fr grid-flow-col overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      {PHASES.map((phase, i) => {
        const state = rail[phase];
        const agent = agents?.[phase];
        const metaInfo = normalizeMeta(meta?.[phase], state);
        const clickable = !!onSelectPhase && agent?.hasConversation !== false;
        return (
          <div
            key={phase}
            data-phase={phase}
            data-state={state}
            data-skipped={metaInfo.skipped || undefined}
            className={cn(
              'relative min-w-0 px-3 pb-2 pt-2.5 transition-colors',
              i > 0 && 'border-l border-border',
              activePhase === phase && 'bg-primary/8',
              metaInfo.skipped && 'border-dashed',
            )}
          >
            <span className={cn(
              'absolute inset-x-0 top-0 h-0.5',
              metaInfo.skipped ? 'border-t-2 border-dashed border-muted-foreground/50 bg-transparent' : ACCENT[state],
            )} />
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelectPhase?.(phase)}
              className={cn(
                'block w-full min-w-0 text-left',
                clickable && 'hover:text-foreground',
                !clickable && 'cursor-default',
              )}
            >
              <span className={cn('flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em]', NAME_TONE[state])}>
                {agent?.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />}
                {phaseLabel(phase)}
              </span>
            </button>
            {metaInfo.href ? (
              <a href={metaInfo.href} className="mt-0.5 block text-[11px] text-muted-foreground hover:text-foreground hover:underline">
                {metaInfo.text}
              </a>
            ) : (
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{metaInfo.text}</span>
            )}
            {agent ? (
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                {agent.name}
                {agent.runtime ? ` · ${agent.runtime}` : ''}
              </span>
            ) : null}
            {trailing?.[phase] ? <div className="mt-1.5">{trailing[phase]}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
