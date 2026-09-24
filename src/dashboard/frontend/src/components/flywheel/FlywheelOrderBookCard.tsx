/**
 * The running order book in the Flywheel rail (PAN-3964 FR-12). Reads
 * `GET /api/orders` and renders the book's live `ProgressPanel`; renders
 * nothing when no book is running.
 */
import { useQuery } from '@tanstack/react-query';

import type { OrderBookView } from '../orders/BookStrip';
import { ProgressPanel } from '../orders/ProgressPanel';
import { RailCard } from './primitives';

interface OrdersPayload {
  project?: string;
  books?: OrderBookView[];
}

async function fetchOrders(): Promise<OrdersPayload> {
  const res = await fetch('/api/orders');
  if (!res.ok) throw new Error(`GET /api/orders → ${res.status}`);
  return res.json() as Promise<OrdersPayload>;
}

export function FlywheelOrderBookCard({ bookId }: { bookId?: string | null }) {
  const { data } = useQuery({ queryKey: ['flywheel', 'orders'], queryFn: fetchOrders, refetchInterval: 15_000 });
  const books = data?.books ?? [];
  const book = (bookId ? books.find((b) => b.id === bookId) : undefined) ?? books.find((b) => b.status === 'running');
  if (!book) return null;

  const href = data?.project ? `/orders?project=${encodeURIComponent(data.project)}` : '/orders';
  return (
    <RailCard
      label={`Order book · ${book.name}`}
      ariaLabel="Running order book"
      actions={<a href={href} className="text-[11px] text-primary hover:underline">Open in Order Book</a>}
    >
      <ProgressPanel book={book} />
    </RailCard>
  );
}
