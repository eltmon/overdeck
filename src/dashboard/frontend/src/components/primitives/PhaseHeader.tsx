import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import PhaseGlyph, { type PhaseGlyphPhase } from './PhaseGlyph';

export type PhaseHeaderPhase = 'ship' | 'review' | 'verifying' | 'work' | 'plan' | 'todo';
export type PhaseHeaderVariant = 'pipeline' | 'command-deck';

const PHASE_LABELS = {
  ship: 'Ship',
  review: 'Review',
  verifying: 'Verifying',
  work: 'Work',
  plan: 'Plan',
  todo: 'Todo',
} satisfies Record<PhaseHeaderPhase, string>;

const PHASE_BORDER_CLASSES = {
  ship: 'border-t-success',
  review: 'border-t-warning',
  verifying: 'border-t-info',
  work: 'border-t-info',
  plan: 'border-t-signal-review',
  todo: 'border-t-[rgb(255_255_255_/_15%)]',
} satisfies Record<PhaseHeaderPhase, string>;

const PHASE_DOT_CLASSES = {
  ship: 'bg-success',
  review: 'bg-warning',
  verifying: 'bg-info',
  work: 'bg-info',
  plan: 'bg-signal-review',
  todo: 'bg-muted-foreground/30',
} satisfies Record<PhaseHeaderPhase, string>;

const VARIANT_PADDING_CLASSES = {
  pipeline: 'px-[22px] pt-[12px] pb-[10px]',
  'command-deck': 'px-[22px] pt-[10px] pb-[8px]',
} satisfies Record<PhaseHeaderVariant, string>;

type PhaseHeaderProps = {
  phase: PhaseHeaderPhase;
  count: number;
  variant?: PhaseHeaderVariant;
  title?: ReactNode;
  subLine?: ReactNode;
  rightMeta?: ReactNode;
  className?: string;
};

function glyphPhaseForHeader(phase: PhaseHeaderPhase): PhaseGlyphPhase {
  return phase;
}

export default function PhaseHeader({
  phase,
  count,
  variant = 'pipeline',
  title,
  subLine,
  rightMeta,
  className,
}: PhaseHeaderProps) {
  return (
    <div
      data-component="phase-header"
      data-phase={phase}
      data-variant={variant}
      className={cn(
        'sticky top-0 z-[2] flex items-center gap-[12px] border-b border-t-2 border-b-border bg-background/95 backdrop-blur-[6px]',
        PHASE_BORDER_CLASSES[phase],
        VARIANT_PADDING_CLASSES[variant],
        className,
      )}
    >
      <span className={cn('h-[8px] w-[8px] rounded-full', PHASE_DOT_CLASSES[phase])} />
      <PhaseGlyph phase={glyphPhaseForHeader(phase)} />
      <div className="flex min-w-0 items-baseline gap-[8px]">
        <span className="truncate text-[14px] font-medium leading-none text-foreground">
          {title ?? PHASE_LABELS[phase]}
        </span>
        <span className="rounded-[var(--radius-sm)] bg-accent px-[6px] py-[1px] text-[11px] leading-none text-muted-foreground">
          {count}
        </span>
        {subLine && (
          <span className="ml-[4px] truncate text-[12px] leading-none text-muted-foreground">
            {subLine}
          </span>
        )}
      </div>
      {rightMeta && (
        <div className="ml-auto min-w-0 font-mono text-[11px] leading-none text-muted-foreground [font-variant-numeric:tabular-nums]">
          {rightMeta}
        </div>
      )}
    </div>
  );
}
