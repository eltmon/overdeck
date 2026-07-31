/**
 * PAN-2908 · C-DETAIL/C-VOCAB — the ONE phase rail.
 *
 * Six phases (Plan → Work → Review → Test → Ship → Done), one vocabulary,
 * rendered by every issue surface. Presentational: the shell supplies the
 * rail state (lib/simple/phases.phaseRailState over the shared machine
 * classifier), per-phase agent info, and (optionally) a phase handler so the
 * rail doubles as the per-agent conversation switcher.
 */
import type { Phase, PhaseRailState, PhaseStepState } from '../../lib/simple/phases';
import { PHASES, phaseLabel } from '../../lib/simple/phases';
import { cn } from '../../lib/utils';

export interface PhaseAgentInfo {
  name: string;
  model?: string;
  runtime?: string;
  /** A live agent is working this phase right now (pulsing dot). */
  live?: boolean;
  /** This phase has a conversation/session worth opening. */
  hasConversation?: boolean;
}

export interface PhaseRailProps {
  rail: PhaseRailState;
  agents?: Partial<Record<Phase, PhaseAgentInfo>>;
  /** Optional per-phase meta override (e.g. date stamps); defaults to state text. */
  meta?: Partial<Record<Phase, string>>;
  /** The phase whose conversation/detail is currently open (highlighted). */
  activePhase?: Phase | null;
  onSelectPhase?: (phase: Phase) => void;
  className?: string;
}

const ACCENT: Record<PhaseStepState, string> = {
  done: 'bg-success',
  current: 'bg-signal-review',
  attention: 'bg-destructive',
  pending: 'bg-muted opacity-60',
};

const NAME_TONE: Record<PhaseStepState, string> = {
  done: 'text-success-foreground',
  current: 'text-signal-review-foreground',
  attention: 'text-destructive-foreground',
  pending: 'text-muted-foreground',
};

export function PhaseRail({ rail, agents, meta, activePhase, onSelectPhase, className }: PhaseRailProps) {
  return (
    <div
      data-component="phase-rail"
      className={cn('grid auto-cols-fr grid-flow-col overflow-hidden rounded-lg border border-border bg-card', className)}
    >
      {PHASES.map((phase, i) => {
        const state = rail[phase];
        const agent = agents?.[phase];
        const metaText = meta?.[phase] ?? (state === 'done' ? 'done' : state === 'current' ? 'in progress' : state === 'attention' ? 'needs a look' : 'queued');
        // Clickable whenever a handler exists and the phase isn't explicitly
        // conversation-less — shells decide what a click means with no agent
        // (drawer: no-op; cockpit: falls back to the phase's default view).
        const clickable = !!onSelectPhase && agent?.hasConversation !== false;
        return (
          <button
            key={phase}
            type="button"
            data-phase={phase}
            data-state={state}
            disabled={!clickable}
            onClick={() => clickable && onSelectPhase?.(phase)}
            className={cn(
              'relative min-w-0 px-3 pb-2 pt-2.5 text-left transition-colors',
              i > 0 && 'border-l border-border',
              clickable && 'hover:bg-accent',
              activePhase === phase && 'bg-primary/8',
              !clickable && 'cursor-default',
            )}
          >
            <span className={cn('absolute inset-x-0 top-0 h-0.5', ACCENT[state])} />
            <span className={cn('flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.08em]', NAME_TONE[state])}>
              {agent?.live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />}
              {phaseLabel(phase)}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {metaText}
            </span>
            {agent && (
              <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                {agent.name}
                {agent.runtime ? ` · ${agent.runtime}` : ''}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
