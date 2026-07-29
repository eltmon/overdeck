import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';

import { AddIssuesRail } from '../components/orders/AddIssuesRail';
import { BacklogCandidatesRail } from '../components/orders/BacklogCandidatesRail';
import { BookStrip, type OrderBookView } from '../components/orders/BookStrip';
import { LaneEditor } from '../components/orders/LaneEditor';
import { LifecycleStrip } from '../components/orders/LifecycleStrip';
import { ProgressPanel } from '../components/orders/ProgressPanel';
import { RunSettingsPanel } from '../components/orders/RunSettingsPanel';
import { ValidationPanel } from '../components/orders/ValidationPanel';
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
  const [preview, setPreview] = useState<string | null>(null);
  const [view, setView] = useState<'setup' | 'progress'>('setup');
  const [starting, setStarting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

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

  const updateBook = useCallback((updated: OrderBookView) => {
    setBooks((current) => current.map((book) => book.id === updated.id ? updated : book));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    void fetch(`/api/orders/${encodeURIComponent(selectedId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json() as Promise<OrderBookView>;
      })
      .then((book) => { if (current) updateBook(book); })
      .catch((cause) => { if (current) setActionMessage(cause instanceof Error ? cause.message : String(cause)); });
    return () => { current = false; };
  }, [selectedId, updateBook]);

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

  const patchBook = async (patch: Record<string, unknown>) => {
    if (!selected) return;
    const response = await fetch(`/api/orders/${encodeURIComponent(selected.id)}`, {
      method: 'PATCH', credentials: 'include', headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error(await readError(response));
    updateBook(await response.json() as OrderBookView);
  };

  const patchSettings = async (patch: Partial<OrderBookView['settings']>) => {
    await patchBook({ settings: patch });
  };

  const queueBook = async () => {
    if (!selected) return;
    setStarting(true);
    setActionMessage(null);
    try {
      await patchBook({ status: 'ready' });
      setActionMessage(`${selected.name} is queued and ready to start.`);
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const previewBrief = async () => {
    if (!selected) return;
    setActionMessage(null);
    const response = await fetch(`/api/orders/${encodeURIComponent(selected.id)}/preview-brief`);
    if (!response.ok) {
      setActionMessage(await readError(response));
      return;
    }
    const payload = await response.json() as { brief: string };
    setPreview(payload.brief);
  };

  const openRunReport = async (runId: string) => {
    const response = await fetch('/api/flywheel/report/open', {
      method: 'POST', credentials: 'include', headers: await dashboardMutationJsonHeaders(),
      body: JSON.stringify({ runId }),
    });
    if (!response.ok) setActionMessage(await readError(response));
  };

  const startRun = async () => {
    if (!selected) return;
    setStarting(true);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(selected.id)}/start`, {
        method: 'POST', credentials: 'include', headers: await dashboardMutationJsonHeaders(),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { runId: string };
      setActionMessage(`Started ${payload.runId} from ${selected.name}.`);
      await loadBooks();
    } catch (cause) {
      setActionMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
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
            <div className="ml-auto flex rounded-md border border-border p-0.5 text-[10px]" aria-label="Order book view">
              {(['setup', 'progress'] as const).map((value) => (
                <button key={value} type="button" aria-pressed={view === value} onClick={() => setView(value)} className={`rounded-sm px-2.5 py-1 capitalize ${view === value ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>{value}</button>
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground">
              {view === 'setup' ? <><span className="font-mono text-foreground">{selected.progress.landed}</span>/<span className="font-mono text-foreground">{selected.progress.total}</span> landed</> : 'Live progress below'}
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

            {view === 'setup' ? <>
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

            <LaneEditor book={selected} onBookChange={updateBook} />

            <section className="grid gap-3 lg:grid-cols-2" aria-label="Add issues to order book">
              <AddIssuesRail book={selected} books={books} onBookChange={updateBook} />
              <BacklogCandidatesRail book={selected} onBookChange={updateBook} />
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <RunSettingsPanel key={selected.id} settings={selected.settings} onChange={patchSettings} />
              <ValidationPanel
                status={selected.status}
                blocks={selected.validation?.blocks ?? []}
                warns={selected.validation?.warns ?? []}
                starting={starting}
                onPreview={() => void previewBrief()}
                onQueue={() => void queueBook()}
                onStart={() => void startRun()}
              />
            </section>

            {actionMessage && <p className="text-xs text-muted-foreground" role="status">{actionMessage}</p>}
            {preview && (
              <section className="rounded-lg border border-border bg-card p-4" aria-label="Brief preview">
                <div className="mb-2 flex items-center">
                  <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Brief preview</h2>
                  <button type="button" className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setPreview(null)}>Close</button>
                </div>
                <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{preview}</pre>
              </section>
            )}
            </> : <ProgressPanel book={selected} onOpenReport={(runId) => void openRunReport(runId)} />}
          </div>
        )}
      </div>
    </main>
  );
}
