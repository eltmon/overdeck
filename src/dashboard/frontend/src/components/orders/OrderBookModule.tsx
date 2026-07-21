import { useMemo } from 'react';
import type { FlywheelPipelineItem, FlywheelStatus, OrderBook } from '@overdeck/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen } from 'lucide-react';

interface OrderBookProgressItem {
  issue: string;
  terminal: boolean;
}

interface OrderBookProjection extends OrderBook {
  progress?: {
    total: number;
    landed: number;
    drained: boolean;
    items?: OrderBookProgressItem[];
  };
}

async function fetchOrderBooks(): Promise<OrderBook[]> {
  const response = await fetch('/api/orders');
  if (!response.ok) throw new Error(`GET /api/orders → ${response.status}`);
  const payload = await response.json() as { books?: OrderBook[] };
  return payload.books ?? [];
}

async function fetchOrderBook(bookId: string): Promise<OrderBookProjection> {
  const response = await fetch(`/api/orders/${encodeURIComponent(bookId)}`);
  if (!response.ok) throw new Error(`GET /api/orders/${bookId} → ${response.status}`);
  return response.json() as Promise<OrderBookProjection>;
}

function liveStatus(pipeline: FlywheelPipelineItem | undefined, terminal: boolean): string {
  if (terminal) return 'landed';
  if (!pipeline) return 'held';
  if (pipeline.status === 'merged' || pipeline.verb === 'shipping' || pipeline.verb === 'merging') return 'merged';
  if (pipeline.verb === 'planning') return 'planning';
  if (pipeline.verb === 'reviewing' || pipeline.verb === 'testing') return 'review';
  return 'working';
}

function statusClass(status: string): string {
  if (status === 'landed' || status === 'merged') return 'text-success';
  if (status === 'review') return 'text-warning-foreground';
  if (status === 'planning' || status === 'working') return 'text-info';
  return 'text-muted-foreground';
}

export function OrderBookModule({ status }: { status: FlywheelStatus }) {
  const orders = status.orders;
  const { data: book } = useQuery({
    queryKey: ['order-book', orders?.bookId],
    queryFn: () => fetchOrderBook(orders!.bookId),
    enabled: !!orders?.bookId,
    staleTime: 5_000,
  });
  const pipeline = useMemo(
    () => new Map(status.activePipeline.map((item) => [item.issueId.toUpperCase(), item])),
    [status.activePipeline],
  );

  if (!orders) return null;

  const progressWidth = orders.total > 0 ? Math.round((orders.landed / orders.total) * 100) : 0;
  return (
    <section className="border-b border-border bg-card/30 px-4 py-3" aria-label="Active order book">
      <div className="flex items-center gap-2">
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Order book</h2>
        <a href="/orders" className="truncate text-xs text-foreground hover:text-primary hover:underline">{orders.bookName} <ArrowRight className="inline h-3 w-3" /></a>
        {book && (
          <span className={`ml-auto rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${book.settings.posture === 'drain' ? 'border-warning/30 bg-warning/[0.08] text-warning-foreground' : 'border-border bg-muted/40 text-muted-foreground'}`}>
            {book.settings.posture.toUpperCase()}
          </span>
        )}
      </div>

      {book?.settings.posture === 'drain' && (
        <p className="mt-2 rounded-md border border-warning/30 bg-warning/[0.08] px-2.5 py-2 text-[11px] text-warning-foreground">
          Pickup on hold. In-flight work continues, but no new book item will dispatch.
          {book.settings.postureReason ? <span className="text-muted-foreground"> {book.settings.postureReason}</span> : null}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="font-mono text-foreground">{orders.landed}/{orders.total}</span> landed
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-success" style={{ width: `${progressWidth}%` }} /></span>
        <span>{Math.max(0, orders.total - orders.landed)} remaining</span>
      </div>

      {book && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(['A', 'B'] as const).map((lane) => (
            <div key={lane} className="overflow-hidden rounded-md border border-border" aria-label={`Order book Lane ${lane}`}>
              <div className="flex items-center border-b border-border px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Lane {lane}<span className="ml-auto normal-case tracking-normal">{lane === 'A' ? 'parallel' : 'strictly serial'}</span>
              </div>
              {book.items.filter((item) => item.lane === lane).map((item) => {
                const terminal = book.progress?.items?.find((entry) => entry.issue.toUpperCase() === item.issue.toUpperCase())?.terminal ?? false;
                const itemStatus = liveStatus(pipeline.get(item.issue.toUpperCase()), terminal);
                return (
                  <div key={item.issue} className="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11px] first:border-t-0">
                    <span className="font-mono text-muted-foreground">{item.lane}{item.order} · book</span>
                    <span className="font-mono text-foreground">{item.issue}</span>
                    <span className={`ml-auto text-[10px] ${statusClass(itemStatus)}`}>{itemStatus}</span>
                  </div>
                );
              })}
              {book.items.every((item) => item.lane !== lane) && <p className="px-2.5 py-2 text-[11px] text-muted-foreground">Lane empty</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function OrderBookIssueChip({ issueId }: { issueId: string }) {
  const { data: books = [] } = useQuery({
    queryKey: ['order-books'],
    queryFn: fetchOrderBooks,
    staleTime: 15_000,
  });
  const membership = books
    .filter((book) => book.status !== 'complete')
    .map((book) => ({ book, item: book.items.find((item) => item.issue.toUpperCase() === issueId.toUpperCase()) }))
    .find((entry) => entry.item);

  if (!membership?.item) return null;
  return (
    <a
      href="/orders"
      data-section="OrderBookIssueChip"
      onClick={(event) => event.stopPropagation()}
      className="inline-flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
      title={`${membership.book.name} — ${membership.item.lane}${membership.item.order}`}
      aria-label={`${membership.item.lane}${membership.item.order} · book · ${membership.book.name}`}
    >
      <span className="shrink-0 rounded-[3px] border border-primary/30 bg-primary/[0.08] px-1.5 py-px font-mono text-[10px] text-foreground">{membership.item.lane}{membership.item.order} · book</span>
      <span className="max-w-24 truncate">{membership.book.name}</span>
    </a>
  );
}
