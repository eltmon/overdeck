/**
 * The status pill of a merge-train car (PAN-4753 WI-10), and the shared
 * `Pill` badge the strike lane and batch card also use.
 *
 * Badge formula from the style guide: 8% tint, 32% border, the signal's
 * `-foreground` text. Amber = a person can act (cooldown, waits for UAT),
 * blue = a machine is working, red = blocked or failed, emerald = merged.
 */
import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { TrainCar } from './boardTypes';
import { FAILED_PILL, HELD_PILL, READY_PILL, blockedPill, cooldownPill, mergingPill } from './trainCopy';
import { useNow } from './useMergeTrainBoard';

export type Tone = 'warning' | 'info' | 'destructive' | 'success' | 'muted';

export const TONE_CLASS: Record<Tone, string> = {
  warning: 'badge-bg-warning badge-border-warning text-warning-foreground',
  info: 'badge-bg-info badge-border-info text-info-foreground',
  destructive: 'badge-bg-destructive badge-border-destructive text-destructive-foreground',
  success: 'badge-bg-success badge-border-success text-success-foreground',
  muted: 'badge-bg-muted badge-border-muted text-muted-foreground',
};

/** Left-border colour of a row by state (cooldown amber, merging blue, blocked/failed red). */
export const ROW_BORDER: Record<Tone, string> = {
  warning: 'border-l-warning',
  info: 'border-l-info',
  destructive: 'border-l-destructive',
  success: 'border-l-success',
  muted: 'border-l-border',
};

export function Pill({ tone, spin, testId, title, children }: {
  tone: Tone;
  spin?: boolean;
  testId?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-testid={testId}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {spin && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {children}
    </span>
  );
}

export function carTone(state: TrainCar['state']): Tone {
  switch (state) {
    case 'cooldown': return 'warning';
    case 'merging': return 'info';
    case 'blocked':
    case 'failed': return 'destructive';
    default: return 'muted';
  }
}

export function CarStatusPill({ car }: { car: Pick<TrainCar, 'issueId' | 'state' | 'mergeAt' | 'step' | 'blockers'> }) {
  const now = useNow(1000, car.state === 'cooldown');
  const tone = carTone(car.state);
  const testId = `car-pill-${car.issueId}`;
  switch (car.state) {
    case 'cooldown':
      return <Pill tone={tone} testId={testId}>{cooldownPill(car.mergeAt, now)}</Pill>;
    case 'merging':
      return <Pill tone={tone} spin testId={testId}>{mergingPill(car.step)}</Pill>;
    case 'blocked':
      return (
        <Pill tone={tone} testId={testId} title={car.blockers.map((b) => b.details ?? b.summary).join('\n') || undefined}>
          {blockedPill(car.blockers)}
        </Pill>
      );
    case 'failed':
      return <Pill tone={tone} testId={testId}>{FAILED_PILL}</Pill>;
    case 'held':
      return <Pill tone={tone} testId={testId}>{HELD_PILL}</Pill>;
    default:
      return <Pill tone={tone} testId={testId}>{READY_PILL}</Pill>;
  }
}
