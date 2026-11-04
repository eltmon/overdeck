/** PAN-4650 WI-19: Open preview lists the owner's ports, explains a refused port, and shows the started forward. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json' })),
}));

import type { Conversation } from '../../CommandDeck/ConversationList';
import { OpenPreviewPopover } from '../OpenPreviewPopover';

const conv = {
  id: -3, name: '@env-desk/conv-x', tmuxSession: 'conv-x', status: 'active', cwd: '/w', issueId: null, createdAt: '2026-11-01T10:00:00.000Z',
  endedAt: null, lastAttachedAt: null, sessionAlive: true, origin: 'linked', environmentId: 'env-desk', machineLabel: 'desk', machineState: 'online',
} as Conversation;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
let openMock: ReturnType<typeof vi.fn>;

function renderPopover() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OpenPreviewPopover conversation={conv} /></QueryClientProvider>);
}

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `/api/conversations/${encodeURIComponent('@env-desk/conv-x')}/preview-ports`) {
      return json({ ports: [{ port: 5173, label: 'frontend' }, { port: 6006, label: 'storybook' }] });
    }
    if (url === '/api/machines/env-desk/forwards' && init?.method === 'POST') {
      const { port } = JSON.parse(String(init.body)) as { port: number };
      return port === 3011
        ? json({ error: 'Port 3011 cannot be forwarded', code: 'port-refused' }, 403)
        : json({ id: 'fwd-1', port, localPort: 52811, url: 'http://127.0.0.1:52811' });
    }
    return json({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock);
  openMock = vi.fn();
  vi.stubGlobal('open', openMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('OpenPreviewPopover (PAN-4650 WI-19)', () => {
  it("lists the owner's preview ports from the API", async () => {
    renderPopover();
    fireEvent.click(screen.getByText('Preview'));
    expect(await screen.findByText(':5173')).toBeInTheDocument();
    expect(screen.getByText('storybook')).toBeInTheDocument();
  });

  it('shows why a refused port cannot be forwarded', async () => {
    renderPopover();
    fireEvent.click(screen.getByText('Preview'));
    fireEvent.change(screen.getByLabelText('Other port'), { target: { value: '3011' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open preview' })); });
    expect(screen.getByRole('alert').textContent).toBe('desk refuses port 3011: it is an Overdeck port');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('shows the started forward with Open on the local URL', async () => {
    renderPopover();
    fireEvent.click(screen.getByText('Preview'));
    const option = await screen.findByText(':5173');
    await act(async () => { fireEvent.click(option); });
    expect(screen.getByTestId('preview-forward').textContent).toBe('Forwarding desk:5173 → 127.0.0.1:52811');
    expect(openMock).toHaveBeenCalledWith('http://127.0.0.1:52811', '_blank', 'noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(openMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Preview :5173')).toBeInTheDocument();
  });

  it('closes on Escape (PAN-5000)', async () => {
    renderPopover();
    fireEvent.click(screen.getByText('Preview'));
    expect(await screen.findByTestId('preview-popover')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
  });

  it('closes on Escape without stopping an active forward (PAN-5000)', async () => {
    renderPopover();
    fireEvent.click(screen.getByText('Preview'));
    const option = await screen.findByText(':5173');
    await act(async () => { fireEvent.click(option); });
    expect(screen.getByText('Preview :5173')).toBeInTheDocument();
    fetchMock.mockClear();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('preview-popover')).not.toBeInTheDocument();
    expect(screen.getByText('Preview :5173')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
  });
});
