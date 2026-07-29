/**
 * DecisionsIndicator — header badge for everything waiting on the operator.
 *
 * Counts from useDecisions (the canonical agents + conversations join), so it
 * always agrees with the pipeline "Needs you" list. Clicking opens a popover
 * with the same DecisionsPanel rows; "Open" navigates to the conversation or
 * issue, "Answer" reopens the question dialog in place. Navigation goes
 * through the URL door (pushState + popstate) that App's onPopState owns, so
 * this works from any surface without threading App callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import { CircleUserRound } from 'lucide-react';
import { DecisionsPanel } from './DecisionsPanel';
import { useDecisions, type Decision } from '../lib/useDecisions';
import { navigateToDecisionSubject } from '../lib/navigateToDecision';

/** Kept as the popover's entry point; the routing itself is shared (PAN-3276). */
export function navigateForDecision(d: Decision): void {
  navigateToDecisionSubject(d);
}

export function DecisionsIndicator() {
  const decisions = useDecisions();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (decisions.length === 0) return null;

  const label = `${decisions.length} decision${decisions.length === 1 ? '' : 's'} waiting on you — click to view`;
  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        data-testid="decisions-indicator"
        className="inline-flex h-5 items-center gap-1.5 rounded-sm border px-1.5 text-[10px] font-medium badge-bg-warning badge-border-warning text-warning-foreground tabular-nums"
      >
        <CircleUserRound className="h-3.5 w-3.5" aria-hidden="true" />
        {decisions.length}
      </button>
      {open && (
        <div className="absolute top-full right-0 z-[200] mt-2 w-[26rem] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover p-2 text-sm shadow-lg">
          <DecisionsPanel
            onOpenSubject={(d) => {
              navigateForDecision(d);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
