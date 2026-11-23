/**
 * The active order book in the Flywheel rail (PAN-3964 FR-12, PAN-5597).
 * Reads `GET /api/orders` and renders the active book — the one the server
 * marks `phase: 'active'`, which is the book dispatch works from — with its
 * read-only issue list. Renders nothing when no book is active.
 */
import { useQuery } from '@tanstack/react-query';

import { useFlywheelRunning } from '../../lib/flywheelApi';
import { BookIssueList } from '../orders/BookIssueList';
import type { OrderBookView } from '../orders/types';
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
  const flywheelRunning = useFlywheelRunning();
  const books = data?.books ?? [];
  const book = (bookId ? books.find((b) => b.id === bookId) : undefined) ?? books.find((b) => b.phase === 'active');
  if (!book) return null;

  const params = new URLSearchParams();
  if (data?.project) params.set('project', data.project);
  params.set('book', book.id);
  return (
    <RailCard
      label={`Order book · ${book.name}`}
      ariaLabel="Active order book"
      actions={<a href={`/orders?${params.toString()}`} className="text-[11px] text-primary hover:underline">Open in Order books</a>}
    >
      <BookIssueList book={book} readOnly flywheelRunning={flywheelRunning} />
    </RailCard>
  );
}
