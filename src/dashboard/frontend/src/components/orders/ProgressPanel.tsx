import { useEffect, useMemo, useState } from 'react';
import type { FlywheelPipelineItem, FlywheelStatus } from '@overdeck/contracts';
import { ExternalLink } from 'lucide-react';

import { evaluateOrderDispatchEligibility } from '../../../../../lib/orders/eligibility.js';
import { subscribeFlywheelStatus } from '../../lib/wsTransport';
import type { OrderBookView } from './BookStrip';

interface ProgressPanelProps {
  book: OrderBookView;
  initialStatus?: FlywheelStatus | null;
  onOpenReport: (runId: string) => void;
}

type ItemLiveStatus = 'queued' | 'planning' | 'working' | 'review' | 'merged' | 'closed';

function liveStatus(pipeline: FlywheelPipelineItem | undefined, closed: boolean): ItemLiveStatus {
  if (closed) return 'closed';
  if (!pipeline) return 'queued';
  if (pipeline.status === 'merged' || pipeline.verb === 'shipping' || pipeline.verb === 'merging') return 'merged';
  if (pipeline.verb === 'planning') return 'planning';
  if (pipeline.verb === 'reviewing' || pipeline.verb === 'testing') return 'review';
  return 'working';
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

export function ProgressPanel({ book, initialStatus, onOpenReport }: ProgressPanelProps) {
  const [status, setStatus] = useState<FlywheelStatus | null>(initialStatus ?? null);

  useEffect(() => {
    let current = true;
    if (initialStatus !== undefined) {
      setStatus(initialStatus);
    } else {
      void fetch('/api/flywheel/current')
        .then((response) => response.ok ? response.json() as Promise<FlywheelStatus | null> : null)
        .then((value) => { if (current && value) setStatus(value); })
        .catch(() => {});
    }
    const unsubscribe = subscribeFlywheelStatus((value) => {
      if (current) setStatus(value);
    });
    return () => {
      current = false;
      unsubscribe();
    };
  }, [initialStatus]);

  const matchingStatus = status?.orders?.bookId === book.id ? status : null;
  const pipeline = useMemo(
    () => new Map((matchingStatus?.activePipeline ?? []).map((item) => [item.issueId.toUpperCase(), item])),
    [matchingStatus],
  );
  const inFlight = useMemo(() => new Set([
    ...(matchingStatus?.orders?.laneAInFlight ?? []),
    ...(matchingStatus?.orders?.laneBInFlight ? [matchingStatus.orders.laneBInFlight] : []),
  ].map((issue) => issue.toUpperCase())), [matchingStatus]);
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
          <span className="font-mono text-muted-foreground">{matchingStatus?.orders?.landed ?? book.progress.landed}/{matchingStatus?.orders?.total ?? book.progress.total} landed</span>
          {matchingStatus && <span className="ml-auto font-mono text-[11px] text-muted-foreground">{matchingStatus.runId}</span>}
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          {book.items.map((item) => {
            const progress = progressItems.find((entry) => entry.issue === item.issue)!;
            const pipelineItem = pipeline.get(item.issue.toUpperCase());
            const currentStatus = liveStatus(pipelineItem, progress.terminal);
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

      {matchingStatus?.orders?.drained && (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/[0.08] p-4 text-xs text-success" role="status">
          <span>✓ Order book drained. The run is over; report and retrospective are ready.</span>
          <button type="button" onClick={() => onOpenReport(matchingStatus.runId)} className="ml-auto flex items-center gap-1 rounded-md border border-success/30 px-2.5 py-1.5 text-[11px] hover:bg-success/10">
            Open report &amp; retro <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      )}
    </section>
  );
}
