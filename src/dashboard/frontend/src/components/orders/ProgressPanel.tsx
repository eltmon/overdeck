import { useMemo } from 'react';

import { evaluateOrderDispatchEligibility } from '../../../../../lib/orders/eligibility.js';
import { IN_FLIGHT_STATES } from '../../lib/pipeline-state';
import { useDashboardStore } from '../../lib/store';
import type { DerivedIssueState } from '../../types';
import type { OrderBookView } from './BookStrip';

interface ProgressPanelProps {
  book: OrderBookView;
}

type ItemLiveStatus = 'queued' | 'planning' | 'working' | 'review' | 'merged' | 'closed';

/**
 * PAN-3917: item status is the issue's derived state, not a flywheel run's
 * pipeline copy. Planning is 'planned' — the spec exists but no pane is live.
 */
function liveStatus(derived: DerivedIssueState | undefined, closed: boolean): ItemLiveStatus {
  if (closed) return 'closed';
  if (!derived) return 'queued';
  if (derived.state === 'merged') return 'merged';
  if (derived.state === 'closed') return 'closed';
  if (derived.state === 'planned') return 'planning';
  if (derived.state === 'in-review' || derived.state === 'changes-requested' || derived.state === 'ready') return 'review';
  if (derived.state === 'working') return 'working';
  return 'queued';
}



function statusTone(status: ItemLiveStatus): string {
  if (status === 'planning' || status === 'working') return 'border-l-info bg-info/[0.08] text-info';
  if (status === 'review') return 'border-l-warning bg-warning/[0.08] text-warning-foreground';
  if (status === 'merged' || status === 'closed') return 'border-l-success bg-success/[0.08] text-success';
  return 'border-l-transparent text-muted-foreground';
}

const CONDITION_LABELS: Record<string, string> = {
  'pickup-posture': 'Pickup posture',
  'lane-slot': 'Serial B-slot free',
  prerequisites: 'Prereqs landed',
  'prd-reverified': 'PRD re-verified',
};

export function ProgressPanel({ book }: ProgressPanelProps) {
  const derivedById = useDashboardStore((s) => s.derivedIssueStateByIssueId);

  const derived = useMemo(
    () => new Map(Object.values(derivedById).map((entry) => [entry.issueId.toUpperCase(), entry])),
    [derivedById],
  );
  const inFlight = useMemo(
    () => new Set(
      book.items
        .map((item) => derived.get(item.issue.toUpperCase()))
        .filter((entry): entry is DerivedIssueState => !!entry && IN_FLIGHT_STATES.has(entry.state))
        .map((entry) => entry.issueId.toUpperCase()),
    ),
    [book.items, derived],
  );
  const prerequisiteTerminal = useMemo(
    () => new Map(Object.entries(book.prerequisiteTerminal ?? {})),
    [book.prerequisiteTerminal],
  );
  const progressItems = book.items.map((item) => {
    const value = book.progress.items?.find((entry) => entry.issue.toUpperCase() === item.issue.toUpperCase());
    return {
      issue: item.issue,
      lane: item.lane,
      order: item.order,
      closed: value?.closed ?? false,
      parked: value?.parked ?? false,
      terminal: value?.terminal ?? false,
    };
  });

  return (
    <section className="grid gap-3" aria-label="Order book progress">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-3 text-xs">
          <h2 className="font-medium text-foreground">Live checklist</h2>
          <span className="font-mono text-muted-foreground">{book.progress.landed}/{book.progress.total} landed</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {book.items.map((item) => {
            const progress = progressItems.find((entry) => entry.issue === item.issue)!;
            const currentStatus = liveStatus(derived.get(item.issue.toUpperCase()), progress.terminal);
            const eligibility = evaluateOrderDispatchEligibility({
              book,
              progress: { bookId: book.id, total: book.progress.total, landed: book.progress.landed, drained: book.progress.drained, items: progressItems },
              issueId: item.issue,
              inFlightIssues: inFlight,
              prerequisiteTerminal,
            });
            const held = currentStatus === 'queued';
            return (
              <div key={item.issue} data-live-status={currentStatus} className={`border-l-2 border-t border-border px-3 py-2 first:border-t-0 ${statusTone(currentStatus)}`}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[11px] text-muted-foreground">{item.lane}{item.order} · book</span>
                  <span className="font-mono text-foreground">{item.issue}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide">{currentStatus}</span>
                </div>
                {held && (
                  <div className="mt-2 grid gap-1 sm:grid-cols-2" aria-label={`${item.issue} eligibility`}>
                    {eligibility.conditions.filter((condition) => condition.key !== 'book-membership').map((condition) => (
                      <span key={condition.key} title={condition.detail} className="text-[10px] text-muted-foreground">
                        <span className={condition.met ? 'text-success' : 'text-destructive'}>{condition.met ? '✓' : '✕'}</span>{' '}
                        {CONDITION_LABELS[condition.key] ?? condition.key}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {book.items.length === 0 && <p className="p-4 text-xs text-muted-foreground">No items in this book.</p>}
        </div>
      </div>

      {book.progress.drained && (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/[0.08] p-4 text-xs text-success" role="status">
          <span>✓ Order book drained — every item has landed.</span>
        </div>
      )}
    </section>
  );
}
