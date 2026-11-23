import { act, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderBookStatus } from '@overdeck/contracts';

import type { OrderBookView } from '../../components/orders/types';
import { OrderBookPage } from '../OrderBookPage';

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

const at = '2026-11-22T12:00:00.000Z';

interface FixtureBook {
  id: string;
  name: string;
  status: OrderBookStatus;
  issues?: string[];
  finished?: boolean;
}

/** The server's phase rule (PAN-5599): the running book, else the first ready book that isn't finished, is active. */
function withPhases(books: FixtureBook[]): OrderBookView[] {
  const live = books.filter((book) => book.status !== 'draft' && book.status !== 'complete');
  const active = live.find((book) => book.status === 'running') ?? live.find((book) => !book.finished);
  const numbered = live.filter((book) => book === active || !book.finished);
  const queue = active ? [active, ...numbered.filter((book) => book !== active)] : numbered;
  return books.map((book) => {
    const issues = book.issues ?? ['PAN-1'];
    const phase = book.status === 'complete' ? 'archived' : book.status === 'draft' ? 'draft' : book === active ? 'active' : 'queued';
    return {
      id: book.id,
      name: book.name,
      status: book.status,
      phase,
      queuePosition: (phase === 'active' || phase === 'queued') && queue.includes(book) ? queue.indexOf(book) + 1 : null,
      finished: book.finished ?? false,
      settings: { laneAConcurrency: 2, posture: 'open' },
      items: issues.map((issue, index) => ({ issue, lane: 'A', order: index + 1, prereqs: [], reVerify: false, addedAt: at, addedBy: 'operator' })),
      createdAt: at,
      updatedAt: at,
      progress: {
        total: issues.length,
        landed: book.finished ? issues.length : 0,
        drained: book.finished ?? false,
        items: issues.map((issue) => ({ issue, closed: book.finished ?? false, parked: false, terminal: book.finished ?? false })),
      },
      validation: { blocks: [], warns: [] },
    };
  });
}

const projects = [
  { key: 'panopticon-cli', name: 'Overdeck', path: '/home/dev/overdeck' },
  { key: 'mind-your-now', name: 'Mind Your Now', path: '/home/dev/myn' },
];

type Handler = (url: string, init?: RequestInit) => Promise<Response | undefined> | Response | undefined;

