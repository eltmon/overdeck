import { useState, type DragEvent } from 'react';
import type { OrderBookItem, OrderBookLane } from '@overdeck/contracts';

import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import type { OrderBookView } from './BookStrip';
import { LaneItem, type LaneItemState } from './LaneItem';

interface LaneEditorProps {
  book: OrderBookView;
  inFlightIssues?: ReadonlySet<string>;
  onBookChange: (book: OrderBookView) => void;
}

async function responseBook(response: Response): Promise<OrderBookView> {
  const payload = await response.json().catch(() => null) as (OrderBookView & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? `Order book mutation failed (${response.status})`);
  return payload as OrderBookView;
}

function itemState(book: OrderBookView, issueId: string, inFlight: ReadonlySet<string>): LaneItemState {
  const progress = book.progress.items?.find((item) => item.issue === issueId);
  if (progress?.closed) return 'landed';
  if (inFlight.has(issueId.toUpperCase())) return 'in-pipeline';
  return book.settings.posture === 'drain' ? 'held' : 'released';
}

export function LaneEditor({ book, inFlightIssues = new Set(), onBookChange }: LaneEditorProps) {
  const [draggedIssue, setDraggedIssue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patchItem = async (issueId: string, patch: Record<string, unknown>) => {
    setError(null);
    const response = await fetch(`/api/orders/${encodeURIComponent(book.id)}/items/${encodeURIComponent(issueId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify(patch),
    });
    onBookChange(await responseBook(response));
  };

  const drop = (event: DragEvent, lane: OrderBookLane, order: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedIssue) return;
    void patchItem(draggedIssue, { lane, order }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
    setDraggedIssue(null);
  };

  const swapLane = (item: OrderBookItem) => {
    const lane: OrderBookLane = item.lane === 'A' ? 'B' : 'A';
    const order = book.items.filter((candidate) => candidate.lane === lane).length + 1;
    void patchItem(item.issue, { lane, order }).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  };

  const remove = async (issueId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(book.id)}/items/${encodeURIComponent(issueId)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
      });
      onBookChange(await responseBook(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="grid gap-3 lg:grid-cols-2" aria-label="Order book lane editor">
      {(['A', 'B'] as const).map((lane) => {
        const items = book.items.filter((item) => item.lane === lane).sort((left, right) => left.order - right.order);
        return (
          <div key={lane} className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-baseline gap-2 border-b border-border px-3 py-2">
              <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Lane {lane}</h2>
              <span className="text-[11px] text-muted-foreground">{lane === 'A' ? `parallel · up to ${book.settings.laneAConcurrency}` : 'strictly serial · one in flight'}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{items.length} items</span>
            </div>
            {items.map((item) => (
              <LaneItem
                key={item.issue}
                item={item}
                state={itemState(book, item.issue, inFlightIssues)}
                hasPrd={book.itemReadiness?.[item.issue]?.hasPrd ?? true}
                onDragStart={setDraggedIssue}
                onDrop={drop}
                onSwapLane={swapLane}
                onRemove={(issueId) => void remove(issueId)}
              />
            ))}
            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, lane, items.length + 1)}
              className="border-t border-dashed border-border px-3 py-2 text-center text-[11px] text-muted-foreground"
            >
              Drop issues here for Lane {lane}
            </div>
          </div>
        );
      })}
      {error && <p className="lg:col-span-2 text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}
