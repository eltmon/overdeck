/**
 * The Order books page (PAN-5597). One column lists the books grouped by the
 * server-derived phase; the detail shows the selected book's header, the
 * notices that apply, one issue list and More settings; an Add issues panel
 * opens on the right. The page never re-derives a book's phase: the server
 * computes it with the same rule dispatch uses.
 *
 * Every request carries the explicit project scope (`?project=`), and the
 * books query is keyed by it, so a late response for one project can never
 * land under another.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Loader2 } from 'lucide-react';

import { AddIssuesPanel } from '../components/orders/AddIssuesPanel';
import { BookHeader } from '../components/orders/BookHeader';
import { BookIssueList } from '../components/orders/BookIssueList';
import { BookList } from '../components/orders/BookList';
import { orderBookContext, isLanded } from '../components/orders/itemStatus';
import { MoreSettings } from '../components/orders/MoreSettings';
import { bookPath, errorMessage, orderBookRequest } from '../components/orders/orderBookApi';
import type { OrderBookFindingView, OrderBookView } from '../components/orders/types';
import { FLYWHEEL_STATUS_QUERY_KEY, useFlywheelRunning } from '../lib/flywheelApi';
import { useDashboardStore } from '../lib/store';

interface OrdersPayload {
  books: OrderBookView[];
  project?: string;
}

interface RegisteredProject {
  key: string;
  name: string;
  path: string;
}

const BOOKS_REFETCH_MS = 15_000;
const REMOVABLE_FINDINGS = new Set(['issue-not-open', 'duplicate-membership']);

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function setUrlParam(name: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(name, value);
  else params.delete(name);
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

/** `?book=` when that book exists; else the active book, the first queued, the first draft. Never archived by default. */
function defaultBook(books: OrderBookView[]): OrderBookView | null {
  return books.find((book) => book.phase === 'active')
    ?? books.filter((book) => book.phase === 'queued').sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0))[0]
    ?? books.find((book) => book.phase === 'draft')
    ?? null;
}

function formatShortDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function OrderBookPage() {
  const queryClient = useQueryClient();
  const flywheelRunning = useFlywheelRunning();
  const derivedById = useDashboardStore((s) => s.derivedIssueStateByIssueId);
  const [projectKey, setProjectKey] = useState<string | null>(() => urlParam('project'));
  const [selectedId, setSelectedId] = useState<string | null>(() => urlParam('book'));
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addOpenByBook, setAddOpenByBook] = useState<Record<string, boolean>>({});
  const booksKey = ['order-books', 'page', projectKey ?? null] as const;

  const { data: registeredProjects = [] } = useQuery<RegisteredProject[]>({
    queryKey: ['registered-projects'],
    queryFn: async () => {
      const response = await fetch('/api/registered-projects');
      if (!response.ok) throw new Error('Failed to fetch registered projects');
      return response.json() as Promise<RegisteredProject[]>;
    },
    staleTime: 60_000,
  });

  const booksQuery = useQuery<OrdersPayload>({
    queryKey: booksKey,
    queryFn: () => orderBookRequest<OrdersPayload>('/api/orders', projectKey),
    refetchInterval: BOOKS_REFETCH_MS,
  });
  const books = booksQuery.data?.books ?? [];
  // A request made with an explicit project only ever carries this scope; the envelope's
  // project names the server-resolved default for an unscoped read.
  const scope = projectKey ?? booksQuery.data?.project ?? undefined;
  const shownProject = projectKey ?? booksQuery.data?.project ?? null;

  const explicit = selectedId ? books.find((book) => book.id === selectedId) ?? null : null;
  const selected = explicit ?? defaultBook(books);
  const activeBook = books.find((book) => book.phase === 'active') ?? null;

  const refreshBooks = () => {
    void queryClient.invalidateQueries({ queryKey: booksKey });
  };

  const selectBook = (bookId: string | null) => {
    setSelectedId(bookId);
    setActionError(null);
    setUrlParam('book', bookId);
  };

  const applyBook = (updated: OrderBookView) => {
    setActionError(null);
    const previous = books.find((book) => book.id === updated.id);
    queryClient.setQueryData<OrdersPayload>(booksKey, (current) => current && {
      ...current,
      books: current.books.some((book) => book.id === updated.id)
        ? current.books.map((book) => (book.id === updated.id ? updated : book))
        : [...current.books, updated],
    });
    // After an archive, move on to whichever book becomes active.
    if (updated.phase === 'archived' && previous?.phase !== 'archived' && updated.id === selected?.id) selectBook(null);
    refreshBooks();
  };

  const selectProject = (key: string) => {
    setProjectKey(key);
    setSelectedId(null);
    setActionError(null);
    setUrlParam('book', null);
    setUrlParam('project', key);
  };

  const pickerOptions = registeredProjects.map((project) => ({ key: project.key, name: project.name }));
  if (shownProject && !pickerOptions.some((option) => option.key === shownProject)) {
    pickerOptions.unshift({ key: shownProject, name: shownProject });
  }

  const createBook = async (name: string) => {
    const created = await orderBookRequest(`/api/orders`, scope, { method: 'POST', body: { name } });
    applyBook(created);
    selectBook(created.id);
  };

  const mutateSelected = async (suffix: string, method: 'PATCH' | 'DELETE', body?: unknown) => {
    if (!selected) return;
    try {
      applyBook(await orderBookRequest(bookPath(selected.id, suffix), scope, { method, body }));
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  };

  const editorProps = selected ? {
    book: selected,
    project: scope,
    onBookChange: applyBook,
    onError: setActionError,
  } : null;
  const addOpen = selected !== null && selected.phase !== 'archived'
    && (addOpenByBook[selected.id] ?? selected.phase === 'draft');
  const setAddOpen = (open: boolean) => {
    if (selected) setAddOpenByBook((current) => ({ ...current, [selected.id]: open }));
  };

  return (
    <main className="flex h-full w-full flex-col overflow-hidden bg-background" aria-label="Order books page">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-medium text-foreground">Order books</h1>
          <p className="text-[12px] text-muted-foreground">A book is a list of issues the Flywheel works through, in the order you set.</p>
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          Project
          <select
            aria-label="Order book project"
            value={shownProject ?? ''}
            onChange={(event) => selectProject(event.target.value)}
            className="max-w-[12rem] rounded-md border border-border bg-card px-1.5 py-1 text-[12px] text-foreground"
          >
            {!shownProject && <option value="">Loading…</option>}
            {pickerOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}
          </select>
        </label>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className={`grid min-w-0 gap-5 p-4 sm:p-5 ${addOpen ? 'min-[900px]:grid-cols-[250px_minmax(0,1fr)_340px]' : 'min-[900px]:grid-cols-[250px_minmax(0,1fr)]'}`}>
          <BookList
            books={books}
            selectedId={selected?.id ?? null}
            onSelect={selectBook}
            onCreate={createBook}
            creating={creating}
            onCreatingChange={setCreating}
          />

          <section className="grid min-w-0 content-start gap-4" aria-label="Selected order book">
            {booksQuery.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading order books…
              </div>
            )}
            {booksQuery.isError && (
              <div className="rounded-lg border border-destructive/[0.32] bg-destructive/[0.08] p-3 text-sm text-destructive" role="alert">
                {errorMessage(booksQuery.error)}
                <button type="button" onClick={() => void booksQuery.refetch()} className="ml-3 underline">Retry</button>
              </div>
            )}
            {booksQuery.isSuccess && books.length === 0 && (
              <div className="grid max-w-lg gap-3 rounded-lg border border-dashed border-border p-6 text-sm">
                <h2 className="text-base font-medium text-foreground">No order books yet</h2>
                <p className="text-muted-foreground">Use a book when the order of work matters: a migration, a refactor, a release push.</p>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>Create a book and add issues.</li>
                  <li>Queue it.</li>
                  <li>The Flywheel works through it.</li>
                </ol>
                <div>
                  <button type="button" onClick={() => setCreating(true)} className="rounded-md border border-primary bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">New book</button>
                </div>
              </div>
            )}
            {booksQuery.isSuccess && books.length > 0 && !selected && (
              <p className="text-sm text-muted-foreground">Select a book on the left, or create one.</p>
            )}

            {selected && editorProps && (
              <>
                <BookHeader
                  key={selected.id}
                  {...editorProps}
                  activeBookName={activeBook?.name ?? null}
                  flywheelRunning={flywheelRunning}
                  onAddIssues={() => setAddOpen(!addOpen)}
                  onStarted={() => {
                    setActionError(null);
                    void queryClient.invalidateQueries({ queryKey: FLYWHEEL_STATUS_QUERY_KEY });
                    refreshBooks();
                  }}
                />
                {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}

                <BookNotices book={selected} onArchive={() => void mutateSelected('', 'PATCH', { status: 'complete' })}
                  onResume={() => void mutateSelected('', 'PATCH', { settings: { posture: 'open', postureReason: 'Operator reopened pickup.' } })}
                  onRemove={(issue) => void mutateSelected(`/items/${encodeURIComponent(issue)}`, 'DELETE')}
                />

                {selected.phase !== 'draft' && selected.items.length > 0 && (
                  <ProgressLine book={selected} derivedById={derivedById} />
                )}

                <BookIssueList key={`list-${selected.id}`} {...editorProps} flywheelRunning={flywheelRunning} />
                <MoreSettings key={`settings-${selected.id}`} {...editorProps} />
              </>
            )}
          </section>

          {selected && editorProps && addOpen && (
            <AddIssuesPanel key={`add-${selected.id}`} {...editorProps} books={books} onClose={() => setAddOpen(false)} />
          )}
        </div>
      </div>
    </main>
  );
}

