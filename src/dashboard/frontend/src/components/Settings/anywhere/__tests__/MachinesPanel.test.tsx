import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { AnywhereSection } from '../../sections/AnywhereSection';
import { MachinesPanel } from '../MachinesPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const DESK = {
  id: 'link-1', environmentId: 'env-desk', label: 'desk', fingerprint: 'a1b2-c3d4-e5f6-0718-293a', access: 'operator', state: 'online',
  stateDetail: null, currentRoute: 'tcp://192.168.1.5:3011',
  routes: [
    { url: 'tcp://100.101.1.2:3011', kind: 'tailnet', source: 'pairing', status: 'reachable' },
    { url: 'tcp://192.168.1.5:3011', kind: 'lan', source: 'advertised', status: 'current' },
  ],
  lastHeartbeatAt: '2026-11-01T11:59:50.000Z', incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T00:00:00.000Z',
};
const LAPTOP = {
  ...DESK, id: 'link-2', environmentId: 'env-laptop', label: 'laptop', state: 'offline', stateDetail: 'tcp://10.0.0.9:3011: ECONNREFUSED',
  currentRoute: null, routes: [{ url: 'tcp://10.0.0.9:3011', kind: 'lan', source: 'pairing', status: 'unreachable' }], lastHeartbeatAt: null,
  incident: { kind: 'network', durationMs: 12_000, at: '2026-11-01T11:50:00.000Z' },
};
const MACHINES = {
  self: { environmentId: 'env-self', label: 'studio', fingerprint: '1111-2222-3333-4444-5555', shareConversations: true },
  links: [DESK, LAPTOP],
  inbound: [{ tokenId: 'tok-9', environmentId: 'env-desk', label: 'desk', fingerprint: 'a1b2-c3d4-e5f6-0718-293a', access: 'operator', createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: '2026-11-01T11:59:00.000Z' }],
};

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider>{ui}</DialogProvider>
    </QueryClientProvider>,
  );
}

function callsWith(method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);
}

