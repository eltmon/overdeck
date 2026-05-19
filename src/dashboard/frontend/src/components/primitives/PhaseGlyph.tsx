import type { SVGProps } from 'react';

import { cn } from '../../lib/utils';

export type PhaseGlyphPhase = 'todo' | 'plan' | 'work' | 'review' | 'ship' | 'done';

const PHASE_CLASSES = {
  todo: 'text-muted-foreground',
  plan: 'text-signal-review-foreground',
  work: 'text-info-foreground',
  review: 'text-warning-foreground',
  ship: 'text-signal-review-foreground',
  done: 'text-success-foreground',
} satisfies Record<PhaseGlyphPhase, string>;

type PhaseGlyphProps = Omit<SVGProps<SVGSVGElement>, 'color'> & {
  phase: PhaseGlyphPhase;
};

function renderGlyph(phase: PhaseGlyphPhase) {
  switch (phase) {
    case 'todo':
      return (
        <>
          <circle cx="7" cy="7" r="4.5" />
          <path d="M5 7h4" />
        </>
      );
    case 'plan':
      return (
        <>
          <path d="M3.5 10.5V3.8c0-.7.5-1.1 1.2-.8l5.8 2.4c.7.3.7 1.2 0 1.5L4.7 9.3c-.7.3-1.2-.1-1.2-.8" />
          <path d="M3.5 10.5v1.5" />
        </>
      );
    case 'work':
      return (
        <>
          <path d="M2.5 8.2 5.2 11 11.5 4" />
          <path d="M2.5 4h4" />
        </>
      );
    case 'review':
      return (
        <>
          <path d="M7 2.5 12 5v3.4c0 2.1-1.9 3.3-5 4-3.1-.7-5-1.9-5-4V5l5-2.5Z" />
          <path d="M5 7h4" />
        </>
      );
    case 'ship':
      return (
        <>
          <path d="M7 2.5 10.5 6H8.2v3.2H5.8V6H3.5L7 2.5Z" />
          <path d="M3.5 11.5h7" />
        </>
      );
    case 'done':
      return (
        <>
          <circle cx="7" cy="7" r="4.8" />
          <path d="m4.8 7.2 1.4 1.4 3-3.2" />
        </>
      );
  }
}

export default function PhaseGlyph({ phase, className, ...props }: PhaseGlyphProps) {
  return (
    <svg
      aria-hidden="true"
      data-component="phase-glyph"
      data-phase={phase}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('h-[14px] w-[14px] shrink-0', PHASE_CLASSES[phase], className)}
      {...props}
    >
      {renderGlyph(phase)}
    </svg>
  );
}
