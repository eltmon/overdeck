import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderBook } from '@overdeck/contracts';

import { OrderBookPage } from '../OrderBookPage';

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

function ordersResponse(books: BookFixture[]) {
  return Response.json({ books });
}

describe('OrderBookPage', () => {
  beforeEach(() => {
    mocks.mutationHeaders.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists active, queued, and drained books and creates a book from the strip', async () => {
    const created = book({ id: '2026-07-18-new-campaign', name: 'New campaign' });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json(created);
      return ordersResponse([running, queued, drained]);
    });
    vi.stubGlobal('fetch', fetchMock);

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
    vi.stubGlobal('fetch', vi.fn(async () => ordersResponse([running, drained])));
    render(<OrderBookPage />);

    expect(await screen.findByText('Active campaign')).toBeInTheDocument();
    expect(screen.getByText('Running').closest('[data-state]')).toHaveAttribute('data-state', 'current');

    fireEvent.click(screen.getByRole('button', { name: /Drained campaign/ }));

    expect(screen.getByText('Complete').closest('[data-state]')).toHaveAttribute('data-state', 'current');
    expect(screen.getByText('Draft').closest('[data-state]')).toHaveAttribute('data-state', 'done');
    expect(screen.getByText('Drained = run ends').closest('[data-state]')).toHaveAttribute('data-state', 'done');
  });

  it('renders DRAIN amber with attribution and OPEN as a neutral rest state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ordersResponse([draining, queued])));
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/flywheel/current') return Response.json(null);
      if (String(input) === '/api/orders/2026-07-18-active') return Response.json(running);
      return ordersResponse([running]);
    }));
    render(<OrderBookPage />);

    expect(await screen.findByText('Active campaign')).toBeInTheDocument();
    expect(screen.getByLabelText('Run settings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'progress' }));
    expect(screen.getByLabelText('Order book progress')).toBeInTheDocument();
    expect(screen.queryByLabelText('Run settings')).not.toBeInTheDocument();
  });

  it('loads detail validation, previews the brief, and starts through order routes', async () => {
    const warning = { code: 'missing-prd', issue: 'PAN-3', message: 'PAN-3 will be planned at pickup' };
    const launchable = book({ id: '2026-07-18-launch', name: 'Launchable', status: 'ready', validation: { blocks: [], warns: [warning] } });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/preview-brief')) return Response.json({ brief: '# Special orders: Launchable' });
      if (url.endsWith('/start') && init?.method === 'POST') return Response.json({ runId: 'RUN-9' });
      if (url === '/api/orders/2026-07-18-launch') return Response.json(launchable);
      return ordersResponse([launchable]);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<OrderBookPage />);

    expect(await screen.findByText(warning.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Preview brief/ }));
    expect(await screen.findByText('# Special orders: Launchable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Start run/ }));
    expect(await screen.findByText('Started RUN-9 from Launchable.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/orders/2026-07-18-launch/start', expect.objectContaining({ method: 'POST' }));
  });
});
