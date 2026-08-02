import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderBook } from '@overdeck/contracts';

import { OrderBookPage } from '../OrderBookPage';

// The page reads the project picker's options through react-query (PAN-3427), so
// every render must sit under a QueryClientProvider.
function render(ui: Parameters<typeof rtlRender>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

const mocks = vi.hoisted(() => ({
  mutationHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: mocks.mutationHeaders,
  subscribeFlywheelStatus: mocks.subscribe,
}));

interface BookFixture extends OrderBook {
  progress: { bookId: string; total: number; landed: number; drained: boolean; items: [] };
  validation?: { blocks: Array<{ code: string; issue: string; message: string }>; warns: Array<{ code: string; issue: string; message: string }> };
  itemReadiness?: Record<string, { hasPrd: boolean }>;
}

function book(overrides: Partial<BookFixture> & Pick<BookFixture, 'id' | 'name'>): BookFixture {
  const status = overrides.status ?? 'draft';
  return {
    id: overrides.id,
    name: overrides.name,
    status,
    settings: overrides.settings ?? { laneAConcurrency: 2, posture: 'open' },
    items: overrides.items ?? [],
    runId: overrides.runId,
    createdAt: overrides.createdAt ?? '2026-07-18T12:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-07-18T12:00:00.000Z',
    progress: overrides.progress ?? { bookId: overrides.id, total: 0, landed: 0, drained: status === 'complete', items: [] },
    validation: overrides.validation,
    itemReadiness: overrides.itemReadiness,
  };
}

const running = book({ id: '2026-07-18-active', name: 'Active campaign', status: 'running', runId: 'RUN-8' });
const queued = book({ id: '2026-07-18-queued', name: 'Queued campaign', status: 'ready' });
const drained = book({ id: '2026-07-18-drained', name: 'Drained campaign', status: 'complete', runId: 'RUN-7' });
const draining = book({
  id: '2026-07-18-hold',
  name: 'Drain hold',
  status: 'ready',
  settings: {
    laneAConcurrency: 1,
    posture: 'drain',
    postureSetAt: '2026-07-17T10:00:00.000Z',
    postureSetBy: 'operator',
    postureReason: 'hold pickup until PAN-2820 verifies on main',
  },
});

function ordersResponse(books: BookFixture[], project?: string) {
  return Response.json(project ? { books, project } : { books });
}

const projects = [
  { key: 'panopticon-cli', name: 'panopticon-cli', path: '/home/dev/overdeck' },
  { key: 'mind-your-now', name: 'mind-your-now', path: '/home/dev/myn' },
];

/**
 * Answers the picker's registered-projects read before delegating, so each test
 * only has to describe the orders traffic it cares about.
 */
function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/registered-projects') return Response.json(projects);
    return handler(input, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('OrderBookPage', () => {
  beforeEach(() => {
    mocks.mutationHeaders.mockClear();
    window.history.replaceState(null, '', '/orders');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists active, queued, and drained books and creates a book from the strip', async () => {
    const created = book({ id: '2026-07-18-new-campaign', name: 'New campaign' });
    const fetchMock = stubFetch(async (_input, init) => {
      if (init?.method === 'POST') return Response.json(created);
      return ordersResponse([running, queued, drained]);
    });

    render(<OrderBookPage />);

    expect(await screen.findByText('Active campaign')).toBeInTheDocument();
    expect(screen.getByText('Queued campaign')).toBeInTheDocument();
    expect(screen.getByText('Drained campaign')).toBeInTheDocument();
    expect(screen.getByText(/retro ✓/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /New book/ }));
    fireEvent.change(screen.getByLabelText('Book name'), { target: { value: 'New campaign' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ name: 'New campaign' }),
    })));
    expect(mocks.mutationHeaders).toHaveBeenCalledOnce();
    expect(await screen.findByText('New campaign')).toBeInTheDocument();
  });

  it('marks the current lifecycle status and advances completed books through every prior step', async () => {
    stubFetch(async () => ordersResponse([running, drained]));
    render(<OrderBookPage />);

    expect(await screen.findByText('Active campaign')).toBeInTheDocument();
    expect(screen.getByText('Running').closest('[data-state]')).toHaveAttribute('data-state', 'current');

    fireEvent.click(screen.getByRole('button', { name: /Drained campaign/ }));

    expect(screen.getByText('Complete').closest('[data-state]')).toHaveAttribute('data-state', 'current');
    expect(screen.getByText('Draft').closest('[data-state]')).toHaveAttribute('data-state', 'done');
    expect(screen.getByText('Drained = run ends').closest('[data-state]')).toHaveAttribute('data-state', 'done');
  });

  it('renders DRAIN amber with attribution and OPEN as a neutral rest state', async () => {
    stubFetch(async () => ordersResponse([draining, queued]));
    render(<OrderBookPage />);

    expect(await screen.findByText('Drain hold')).toBeInTheDocument();
    const posture = screen.getByTestId('order-book-posture');
    expect(posture).toHaveAttribute('data-posture', 'drain');
    expect(posture).toHaveClass('border-warning/[0.32]', 'bg-warning/[0.08]');
    expect(screen.getByText(/Drain set by operator on 2026-07-17/)).toHaveTextContent('hold pickup until PAN-2820 verifies on main');

    fireEvent.click(screen.getByRole('button', { name: /Queued campaign/ }));

    expect(posture).toHaveAttribute('data-posture', 'open');
    expect(posture).toHaveClass('border-border', 'bg-card');
    expect(posture).not.toHaveClass('border-warning/[0.32]');
    expect(screen.getByText(/no operator hold is active/)).toBeInTheDocument();
  });

  it('toggles from setup controls to the live progress checklist', async () => {
    stubFetch(async (input) => {
      if (String(input) === '/api/flywheel/current') return Response.json(null);
      if (String(input) === '/api/orders/2026-07-18-active') return Response.json(running);
      return ordersResponse([running]);
    });
    render(<OrderBookPage />);

    expect(await screen.findByText('Active campaign')).toBeInTheDocument();
    expect(screen.getByLabelText('Run settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'progress' }));
    expect(screen.getByLabelText('Order book progress')).toBeInTheDocument();
    expect(screen.queryByLabelText('Run settings')).not.toBeInTheDocument();
  });

  it('queues a valid draft through the lifecycle write route', async () => {
    const draft = book({ id: '2026-07-18-draft', name: 'Draft campaign', validation: { blocks: [], warns: [] } });
    const ready = { ...draft, status: 'ready' as const };
    const fetchMock = stubFetch(async (input, init) => {
      const url = String(input);
      if (url === '/api/orders/2026-07-18-draft' && init?.method === 'PATCH') return Response.json(ready);
      if (url === '/api/orders/2026-07-18-draft') return Response.json(draft);
      return ordersResponse([draft]);
    });
    render(<OrderBookPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Queue book/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders/2026-07-18-draft', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'ready' }),
    })));
    expect(await screen.findByText('Draft campaign is queued and ready to start.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start run/ })).toBeEnabled();
  });

  it('lists every registered project in the picker and defaults to the one the envelope names', async () => {
    stubFetch(async () => ordersResponse([running], 'panopticon-cli'));
    render(<OrderBookPage />);

    const picker = await screen.findByLabelText<HTMLSelectElement>('Order book project');
    await waitFor(() => expect([...picker.options].map((option) => option.value)).toEqual([
      'panopticon-cli',
      'mind-your-now',
    ]));
    await waitFor(() => expect(picker.value).toBe('panopticon-cli'));
  });

  it('scopes every orders fetch to the selected project and renders that project books', async () => {
    const other = book({ id: '2026-07-18-myn', name: 'MYN campaign', status: 'ready', validation: { blocks: [], warns: [] } });
    const fetchMock = stubFetch(async (input) => {
      const url = String(input);
      if (url.startsWith('/api/orders?project=mind-your-now')) return ordersResponse([other], 'mind-your-now');
      if (url.startsWith('/api/orders/2026-07-18-myn?project=mind-your-now')) return Response.json(other);
      return ordersResponse([running], 'panopticon-cli');
    });
    render(<OrderBookPage />);

    expect(await screen.findByText('Active campaign')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Order book project'), { target: { value: 'mind-your-now' } });

    expect(await screen.findByText('MYN campaign')).toBeInTheDocument();
    expect(screen.queryByText('Active campaign')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/orders?project=mind-your-now');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders/2026-07-18-myn?project=mind-your-now'));
    expect(new URLSearchParams(window.location.search).get('project')).toBe('mind-your-now');

    // Mutations must land in the same state root the books were read from.
    fireEvent.click(screen.getByRole('button', { name: /Preview brief/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/orders/2026-07-18-myn/preview-brief?project=mind-your-now'));
  });

  it('scopes the first read to a deep-linked project and shows it as the current selection', async () => {
    window.history.replaceState(null, '', '/orders?project=mind-your-now');
    const other = book({ id: '2026-07-18-myn', name: 'MYN campaign', status: 'ready' });
    const fetchMock = stubFetch(async (input) => {
      if (String(input).startsWith('/api/orders/')) return Response.json(other);
      return ordersResponse([other], 'mind-your-now');
    });
    render(<OrderBookPage />);

    expect(await screen.findByText('MYN campaign')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/orders?project=mind-your-now');
    await waitFor(() => expect(
      screen.getByLabelText<HTMLSelectElement>('Order book project').value,
    ).toBe('mind-your-now'));
  });

  it('ignores a stale project-A list response that resolves after switching to project B', async () => {
    const projectABook = book({ id: '2026-07-18-a', name: 'Project A campaign' });
    const projectBBook = book({ id: '2026-07-18-b', name: 'Project B campaign', status: 'ready' });
    let resolveA: (() => void) | undefined;
    let resolveB: (() => void) | undefined;

    stubFetch(async (input) => {
      const url = String(input);
      if (url === '/api/orders') {
        await new Promise<void>((resolve) => { resolveA = resolve; });
        return ordersResponse([projectABook], 'panopticon-cli');
      }
      if (url === '/api/orders?project=mind-your-now') {
        await new Promise<void>((resolve) => { resolveB = resolve; });
        return ordersResponse([projectBBook], 'mind-your-now');
      }
      return ordersResponse([]);
    });

    render(<OrderBookPage />);
    await waitFor(() => expect(resolveA).toBeDefined());

    fireEvent.change(await screen.findByLabelText('Order book project'), { target: { value: 'mind-your-now' } });
    await waitFor(() => expect(resolveB).toBeDefined());

    // Resolve the new selection first, then let the superseded project-A
    // request land late — it must not clobber project B's rendered books.
    resolveB!();
    expect(await screen.findByText('Project B campaign')).toBeInTheDocument();
    resolveA!();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByText('Project B campaign')).toBeInTheDocument();
    expect(screen.queryByText('Project A campaign')).not.toBeInTheDocument();
  });

  it('loads detail validation, previews the brief, and starts through order routes', async () => {
    const warning = { code: 'missing-prd', issue: 'PAN-3', message: 'PAN-3 will be planned at pickup' };
    const launchable = book({ id: '2026-07-18-launch', name: 'Launchable', status: 'ready', validation: { blocks: [], warns: [warning] } });
    const fetchMock = stubFetch(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/preview-brief')) return Response.json({ brief: '# Special orders: Launchable' });
      if (url.endsWith('/start') && init?.method === 'POST') return Response.json({ runId: 'RUN-9' });
      if (url === '/api/orders/2026-07-18-launch') return Response.json(launchable);
      return ordersResponse([launchable]);
    });
    render(<OrderBookPage />);

    expect(await screen.findByText(warning.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Preview brief/ }));
    expect(await screen.findByText('# Special orders: Launchable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(await screen.findByText('Started RUN-9 from Launchable.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/2026-07-18-launch/start', expect.objectContaining({ method: 'POST' }));
  });
});
