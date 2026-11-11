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

const ENVIRONMENT = {
  descriptorVersion: 1,
  environmentId: '0f0e0d0c-0000-4000-8000-000000000000',
  label: 'desk',
  platform: { os: 'linux', arch: 'x64' },
  serverVersion: '0.60.0',
  protocolVersion: 1,
  capabilities: {},
};

const LIVE_REQUEST = {
  id: 'req-live',
  name: 'Grok Bot',
  platform: 'grok-bot',
  scopes: ['read:state', 'read:conversations', 'tell'],
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  state: 'live',
  pairingString: 'overdeck-connector:/pair#v=1&e=0f0e0d0c-0000-4000-8000-000000000000&k=' + '1'.repeat(64) + '&c=odp_' + '2'.repeat(64),
};

const EXPIRED_REQUEST = {
  id: 'req-expired',
  name: 'Hermes',
  platform: 'hermes',
  scopes: ['read:state'],
  createdAt: '2026-11-10T00:00:00.000Z',
  expiresAt: '2026-11-10T00:30:00.000Z',
  state: 'expired',
};

const USED_REQUEST = {
  id: 'req-used',
  name: 'OpenClaw',
  platform: 'openclaw',
  scopes: ['read:state'],
  createdAt: '2026-11-10T00:00:00.000Z',
  expiresAt: '2026-11-10T00:30:00.000Z',
  state: 'used',
};

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function mockServer(opts: { connectors?: unknown[]; requests?: unknown[] } = {}) {
  const { connectors = CONNECTORS, requests = [] } = opts;
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/connectors' && !init?.method) return Promise.resolve(jsonResponse(200, { connectors, requests }));
    if (url === '/api/environment') return Promise.resolve(jsonResponse(200, ENVIRONMENT));
    if (url === '/api/connectors/conn-1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true }));
    if (url.startsWith('/api/connectors/requests/') && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true }));
    if (url === '/api/connectors/pairing' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse(200, { requestId: 'req-new', pairingString: LIVE_REQUEST.pairingString, expiresAt: '2026-11-11T01:00:00.000Z' }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
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
    mockServer();
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

describe('BotsPanel waiting requests (PAN-5070 W-10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useAnywhereDialogStore.setState({ dialog: null });
  });

  it('shows a live request with "expires in …" and a Copy again button that writes the message to the clipboard', async () => {
    mockServer({ connectors: [], requests: [LIVE_REQUEST] });
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel();

    const row = (await screen.findByText('Grok Bot')).closest('li') as HTMLElement;
    expect(within(row).getByText(/expires in/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy again' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Copy again' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copiedText = String(writeText.mock.calls[0]![0]);
    expect(copiedText).toContain(LIVE_REQUEST.pairingString);
  });

  it('shows an expired request with "expired" and Copy new, which posts pairing then cancels the old request', async () => {
    mockServer({ connectors: [], requests: [EXPIRED_REQUEST] });
    renderPanel();
    const user = userEvent.setup();

    const row = (await screen.findByText('Hermes')).closest('li') as HTMLElement;
    expect(within(row).getByText(/expired/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy new' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Copy new' }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(([input, init]) => input.toString() === '/api/connectors/pairing' && (init as RequestInit | undefined)?.method === 'POST');
      expect(postCalls).toHaveLength(1);
      const body = JSON.parse(String((postCalls[0]?.[1] as RequestInit).body)) as { name: string; scopes: string[]; platform: string };
      expect(body).toEqual({ name: 'Hermes', scopes: ['read:state'], platform: 'hermes' });
    });
    await waitFor(() => expect(deleteCalls().some((call) => call[0] === '/api/connectors/requests/req-expired')).toBe(true));
  });

  it('shows a used request with "code used" and Copy new', async () => {
    mockServer({ connectors: [], requests: [USED_REQUEST] });
    renderPanel();

    const row = (await screen.findByText('OpenClaw')).closest('li') as HTMLElement;
    expect(within(row).getByText(/code used/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Copy new' })).toBeInTheDocument();
  });

  it('Cancel sends a DELETE to the request route', async () => {
    mockServer({ connectors: [], requests: [LIVE_REQUEST] });
    renderPanel();
    const user = userEvent.setup();

    const row = (await screen.findByText('Grok Bot')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(deleteCalls().some((call) => call[0] === '/api/connectors/requests/req-live')).toBe(true));
  });

  it('does not show "No bots connected." when connectors are empty but a request is waiting', async () => {
    mockServer({ connectors: [], requests: [LIVE_REQUEST] });
    renderPanel();

    await screen.findByText('Grok Bot');
    expect(screen.queryByText('No bots connected.')).not.toBeInTheDocument();
  });
});