describe('MachinesPanel (PAN-4645 WI-20)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/machines' && !init?.method) return Promise.resolve(jsonResponse(200, MACHINES));
      if (url === '/api/machines/link-1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true, peerNotified: true }));
      if (url === '/api/machines/inbound/tok-9' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true, inbound: null, closedChannels: 1 }));
      if (url === '/api/machines/link-2/reconnect' && init?.method === 'POST') return Promise.resolve(jsonResponse(200, { ok: true, link: LAPTOP }));
      if (url === '/api/machines/link-1/routes' && init?.method === 'POST') return Promise.resolve(jsonResponse(200, DESK));
      if (url === '/api/machines/link' && init?.method === 'POST') return Promise.resolve(jsonResponse(200, { ...DESK, id: 'link-3', label: 'phone-rig' }));
      if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, { machine: null, addresses: [], devices: { active: 0 }, vault: { state: 'off', backend: null }, problems: [], viewer: { kind: 'root-session' } }));
      if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
      if (url === '/api/machines/sharing' && init?.method === 'PUT') return Promise.resolve(jsonResponse(200, { conversations: false }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ac1: renders desk with an online badge that is blue, not green', async () => {
    renderWithProviders(<MachinesPanel />);
    const row = await screen.findByTestId('machine-link-link-1');
    const badge = within(row).getByTestId('machine-link-state');
    expect(badge).toHaveTextContent('Online');
    expect(badge.dataset.state).toBe('online');
    expect(badge.className).toContain('text-info-foreground');
    expect(badge.className).not.toMatch(/success|green|emerald|state-done/);
    expect(badge.className).not.toContain('rounded-full');
    expect(within(row).getByText(/via/)).toHaveTextContent('tcp://192.168.1.5:3011');
    expect(within(row).getByText(/Operator-level/)).toBeInTheDocument();
    expect(screen.getByText(/This machine: studio/)).toHaveTextContent('1111-2222-3333-4444-5555');
  });

  it('names the current route by its kind, so a relay route reads "via relay" (PAN-2356)', async () => {
    const relayed = {
      ...DESK,
      currentRoute: 'rtc+turn://0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234',
      routes: [...DESK.routes, { url: 'rtc+turn://0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234', kind: 'relay', source: 'directory', status: 'current' }],
    };
    fetchMock.mockImplementation((input: string | URL | Request) =>
      Promise.resolve(input.toString() === '/api/machines' ? jsonResponse(200, { ...MACHINES, links: [relayed] }) : jsonResponse(404, { error: 'not found' })));
    renderWithProviders(<MachinesPanel />);
    const row = await screen.findByTestId('machine-link-link-1');
    expect(within(row).getByText(/via/)).toHaveTextContent('via relay · rtc+turn://0b5c9e7a-4c1d-4f2e-9a3b-6d7e8f901234');
  });

  it('shows Reconnect only for the offline link, posts the reconnect, and lists inbound access', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    const desk = await screen.findByTestId('machine-link-link-1');
    const laptop = screen.getByTestId('machine-link-link-2');
    expect(within(desk).queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(within(laptop).getByTestId('machine-link-state')).toHaveTextContent('Offline');
    expect(within(laptop).getByText(/ECONNREFUSED/)).toBeInTheDocument();
    expect(within(laptop).getByText(/12 s network gap/)).toBeInTheDocument();
    await user.click(within(laptop).getByRole('button', { name: 'Reconnect' }));
    await waitFor(() => expect(callsWith('POST').map(([url]) => url)).toContain('/api/machines/link-2/reconnect'));

    const inbound = screen.getByTestId('machine-inbound-tok-9');
    expect(within(inbound).getByText('desk')).toBeInTheDocument();
    await user.click(within(inbound).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(callsWith('DELETE').map(([url]) => url)).toContain('/api/machines/inbound/tok-9'));
  });

  it('PAN-4650 WI-15: Share my conversations shows the server value and PUTs the change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    const row = await screen.findByTestId('share-conversations');
    const toggle = within(row).getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(row).toHaveTextContent("Linked machines list this machine's conversations. Turn off to hide them on the next sync.");
    await user.click(toggle);
    await waitFor(() => expect(callsWith('PUT')).toEqual([['/api/machines/sharing', expect.objectContaining({ body: JSON.stringify({ conversations: false }) })]]));
  });

  it('ac2: Unlink on desk sends DELETE /api/machines/link-1 after the confirm names desk', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    const desk = await screen.findByTestId('machine-link-link-1');
    await user.click(within(desk).getByRole('button', { name: 'Unlink' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Unlink desk?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(callsWith('DELETE')).toHaveLength(1));
    expect(callsWith('DELETE')[0]?.[0]).toBe('/api/machines/link-1');
  });

  it('declining the confirm sends nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    const desk = await screen.findByTestId('machine-link-link-1');
    await user.click(within(desk).getByRole('button', { name: 'Unlink' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(callsWith('DELETE')).toHaveLength(0);
  });

  it('expands the routes and posts an added route', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    const desk = await screen.findByTestId('machine-link-link-1');
    await user.click(within(desk).getByRole('button', { name: 'Routes (2)' }));
    const routes = within(desk).getByTestId('machine-routes-link-1');
    expect(within(routes).getByText('tcp://100.101.1.2:3011')).toBeInTheDocument();
    expect(within(routes).getByText(/lan · advertised · in use/)).toBeInTheDocument();
    await user.type(within(routes).getByLabelText('Route URL for desk'), 'tcp://10.1.1.1:3011');
    await user.click(within(routes).getByRole('button', { name: 'Add route' }));
    await waitFor(() => expect(callsWith('POST').map(([url]) => url)).toContain('/api/machines/link-1/routes'));
    const call = callsWith('POST').find(([url]) => url === '/api/machines/link-1/routes')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ url: 'tcp://10.1.1.1:3011' });
  });

  it('ac3: the Link dialog posts { pairingUrl, bothWays: true, access: operator } by default', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    await user.click(await screen.findByRole('button', { name: 'Link a machine' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link a machine' });
    expect(within(dialog).getByRole('radio', { name: /Operator-level/ })).toBeChecked();
    expect(within(dialog).getByText(/can read and control the other machine's conversations, but can never pair devices, mint tokens or change its settings/)).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: /Link both ways/ })).toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Link' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Pairing link from the other machine'), 'https://desk.tail1234.ts.net/#pair=abc');
    await user.click(within(dialog).getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(callsWith('POST').map(([url]) => url)).toContain('/api/machines/link'));
    const call = callsWith('POST').find(([url]) => url === '/api/machines/link')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ pairingUrl: 'https://desk.tail1234.ts.net/#pair=abc', bothWays: true, access: 'operator' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link a machine' })).toBeNull());
  });

  it('shows the server sentence when the link is refused', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      if (input.toString() === '/api/machines/link' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse(401, { error: 'pairing-refused', message: 'desk refused the pairing code; it expired or was already used.' }));
      }
      return Promise.resolve(jsonResponse(200, MACHINES));
    });
    renderWithProviders(<MachinesPanel />);
    await user.click(await screen.findByRole('button', { name: 'Link a machine' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link a machine' });
    await user.type(within(dialog).getByLabelText('Pairing link from the other machine'), 'https://desk/#pair=old');
    await user.click(within(dialog).getByRole('radio', { name: /Agent-fenced/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Link' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('desk refused the pairing code');
    const call = callsWith('POST').find(([url]) => url === '/api/machines/link')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ access: 'agent-fenced' });
  });

  it('renders inside Settings → Anywhere after the devices panel', async () => {
    renderWithProviders(<AnywhereSection />);
    const panel = await screen.findByTestId('machines-panel');
    const devices = document.querySelector('[data-component="anywhere-devices-panel"]')!;
    expect(devices.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('ac1/ac2 (PAN-4743): Add a Fly machine opens the Add-a-Fly-machine dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MachinesPanel />);
    const button = await screen.findByRole('button', { name: 'Add a Fly machine' });
    await user.click(button);
    expect(document.querySelector('[data-component="add-fly-machine-dialog"]')).toBeTruthy();
  });

  it('PAN-4905: button text shows "(remote off)" when self.remoteEnabled is false', async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/machines' && !init?.method) {
        return Promise.resolve(jsonResponse(200, { ...MACHINES, self: { ...MACHINES.self, remoteEnabled: false } }));
      }
      if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, { machine: null, addresses: [], devices: { active: 0 }, vault: { state: 'off', backend: null }, problems: [], viewer: { kind: 'root-session' } }));
      if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    renderWithProviders(<MachinesPanel />);
    expect(await screen.findByRole('button', { name: 'Add a Fly machine (remote off)' })).toBeTruthy();
  });
});
