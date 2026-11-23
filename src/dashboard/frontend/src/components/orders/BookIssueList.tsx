/**
 * One issue list per order book (PAN-5597 WI-6): the parallel lane and the
 * one-at-a-time lane, stacked full width. Each row shows the full title and
 * one status; landed issues collapse behind "Show n landed". `readOnly` (the
 * Flywheel card) renders no grips, actions, stepper buttons or drop targets.
 *
 * Drag and drop: rows move within and between lanes (`PATCH …/items/:issue`
 * with `{ lane, order }`). A drop carrying `ADD_ISSUE_DRAG_TYPE` comes from the
 * Add issues panel and adds that issue to the lane it lands in.
 */
import { useRef, useState, type DragEvent } from 'react';
import type { OrderBookItem, OrderBookLane } from '@overdeck/contracts';

import { selectIssues, useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import { isLanded, itemStatus, orderBookContext, unmetPrerequisites, type OrderBookContext } from './itemStatus';
import { IssueRow, type IssueRequirements } from './IssueRow';
import { bookPath, errorMessage, orderBookRequest, type OrderBookEditorProps } from './orderBookApi';
import type { OrderBookView } from './types';

/** `dataTransfer` type an Add issues panel row sets to its upper-case issue id. */
export const ADD_ISSUE_DRAG_TYPE = 'application/x-overdeck-order-issue';

const LANE_A_MIN = 1;
const LANE_A_MAX = 8;
const LANE_A_DEBOUNCE_MS = 500;

interface BookIssueListProps extends OrderBookEditorProps {
  readOnly?: boolean;
  /** Whether the Flywheel loop is running; decides "Starts next" vs "Ready, Flywheel is stopped". */
  flywheelRunning?: boolean;
}

function rowNotes(context: OrderBookContext, item: OrderBookItem, book: OrderBookView): string[] {
  const unmet = unmetPrerequisites(context, item);
  return [
    unmet.length > 0 ? `after ${unmet.join(', ')}` : '',
    item.reVerify ? 're-check PRD first' : '',
    item.planAtPickup ? 'plan when it starts' : '',
    book.itemReadiness?.[item.issue]?.hasPrd === false ? 'no PRD' : '',
  ].filter(Boolean);
}

export function BookIssueList({ book, project, onBookChange, onError, readOnly = false, flywheelRunning = false }: BookIssueListProps) {
  const derivedById = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const issues = useDashboardStore(selectIssues) as Issue[];
  const [draggedIssue, setDraggedIssue] = useState<string | null>(null);
  const [showLanded, setShowLanded] = useState<Record<OrderBookLane, boolean>>({ A: false, B: false });
  const [pendingConcurrency, setPendingConcurrency] = useState<number | null>(null);
  const concurrencyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const context = orderBookContext(book, derivedById, flywheelRunning);
  const titles = new Map(issues.map((issue) => [issue.identifier.toUpperCase(), issue.title]));
  const concurrency = pendingConcurrency ?? book.settings.laneAConcurrency;

  const mutate = async (suffix: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) => {
    try {
      // Await first: `onBookChange?.(await …)` would skip the request when no callback is passed.
      const updated = await orderBookRequest(bookPath(book.id, suffix), project, { method, body });
      onBookChange?.(updated);
    } catch (cause) {
      onError?.(errorMessage(cause));
      throw cause;
    }
  };
  const itemPath = (issueId: string) => `/items/${encodeURIComponent(issueId)}`;
  const laneCount = (lane: OrderBookLane) => book.items.filter((item) => item.lane === lane).length;

  const drop = (event: DragEvent, lane: OrderBookLane, order: number) => {
    event.preventDefault();
    event.stopPropagation();
    const added = event.dataTransfer?.types?.includes(ADD_ISSUE_DRAG_TYPE)
      ? event.dataTransfer.getData(ADD_ISSUE_DRAG_TYPE).trim().toUpperCase()
      : '';
    if (added) {
      void mutate('/items', 'POST', { item: { issue: added, lane } }).catch(() => undefined);
      return;
    }
    if (!draggedIssue) return;
    void mutate(itemPath(draggedIssue), 'PATCH', { lane, order }).catch(() => undefined);
    setDraggedIssue(null);
  };

  const swapLane = (item: OrderBookItem) => {
    const lane: OrderBookLane = item.lane === 'A' ? 'B' : 'A';
    void mutate(itemPath(item.issue), 'PATCH', { lane, order: laneCount(lane) + 1 }).catch(() => undefined);
  };

  const saveOptions = (issueId: string, requirements: IssueRequirements) => mutate(itemPath(issueId), 'PATCH', requirements);

  const adjustConcurrency = (delta: number) => {
    const next = Math.min(LANE_A_MAX, Math.max(LANE_A_MIN, concurrency + delta));
    setPendingConcurrency(next);
    clearTimeout(concurrencyTimer.current);
    concurrencyTimer.current = setTimeout(() => {
      void mutate('', 'PATCH', { settings: { laneAConcurrency: next } })
        .catch(() => undefined)
        .finally(() => setPendingConcurrency(null));
    }, LANE_A_DEBOUNCE_MS);
  };

  const lanes: Array<{ lane: OrderBookLane; heading: string; empty: string }> = [
    { lane: 'A', heading: 'Parallel lane', empty: 'No issues yet. Add issues, or drag them here.' },
    { lane: 'B', heading: 'One-at-a-time lane', empty: 'Empty. Drag an issue here when it must not overlap with other work.' },
  ];

  return (
    <div className="grid gap-4" data-section="OrderBookIssueList">
      {lanes.map(({ lane, heading, empty }) => {
        const items = book.items.filter((item) => item.lane === lane).sort((left, right) => left.order - right.order);
        const landed = items.filter((item) => isLanded(context, item));
        const open = items.filter((item) => !isLanded(context, item));
        const onlyLanded = open.length === 0 && landed.length > 0;
        const visible = onlyLanded || showLanded[lane] ? items : open;
        const dropTarget = readOnly ? {} : {
          onDragOver: (event: DragEvent) => event.preventDefault(),
          onDrop: (event: DragEvent) => drop(event, lane, items.length + 1),
        };
        return (
          <section key={lane} aria-label={heading} className="overflow-hidden rounded-lg border border-border bg-card" {...dropTarget}>
            <div className="list-group-bar flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2 text-xs">
              <h3 className="font-medium text-foreground">{heading}</h3>
              {lane === 'A' ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  Up to
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label="Fewer parallel issues"
                      disabled={concurrency <= LANE_A_MIN}
                      onClick={() => adjustConcurrency(-1)}
                      className="rounded-md border border-input px-1.5 leading-5 text-foreground disabled:opacity-40"
                    >
                      −
                    </button>
                  )}
                  <span className="font-mono tabular-nums text-foreground" data-testid="parallel-limit">{concurrency}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label="More parallel issues"
                      disabled={concurrency >= LANE_A_MAX}
                      onClick={() => adjustConcurrency(1)}
                      className="rounded-md border border-input px-1.5 leading-5 text-foreground disabled:opacity-40"
                    >
                      +
                    </button>
                  )}
                  issues run at the same time.
                </span>
              ) : (
                <span className="text-muted-foreground">Runs top to bottom, one issue at a time. Use it for work that would collide.</span>
              )}
              <span className="ml-auto rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Lane {lane}</span>
            </div>
            {visible.map((item) => (
              <IssueRow
                key={item.issue}
                item={item}
                title={titles.get(item.issue.toUpperCase())}
                status={itemStatus(context, item)}
                notes={rowNotes(context, item, book)}
                readOnly={readOnly}
                onDragStart={setDraggedIssue}
                onDrop={drop}
                onSwapLane={swapLane}
                onRemove={(issueId) => void mutate(itemPath(issueId), 'DELETE').catch(() => undefined)}
                onSaveOptions={saveOptions}
              />
            ))}
            {items.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">{empty}</p>}
            {!onlyLanded && landed.length > 0 && (
              <button
                type="button"
                aria-expanded={showLanded[lane]}
                onClick={() => setShowLanded((current) => ({ ...current, [lane]: !current[lane] }))}
                className="w-full border-t border-border px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground"
              >
                {showLanded[lane] ? `▾ Hide ${landed.length} landed` : `▸ Show ${landed.length} landed`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
