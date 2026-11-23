/**
 * One request door for the order-book components (PAN-5597). Every call is
 * scoped with `?project=` and every failure throws the server's own `error`
 * text, or the HTTP status text when the body has none, so the page can show
 * it as is.
 */
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import { withProject } from './projectScope';
import type { OrderBookView } from './types';

export async function orderBookRequest<T = OrderBookView>(
  path: string,
  project: string | null | undefined,
  init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const response = await fetch(withProject(path, project), method === 'GET' ? undefined : {
    method,
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: unknown }) | null;
  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : response.statusText || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

export function bookPath(bookId: string, suffix = ''): string {
  return `/api/orders/${encodeURIComponent(bookId)}${suffix}`;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Props every order-book editing component takes; all but `book` are optional for read-only use. */
export interface OrderBookEditorProps {
  book: OrderBookView;
  /** Sent as `?project=` on every request. */
  project?: string;
  /** Called with the server's returned book after a successful mutation. */
  onBookChange?: (book: OrderBookView) => void;
  /** Called with the server's error text after a failed mutation. */
  onError?: (message: string) => void;
}
