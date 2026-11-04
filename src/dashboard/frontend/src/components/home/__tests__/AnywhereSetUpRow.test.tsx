import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AnywhereSetUpRow } from '../AnywhereSetUpRow';
import { requestSettingsSection } from '../../../lib/settingsSection';

vi.mock('../../../lib/settingsSection', () => ({ requestSettingsSection: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;
let machinesBody: unknown;
let statusBody: unknown;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/machines') return Promise.resolve(jsonResponse(200, machinesBody));
    if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, statusBody));
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(requestSettingsSection).mockClear();
});

function renderRow(onOpenSettings = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnywhereSetUpRow setUpLabel="Set up" onOpenSettings={onOpenSettings} />
    </QueryClientProvider>,
  );
  return { onOpenSettings };
}

describe('AnywhereSetUpRow (PAN-4869 D13)', () => {
  it('shows the row when nothing is linked and Tailscale is not ready', async () => {
    machinesBody = { self: null, links: [], inbound: [] };
    statusBody = { tailscale: { nextStep: 'login', serveUrl: null, magicDnsName: null }, viewer: { kind: 'root-session' } };
    renderRow();
    const row = await screen.findByTestId('get-set-up-anywhere');
    expect(row).toHaveTextContent('Reach this machine from anywhere');
    expect(row).toHaveTextContent('Set up');
  });

  it('hides the row when a machine is linked', async () => {
    machinesBody = { self: null, links: [{ id: 'l1', environmentId: 'env-desk', label: 'desk', fingerprint: 'a', access: 'operator', state: 'online', stateDetail: null, currentRoute: null, routes: [], lastHeartbeatAt: null, incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T00:00:00.000Z' }], inbound: [] };
    statusBody = { tailscale: { nextStep: 'login', serveUrl: null, magicDnsName: null }, viewer: { kind: 'root-session' } };
    renderRow();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/machines'));
    expect(screen.queryByTestId('get-set-up-anywhere')).toBeNull();
  });

  it('hides the row when Tailscale is ready', async () => {
    machinesBody = { self: null, links: [], inbound: [] };
    statusBody = { tailscale: { nextStep: 'ready', serveUrl: 'https://desk.tailnet.ts.net', magicDnsName: 'desk.tailnet.ts.net' }, viewer: { kind: 'root-session' } };
    renderRow();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/anywhere/status'));
    expect(screen.queryByTestId('get-set-up-anywhere')).toBeNull();
  });

  it('hides the row on malformed data', async () => {
    machinesBody = { ok: true, allRequiredFound: true, checks: [] };
    statusBody = { ok: true, allRequiredFound: true, checks: [] };
    renderRow();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/machines'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/anywhere/status'));
    expect(screen.queryByTestId('get-set-up-anywhere')).toBeNull();
  });

  it('Set up opens Settings → Anywhere', async () => {
    machinesBody = { self: null, links: [], inbound: [] };
    statusBody = { tailscale: { nextStep: 'login', serveUrl: null, magicDnsName: null }, viewer: { kind: 'root-session' } };
    const user = userEvent.setup();
    const { onOpenSettings } = renderRow();
    const row = await screen.findByTestId('get-set-up-anywhere');
    await user.click(screen.getByRole('button', { name: 'Set up' }));
    expect(requestSettingsSection).toHaveBeenCalledWith('anywhere');
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(row).toBeTruthy();
  });
});
