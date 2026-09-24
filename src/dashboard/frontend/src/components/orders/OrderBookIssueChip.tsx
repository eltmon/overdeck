import type { OrderBook } from '@overdeck/contracts';
import { useQuery } from '@tanstack/react-query';

async function fetchOrderBooks(): Promise<OrderBook[]> {
  const response = await fetch('/api/orders');
  if (!response.ok) throw new Error(`GET /api/orders → ${response.status}`);
  const payload = await response.json() as { books?: OrderBook[] };
  return payload.books ?? [];
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
