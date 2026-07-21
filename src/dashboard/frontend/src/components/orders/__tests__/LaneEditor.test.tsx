import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OrderBookView } from '../BookStrip';
import { LaneEditor } from '../LaneEditor';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'content-type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const book: OrderBookView = {
  id: '2026-07-18-editor',
  name: 'Editor',
  status: 'ready',
  settings: { laneAConcurrency: 2, posture: 'drain' },
  items: [
    { issue: 'PAN-1', lane: 'A', order: 1, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' },
    { issue: 'PAN-2', lane: 'A', order: 2, prereqs: ['PAN-1'], reVerify: true, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' },
    { issue: 'PAN-3', lane: 'B', order: 1, prereqs: [], reVerify: false, addedAt: '2026-07-18T12:00:00.000Z', addedBy: 'operator' },
  ],
  createdAt: '2026-07-18T12:00:00.000Z',
  updatedAt: '2026-07-18T12:00:00.000Z',
  progress: {
    total: 3,
    landed: 1,
    drained: false,
    items: [
      { issue: 'PAN-1', closed: false, parked: false, terminal: false },
      { issue: 'PAN-2', closed: false, parked: false, terminal: false },
      { issue: 'PAN-3', closed: true, parked: false, terminal: true },
    ],
  },
  itemReadiness: { 'PAN-1': { hasPrd: true }, 'PAN-2': { hasPrd: false }, 'PAN-3': { hasPrd: true } },
};

afterEach(() => vi.unstubAllGlobals());

describe('LaneEditor', () => {
  it('persists drag reordering and lane swaps through the order item endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json(book));
    vi.stubGlobal('fetch', fetchMock);
    const onBookChange = vi.fn();
    render(<LaneEditor book={book} onBookChange={onBookChange} />);

    const moving = screen.getByText('A2 · book').closest('[draggable="true"]');
    const target = screen.getByText('A1 · book').closest('[draggable="true"]');
    expect(moving).not.toBeNull();
    expect(target).not.toBeNull();
    fireEvent.dragStart(moving!);
    fireEvent.dragOver(target!);
    fireEvent.drop(target!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/2026-07-18-editor/items/PAN-2',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ lane: 'A', order: 1 }) }),
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Move PAN-1 to Lane B' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/2026-07-18-editor/items/PAN-1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ lane: 'B', order: 2 }) }),
    ));
    expect(onBookChange).toHaveBeenCalledTimes(2);
  });

  it('edits prerequisites, PRD re-verification, and plan-at-pickup holds through the item route', async () => {
    const fetchMock = vi.fn(async () => Response.json(book));
    vi.stubGlobal('fetch', fetchMock);
    render(<LaneEditor book={book} onBookChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit holds for PAN-2' }));
    fireEvent.change(screen.getByLabelText('Prerequisites for PAN-2'), { target: { value: 'PAN-7, pan-8' } });
    fireEvent.click(screen.getByLabelText('Re-verify PRD'));
    fireEvent.click(screen.getByLabelText('Plan at pickup'));
    fireEvent.click(screen.getByRole('button', { name: 'Save holds' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/orders/2026-07-18-editor/items/PAN-2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ prereqs: ['PAN-7', 'PAN-8'], reVerify: false, planAtPickup: true }),
      }),
    ));
  });

  it('keeps the holds editor open and consumes failed item mutations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'write failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })));
    render(<LaneEditor book={book} onBookChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit holds for PAN-2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save holds' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('write failed');
    expect(screen.getByLabelText('Prerequisites for PAN-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save holds' })).toBeEnabled();
  });

  it('leads with lane position, renders item chips, and uses one row status tone', () => {
    render(<LaneEditor book={book} inFlightIssues={new Set(['PAN-2'])} onBookChange={vi.fn()} />);

    expect(screen.getByText('A2 · book')).toHaveClass('font-mono');
    expect(screen.getByText('PAN-2')).toBeInTheDocument();
    expect(screen.getByText('after PAN-1')).toBeInTheDocument();
    expect(screen.getByText('re-verify')).toHaveClass('border-border');
    expect(screen.getByText('no PRD')).toBeInTheDocument();

    const held = screen.getByText('PAN-1').closest('[data-item-state]');
    const working = screen.getByText('PAN-2').closest('[data-item-state]');
    const landed = screen.getByText('PAN-3').closest('[data-item-state]');
    expect(held).toHaveAttribute('data-item-state', 'held');
    expect(held).toHaveClass('border-l-transparent');
    expect(working).toHaveAttribute('data-item-state', 'in-pipeline');
    expect(working).toHaveClass('border-l-info', 'bg-info/[0.08]');
    expect(landed).toHaveAttribute('data-item-state', 'landed');
    expect(landed).toHaveClass('border-l-success', 'bg-success/[0.08]');
  });
});