function BookNotices({ book, onArchive, onResume, onRemove }: {
  book: OrderBookView;
  onArchive: () => void;
  onResume: () => void;
  onRemove: (issue: string) => void;
}) {
  if (book.phase === 'archived') return null;
  const blocks = book.validation?.blocks ?? [];
  const warns = book.validation?.warns ?? [];
  const problemCount = blocks.length + warns.length;
  const paused = book.settings.posture === 'drain';
  const pausedOn = formatShortDate(book.settings.postureSetAt);

  const findingLine = (finding: OrderBookFindingView, warning: boolean) => (
    <li key={`${finding.code}-${finding.issue}-${finding.message}`} className="flex items-start gap-2">
      {warning && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-label="Warning" />}
      <span className="shrink-0 font-mono text-foreground">{finding.issue}</span>
      <span className="min-w-0 flex-1 text-body-foreground">{finding.message}</span>
      {!warning && REMOVABLE_FINDINGS.has(finding.code) && (
        <button type="button" onClick={() => onRemove(finding.issue)} className="shrink-0 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent">
          Remove
        </button>
      )}
    </li>
  );

  return (
    <>
      {book.phase === 'active' && book.finished && (
        <div role="status" data-notice="finished" className="flex flex-wrap items-center gap-3 rounded-lg border border-success/[0.32] bg-success/[0.08] p-3 text-xs">
          <p className="min-w-0 flex-1 text-foreground">
            All {book.progress.total} issues have landed. This book still holds the active slot, so queued books cannot start. Archive it to move on.
          </p>
          <button type="button" onClick={onArchive} className="rounded-md border border-primary bg-primary px-2.5 py-1.5 text-primary-foreground hover:opacity-90">Archive and move on</button>
        </div>
      )}
      {paused && (
        <div role="status" data-notice="paused" className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/[0.32] bg-warning/[0.08] p-3 text-xs">
          <div className="min-w-0 flex-1">
            <p className="text-foreground">Pickup is paused. Work already running will finish. Nothing new starts from this book.</p>
            <p className="mt-0.5 text-muted-foreground">
              Paused by {book.settings.postureSetBy ?? 'operator'}{pausedOn ? ` on ${pausedOn}` : ''}: &quot;{book.settings.postureReason ?? 'No reason recorded.'}&quot;
            </p>
          </div>
          <button type="button" onClick={onResume} className="rounded-md border border-border bg-card px-2.5 py-1.5 text-foreground hover:bg-accent">Resume pickup</button>
        </div>
      )}
      {problemCount > 0 && (
        <div data-notice="problems" className="rounded-lg border border-destructive/[0.32] bg-destructive/[0.08] p-3 text-xs">
          <h3 className="mb-2 font-medium text-destructive">
            {book.phase === 'draft'
              ? `${plural(problemCount, 'thing', 'things')} to fix before you can queue this book`
              : `${plural(problemCount, 'problem', 'problems')} in this book`}
          </h3>
          <ul className="grid gap-1.5">
            {blocks.map((finding) => findingLine(finding, false))}
            {warns.map((finding) => findingLine(finding, true))}
          </ul>
        </div>
      )}
    </>
  );
}

function ProgressLine({ book, derivedById }: { book: OrderBookView; derivedById: Parameters<typeof orderBookContext>[1] }) {
  const context = orderBookContext(book, derivedById, false);
  const landed = book.items.filter((item) => isLanded(context, item)).length;
  const inProgress = book.items.filter((item) => !isLanded(context, item) && context.inFlight.has(item.issue.toUpperCase())).length;
  const parked = book.items.filter((item) => !isLanded(context, item) && context.progressItems.find((entry) => entry.issue === item.issue)?.parked).length;
  const waiting = book.items.length - landed - inProgress - parked;
  const total = book.items.length;
  const parts = [
    `${landed} of ${total} landed`,
    inProgress > 0 ? `${inProgress} in progress` : '',
    waiting > 0 ? `${waiting} waiting` : '',
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-section="OrderBookProgress">
      <span className="flex h-1.5 min-w-32 flex-1 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
        <span className="h-full bg-success" style={{ width: `${(landed / total) * 100}%` }} />
        <span className="h-full bg-info" style={{ width: `${(inProgress / total) * 100}%` }} />
      </span>
      <span>{parts.join(' · ')}</span>
    </div>
  );
}
