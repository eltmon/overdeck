/**
 * PAN-2908 · C-VOCAB — the mini phase rail: six dots, one lifecycle.
 * Card/row-density companion of PhaseRail (issue-detail/PhaseRail.tsx).
 */
import type { PhaseRailState, PhaseStepState } from '../../lib/simple/phases';
import { PHASES, phaseLabel } from '../../lib/simple/phases';
import { cn } from '../../lib/utils';

const DOT: Record<PhaseStepState, string> = {
  done: 'bg-success border-transparent',
  current: 'bg-signal-review border-transparent shadow-[0_0_0_2px] shadow-signal-review/30',
  attention: 'bg-destructive border-transparent',
  pending: 'bg-muted border-border',
};

export function PhaseDots({ rail, className }: { rail: PhaseRailState; className?: string }) {
  return (
    <span className={cn('inline-flex flex-none items-center gap-1', className)} data-component="phase-dots" role="img"
      aria-label={PHASES.map((p) => `${phaseLabel(p)}: ${rail[p]}`).join(', ')}
    >
      {PHASES.map((phase) => (
        <span
          key={phase}
          data-phase={phase}
          data-state={rail[phase]}
          title={`${phaseLabel(phase)}: ${rail[phase]}`}
          className={cn('h-1.5 w-1.5 rounded-full border', DOT[rail[phase]])}
        />
      ))}
    </span>
  );
}