/** A fake orders API over `books`; `override` answers a request first when it returns a response. */
function fakeServer(books: FixtureBook[], options: { project?: string; override?: Handler } = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/registered-projects') return Response.json(projects);
    if (url === '/api/flywheel/status') return Response.json({ run: 'running' });
    if (url.startsWith('/api/orders/backlog-candidates')) return Response.json({ candidates: [] });
    const overridden = await options.override?.(url, init);
    if (overridden) return overridden;
    const path = url.split('?')[0]!;
    if (path === '/api/orders' && (!init || init.method === undefined)) {
      return Response.json({ books: withPhases(books), ...(options.project ? { project: options.project } : {}) });
    }
    const match = /^\/api\/orders\/([^/]+)$/.exec(path);
    if (match && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { status?: OrderBookStatus };
      const book = books.find((entry) => entry.id === decodeURIComponent(match[1]!))!;
      if (body.status) book.status = body.status;
      return Response.json(withPhases(books).find((entry) => entry.id === book.id));
    }
    return Response.json({ error: `unexpected ${init?.method ?? 'GET'} ${url}` }, { status: 500 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function bookRow(id: string): HTMLElement {
  return document.querySelector(`[data-book="${id}"]`) as HTMLElement;
}

function header(): HTMLElement {
  return document.querySelector('[data-section="OrderBookHeader"]') as HTMLElement;
}

function patchBodies(fetchMock: ReturnType<typeof vi.fn>, id: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input).split('?')[0] === `/api/orders/${id}` && (init as RequestInit | undefined)?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe('OrderBookPage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/orders');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('selects the active book by default and the book named in ?book= when present', async () => {
    const books: FixtureBook[] = [
      { id: 'draft', name: 'Draft book', status: 'draft' },
      { id: 'active', name: 'Active book', status: 'ready' },
      { id: 'queued', name: 'Queued book', status: 'ready' },
      { id: 'old', name: 'Old book', status: 'complete' },
    ];
    fakeServer(books);
    const { unmount } = render(<OrderBookPage />);

    await waitFor(() => expect(bookRow('active')).toHaveAttribute('aria-current', 'true'));
    expect(within(header()).getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('Drained = run ends')).toBeNull();
    expect(screen.queryByRole('button', { name: /setup/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /progress/i })).toBeNull();
    expect(screen.queryByText('Book old')).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Add issues' })).toBeNull();
    unmount();

    window.history.replaceState(null, '', '/orders?book=draft');
    render(<OrderBookPage />);
    await waitFor(() => expect(bookRow('draft')).toHaveAttribute('aria-current', 'true'));
    expect(screen.getByRole('complementary', { name: 'Add issues' })).toBeInTheDocument();
  });

  it('queues a draft and shows it as queued', async () => {
    const books: FixtureBook[] = [
      { id: 'active', name: 'Active book', status: 'ready' },
      { id: 'draft', name: 'Draft book', status: 'draft' },
    ];
    const fetchMock = fakeServer(books);
    window.history.replaceState(null, '', '/orders?book=draft');
    render(<OrderBookPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Queue book' }));
    await waitFor(() => expect(within(header()).getByText('Queued · #2')).toBeInTheDocument());
    expect(patchBodies(fetchMock, 'draft')).toEqual([{ status: 'ready' }]);
    expect(within(bookRow('draft')).getByText('#2')).toBeInTheDocument();
  });

  it('moves a queued book back to draft', async () => {
    const books: FixtureBook[] = [
      { id: 'active', name: 'Active book', status: 'ready' },
      { id: 'queued', name: 'Queued book', status: 'ready' },
    ];
    const fetchMock = fakeServer(books);
    window.history.replaceState(null, '', '/orders?book=queued');
    render(<OrderBookPage />);

    fireEvent.click(await within(await screen.findByRole('region', { name: 'Selected order book' })).findByRole('button', { name: 'Move back to draft' }));
    await waitFor(() => expect(within(header()).getByText('Draft')).toBeInTheDocument());
    expect(patchBodies(fetchMock, 'queued')).toEqual([{ status: 'draft' }]);
  });

  it('opens the next unfinished book as active and archives a finished queued book from its header', async () => {
    const books: FixtureBook[] = [
      { id: 'done', name: 'Finished book', status: 'ready', finished: true },
      { id: 'next', name: 'Next book', status: 'ready' },
    ];
    const fetchMock = fakeServer(books);
    window.history.replaceState(null, '', '/orders');
    render(<OrderBookPage />);

    await waitFor(() => expect(within(header()).getByText('Active')).toBeInTheDocument());
    expect(within(header()).getByRole('button', { name: 'Next book' })).toBeInTheDocument();

    fireEvent.click(within(bookRow('done')).getByText('Finished book'));
    await waitFor(() => expect(within(header()).getByRole('button', { name: 'Finished book' })).toBeInTheDocument());
    expect(within(header()).getByText('Finished')).toBeInTheDocument();
    expect(within(header()).getByText('Every issue has landed. The Flywheel skips this book. Archive it to tidy the list.')).toBeInTheDocument();

    fireEvent.click(within(header()).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(patchBodies(fetchMock, 'done')).toEqual([{ status: 'complete' }]));
  });

  it('restores an archived book as a draft', async () => {
    const books: FixtureBook[] = [{ id: 'old', name: 'Old book', status: 'complete' }];
    const fetchMock = fakeServer(books);
    window.history.replaceState(null, '', '/orders?book=old');
    render(<OrderBookPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Restore as draft' }));
    await waitFor(() => expect(within(header()).getByText('Draft')).toBeInTheDocument());
    expect(patchBodies(fetchMock, 'old')).toEqual([{ status: 'draft' }]);
  });

  it('shows the server error when restore is refused', async () => {
    const books: FixtureBook[] = [
      { id: 'old', name: 'Old book', status: 'complete' },
      { id: 'b2', name: 'Live book', status: 'ready' },
    ];
    const message = 'Order book old cannot be restored: PAN-1 already belongs to order book b2';
    fakeServer(books, {
      override: (url, init) => (init?.method === 'PATCH' ? Response.json({ error: message }, { status: 409 }) : undefined),
    });
    window.history.replaceState(null, '', '/orders?book=old');
    render(<OrderBookPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Restore as draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(within(header()).getByText('Archived')).toBeInTheDocument();
  });

  it('never shows the still-holds-the-active-slot notice', async () => {
    const books: FixtureBook[] = [
      { id: 'done', name: 'Finished book', status: 'ready', finished: true },
      { id: 'queued-done', name: 'Finished queued book', status: 'ready', finished: true },
    ];
    fakeServer(books);
    render(<OrderBookPage />);

    await waitFor(() => expect(within(header()).getByRole('button', { name: 'Finished book' })).toBeInTheDocument());
    expect(screen.queryByText(/holds the active slot/)).toBeNull();
    fireEvent.click(within(bookRow('queued-done')).getByText('Finished queued book'));
    await waitFor(() => expect(within(header()).getByRole('button', { name: 'Finished queued book' })).toBeInTheDocument());
    expect(screen.queryByText(/holds the active slot/)).toBeNull();
  });

  it('lists registered projects by name in the picker and defaults to the envelope project', async () => {
    fakeServer([{ id: 'active', name: 'Active book', status: 'ready' }], { project: 'panopticon-cli' });
    render(<OrderBookPage />);

    const picker = await screen.findByLabelText<HTMLSelectElement>('Order book project');
    await waitFor(() => expect([...picker.options].map((option) => [option.value, option.text])).toEqual([
      ['panopticon-cli', 'Overdeck'],
      ['mind-your-now', 'Mind Your Now'],
    ]));
    await waitFor(() => expect(picker.value).toBe('panopticon-cli'));
  });

  it('scopes every fetch to the selected project', async () => {
    const mynBooks: FixtureBook[] = [{ id: 'myn', name: 'MYN book', status: 'ready' }];
    const fetchMock = fakeServer([{ id: 'active', name: 'Active book', status: 'ready' }], {
      project: 'panopticon-cli',
      override: (url, init) => {
        if (url === '/api/orders?project=mind-your-now') return Response.json({ books: withPhases(mynBooks), project: 'mind-your-now' });
        if (url === '/api/orders/myn?project=mind-your-now' && init?.method === 'PATCH') {
          mynBooks[0]!.status = 'draft';
          return Response.json(withPhases(mynBooks)[0]);
        }
        return undefined;
      },
    });
    render(<OrderBookPage />);

    await waitFor(() => expect(bookRow('active')).not.toBeNull());
    fireEvent.change(await screen.findByLabelText('Order book project'), { target: { value: 'mind-your-now' } });
    await waitFor(() => expect(bookRow('myn')).not.toBeNull());
    expect(bookRow('active')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('project')).toBe('mind-your-now');

    fireEvent.click(within(header()).getByRole('button', { name: 'Move back to draft' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders/myn?project=mind-your-now', expect.objectContaining({ method: 'PATCH' })));
  });

  it('scopes the first read to a deep-linked project and shows it as the current selection', async () => {
    window.history.replaceState(null, '', '/orders?project=mind-your-now');
    const fetchMock = fakeServer([{ id: 'myn', name: 'MYN book', status: 'ready' }], { project: 'mind-your-now' });
    render(<OrderBookPage />);

    await waitFor(() => expect(bookRow('myn')).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/orders?project=mind-your-now', undefined);
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Order book project').value).toBe('mind-your-now'));
  });

  it('ignores a stale project-A list response that resolves after switching to project B', async () => {
    let resolveA: (() => void) | undefined;
    let resolveB: (() => void) | undefined;
    fakeServer([], {
      override: async (url) => {
        if (url === '/api/orders') {
          await new Promise<void>((resolve) => { resolveA = resolve; });
          return Response.json({ books: withPhases([{ id: 'a', name: 'Project A book', status: 'ready' }]), project: 'panopticon-cli' });
        }
        if (url === '/api/orders?project=mind-your-now') {
          await new Promise<void>((resolve) => { resolveB = resolve; });
          return Response.json({ books: withPhases([{ id: 'b', name: 'Project B book', status: 'ready' }]), project: 'mind-your-now' });
        }
        return undefined;
      },
    });

    render(<OrderBookPage />);
    await waitFor(() => expect(resolveA).toBeDefined());
    fireEvent.change(await screen.findByLabelText('Order book project'), { target: { value: 'mind-your-now' } });
    await waitFor(() => expect(resolveB).toBeDefined());

    resolveB!();
    await waitFor(() => expect(bookRow('b')).not.toBeNull());
    resolveA!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bookRow('b')).not.toBeNull();
    expect(bookRow('a')).toBeNull();
  });

  it('refetches books on the 15 second interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    window.history.replaceState(null, '', '/orders?project=mind-your-now');
    const fetchMock = fakeServer([{ id: 'myn', name: 'MYN book', status: 'ready' }], { project: 'mind-your-now' });
    render(<OrderBookPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const listReads = () => fetchMock.mock.calls.filter(([input]) => String(input) === '/api/orders?project=mind-your-now').length;
    expect(listReads()).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(listReads()).toBe(2);
  });
});
