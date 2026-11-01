/**
 * PAN-4404 WI-11: the Add an SSH machine dialog (config-host suggestions, Test,
 * Add, server error text) and the SSH-backed row's Remove confirmation in the
 * Machines panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { AddSshMachineDialog } from '../AddSshMachineDialog';
import { MachinesPanel } from '../MachinesPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const SSH = { destination: 'me@desk', launch: 'managed', forward: 'up', forwardDetail: null, localPort: 41234, remotePort: 3011 };
const DESK = {
  id: 'link-1', environmentId: 'env-desk', label: 'desk', fingerprint: 'a1b2-c3d4-e5f6-0718-293a', access: 'operator', state: 'online',
  stateDetail: null, currentRoute: 'tcp://127.0.0.1:41234',
  routes: [{ url: 'tcp://127.0.0.1:41234', kind: 'ssh', source: 'pairing', status: 'current' }],
  lastHeartbeatAt: null, incident: null, peerVersion: '0.72.0', createdAt: '2026-11-01T00:00:00.000Z',
  ssh: SSH,
};

let fetchMock: ReturnType<typeof vi.fn>;
let routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>;

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

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([input]) => input.toString() === url);
}

beforeEach(() => {
  routes = {
    'GET /api/machines/ssh/config-hosts': () => ({ status: 200, body: { hosts: ['desk', 'vps'] } }),
    'GET /api/machines': () => ({ status: 200, body: { self: { environmentId: 'env-self', label: 'studio', fingerprint: '1111-2222-3333-4444-5555' }, links: [DESK], inbound: [] } }),
  };
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input.toString()}`;
    const handler = routes[key];
    return Promise.resolve(handler ? jsonResponse(handler(init).status, handler(init).body) : jsonResponse(404, { error: `no route ${key}` }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddSshMachineDialog (PAN-4404 WI-11)', () => {
  it('lists the SSH config hosts as suggestions', async () => {
    renderWithProviders(<AddSshMachineDialog open onClose={() => undefined} />);
    await waitFor(() => {
      const options = screen.getByTestId('add-ssh-config-hosts').querySelectorAll('option');
      expect([...options].map((o) => o.getAttribute('value'))).toEqual(['desk', 'vps']);
    });
  });

  it('Test shows the version sentence from the response', async () => {
    routes['POST /api/machines/ssh/test'] = () => ({
      status: 200,
      body: { reachable: true, panVersion: '0.72.0', localVersion: '0.72.0', versionMatches: true, error: null, message: null },
    });
    renderWithProviders(<AddSshMachineDialog open onClose={() => undefined} />);
    await userEvent.type(screen.getByLabelText('SSH host'), 'desk');
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByTestId('add-ssh-test-result')).toHaveTextContent('Reached desk: pan 0.72.0. It matches this machine.');
    expect(JSON.parse(String((callsTo('/api/machines/ssh/test')[0]![1] as RequestInit).body))).toEqual({ host: 'desk' });
  });

  it('Add posts { host, bothWays: true } and closes on 200', async () => {
    routes['POST /api/machines/ssh'] = () => ({ status: 200, body: DESK });
    const onClose = vi.fn();
    renderWithProviders(<AddSshMachineDialog open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('SSH host'), 'desk');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(JSON.parse(String((callsTo('/api/machines/ssh')[0]![1] as RequestInit).body))).toEqual({ host: 'desk', bothWays: true });
  });

  it('a 409 version-mismatch shows the server message', async () => {
    const message = 'desk has pan 0.71.0 and this machine has 0.72.0. Install the same version there with: npm install -g @overdeck/core@0.72.0';
    routes['POST /api/machines/ssh'] = () => ({ status: 409, body: { error: 'version-mismatch', message } });
    const onClose = vi.fn();
    renderWithProviders(<AddSshMachineDialog open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('SSH host'), 'desk');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('SSH-backed machine row (PAN-4404 WI-11)', () => {
  it('shows the SSH line, and a managed Remove offers to keep the server and calls ?keepServer=1', async () => {
    routes['DELETE /api/machines/link-1?keepServer=1'] = () => ({ status: 200, body: { ok: true, peerNotified: true, ssh: { stopped: false, reason: 'kept' } } });
    renderWithProviders(<MachinesPanel />);
    expect(await screen.findByTestId('machine-ssh-link-1')).toHaveTextContent('SSH me@desk · forward up · Started by Overdeck');
    await userEvent.click(within(screen.getByTestId('machine-link-link-1')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Overdeck started the server on me@desk. Removing this machine stops that server.');
    await userEvent.click(within(dialog).getByLabelText('Leave the server running'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(callsTo('/api/machines/link-1?keepServer=1')).toHaveLength(1));
  });

  it('an external row says the server keeps running and has no checkbox', async () => {
    routes['GET /api/machines'] = () => ({
      status: 200,
      body: { self: { environmentId: 'env-self', label: 'studio', fingerprint: '1111-2222-3333-4444-5555' }, links: [{ ...DESK, ssh: { ...SSH, launch: 'external' } }], inbound: [] },
    });
    routes['DELETE /api/machines/link-1'] = () => ({ status: 200, body: { ok: true, peerNotified: true, ssh: { stopped: false, reason: 'external' } } });
    renderWithProviders(<MachinesPanel />);
    await userEvent.click(within(await screen.findByTestId('machine-link-link-1')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('The server on me@desk keeps running.');
    expect(within(dialog).queryByLabelText('Leave the server running')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(callsTo('/api/machines/link-1')).toHaveLength(1));
  });
});
