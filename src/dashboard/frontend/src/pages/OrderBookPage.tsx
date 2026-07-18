import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';

import { BookStrip, type OrderBookView } from '../components/orders/BookStrip';
import { LifecycleStrip } from '../components/orders/LifecycleStrip';
import { dashboardMutationJsonHeaders } from '../lib/wsTransport';

interface OrdersPayload {
  books: OrderBookView[];
}

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`;
}

export function OrderBookPage() {
  const [books, setBooks] = useState<OrderBookView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBooks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/orders');
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as OrdersPayload;
      setBooks(payload.books);
      setSelectedId((current) => {
        if (current && payload.books.some((book) => book.id === current)) return current;
        return payload.books.find((book) => book.status === 'running')?.id
          ?? payload.books.find((book) => book.status === 'ready' || book.status === 'draft')?.id
          ?? payload.books[0]?.id
          ?? null;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  const selected = useMemo(
    () => books.find((book) => book.id === selectedId) ?? null,
    [books, selectedId],
  );

  const createBook = async (name: string) => {
    const response = await fetch('/api/orders', {
      method: 'POST',
      credentials: 'include',
      headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!response.ok) throw new Error(await readError(response));
    const created = await response.json() as OrderBookView;
    setBooks((current) => [...current, created]);
    setSelectedId(created.id);
  };

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background font-medium" aria-label="Order Book page">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <div>
          <h1 className="text-sm font-medium text-foreground">Order Book</h1>
          <p className="text-[11px] text-muted-foreground">Operator special orders executed with lane semantics</p>
        </div>
        {selected && (
          <>
            <span className="ml-2 border-l border-border pl-3 font-mono text-[11px] text-muted-foreground">{selected.id}</span>
            <span className="rounded-sm border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{selected.status}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              <span className="font-mono text-foreground">{selected.progress.landed}</span>/<span className="font-mono text-foreground">{selected.progress.total}</span> landed
              {selected.runId && <> · run <span className="font-mono text-foreground">{selected.runId}</span></>}
            </span>
          </>
        )}
      </header>

      <BookStrip books={books} selectedId={selectedId} onSelect={setSelectedId} onCreate={createBook} />

      <div className="flex-1 overflow-auto p-5">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading order books…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            {error}
            <button type="button" onClick={() => void loadBooks()} className="ml-3 underline">Retry</button>
          </div>
        )}
        {!loading && !error && !selected && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No order books yet. Create one to assemble a Flywheel campaign.
          </div>
        )}
        {!loading && selected && (
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <LifecycleStrip status={selected.status} />

            <section
              data-testid="order-book-posture"
              data-posture={selected.settings.posture}
              className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${
                selected.settings.posture === 'drain'
                  ? 'border-warning/[0.32] bg-warning/[0.08]'
                  : 'border-border bg-card'
              }`}
            >
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Pickup posture</span>
              <span className={`rounded-sm border px-2 py-1 text-[11px] font-medium ${
                selected.settings.posture === 'drain'
                  ? 'border-warning/[0.32] bg-warning/[0.08] text-warning-foreground'
                  : 'border-border bg-muted/40 text-foreground'
              }`}
              >{selected.settings.posture.toUpperCase()}</span>
              <p className="text-xs text-muted-foreground">
                {selected.settings.posture === 'drain'
                  ? `Drain set by ${selected.settings.postureSetBy ?? 'operator'}${selected.settings.postureSetAt ? ` on ${selected.settings.postureSetAt.slice(0, 10)}` : ''} — ${selected.settings.postureReason ?? 'No reason recorded.'}`
                  : 'Open posture permits eligible order-book items to dispatch; no operator hold is active.'}
              </p>
            </section>

            <section className="grid gap-3 sm:grid-cols-2" aria-label="Order book lanes">
              {(['A', 'B'] as const).map((lane) => {
                const items = selected.items.filter((item) => item.lane === lane);
                return (
                  <div key={lane} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-baseline gap-2">
                      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Lane {lane}</h2>
                      <span className="text-[11px] text-muted-foreground">{lane === 'A' ? `parallel · up to ${selected.settings.laneAConcurrency}` : 'strictly serial · one in flight'}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{items.length} items</span>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">Lane editing and eligibility controls appear in the book editor.</p>
                  </div>
                );
              })}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
