/**
 * The 9-step merge tracker (PAN-4753 WI-10), restored from the pre-Cut
 * `AwaitingMergePage.tsx@a9d0942c1ed`: done ✓, current spinner, the failed
 * step ✕ in red, pending ○, with the run's notes below.
 */
import { CheckCircle, Circle, Loader2, XCircle } from 'lucide-react';
import type { MergeStepKey } from './boardTypes';
import { MERGE_STEPS } from './trainCopy';

export type StepMarker = 'done' | 'current' | 'failed' | 'pending';

/** The marker of each step given the current step and whether the run failed. */
export function stepMarkers(step: MergeStepKey | null, failed: boolean): StepMarker[] {
  const index = step ? MERGE_STEPS.findIndex((s) => s.key === step) : -1;
  return MERGE_STEPS.map((_, i) => {
    if (index < 0) return failed && i === 0 ? 'failed' : 'pending';
    if (i < index) return 'done';
    if (i === index) return failed ? 'failed' : 'current';
    return 'pending';
  });
}

export function MergeStepTracker({ step, failed, notes }: { step: MergeStepKey | null; failed: boolean; notes: string | null }) {
  const markers = stepMarkers(step, failed);
  return (
    <div data-testid="merge-step-tracker" className="space-y-1">
      <ol className="space-y-0.5">
        {MERGE_STEPS.map((s, i) => {
          const marker = markers[i]!;
          return (
            <li key={s.key} data-step={s.key} data-marker={marker} className="flex items-center gap-2 text-[11px]">
              {marker === 'done' && <CheckCircle className="h-3.5 w-3.5 text-success" aria-label="done" />}
              {marker === 'current' && <Loader2 className="h-3.5 w-3.5 animate-spin text-info" aria-label="in progress" />}
              {marker === 'failed' && <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="failed" />}
              {marker === 'pending' && <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-label="pending" />}
              <span className={
                marker === 'failed'
                  ? 'text-destructive-foreground'
                  : marker === 'pending' ? 'text-muted-foreground' : 'text-foreground'
              }
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      {notes && (
        <p className={`text-[11px] leading-snug ${failed ? 'text-destructive-foreground' : 'text-muted-foreground'}`}>{notes}</p>
      )}
    </div>
  );
}
