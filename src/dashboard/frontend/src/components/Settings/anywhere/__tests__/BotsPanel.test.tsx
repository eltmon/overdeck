import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { useAnywhereDialogStore } from '../anywhereDialogStore';
import { BotsPanel } from '../BotsPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const CONNECTORS = [
  { id: 'conn-1', name: 'Hermes bot', scopes: ['read:state', 'read:conversations', 'tell'], createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-30T00:00:00.000Z' },
];

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider><BotsPanel /></DialogProvider>
    </QueryClientProvider>,
  );
}

function deleteCalls() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
}

describe('BotsPanel (PAN-4951 WI-7)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/connectors' && !init?.method) return Promise.resolve(jsonResponse(200, { connectors: CONNECTORS }));
      if (url === '/api/connectors/conn-1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    useAnywhereDialogStore.setState({ dialog: null });
  });

  it('renders a connector with its scopes joined by ", "', async () => {
    renderPanel();
    const row = (await screen.findByText('Hermes bot')).closest('li') as HTMLElement;
    expect(within(row).getByText(/read:state, read:conversations, tell/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('sends DELETE /api/connectors/conn-1 when the confirm is accepted', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('The connector loses access at once.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]?.[0]).toBe('/api/connectors/conn-1');
  });

  it('shows the empty state', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { connectors: [] })));
    renderPanel();
    expect(await screen.findByText('No bots connected.')).toBeInTheDocument();
  });

  it('explains a 403 from a browser that is not on this machine, and hides the button', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, { error: 'only the internal token or the root session can manage connectors' })));
    renderPanel();
    expect(await screen.findByText('Only a browser on this machine can manage bots.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect a bot' })).toBeNull();
  });

  it("opens the connect-bot dialog when 'Connect a bot' is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Connect a bot' }));

    expect(useAnywhereDialogStore.getState().dialog).toBe('connect-bot');
  });
});
