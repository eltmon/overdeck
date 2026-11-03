import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MachinesNavItem } from '../MachinesNavItem';
import { requestSettingsSection } from '../../../lib/settingsSection';

vi.mock('../../../lib/settingsSection', () => ({ requestSettingsSection: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;
let machinesBody: unknown;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function link(state: string) {
  return { id: `link-${state}-${Math.random()}`, environmentId: `env-${state}`, label: state, fingerprint: 'a', access: 'operator', state, stateDetail: null, currentRoute: null, routes: [], lastHeartbeatAt: null, incident: null, peerVersion: '0.73.0', createdAt: '2026-11-01T00:00:00.000Z' };
}

beforeEach(() => {
  fetchMock = vi.fn((input: string | URL | Request) => {
    const url = input.toString();
    if (url === '/api/machines') return Promise.resolve(jsonResponse(200, machinesBody));
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(requestSettingsSection).mockClear();
});

function renderItem(collapsed: boolean, onOpenSettings = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MachinesNavItem collapsed={collapsed} onOpenSettings={onOpenSettings} />
    </QueryClientProvider>,
  );
  return { onOpenSettings };
}

describe('MachinesNavItem (PAN-4869)', () => {
  it('shows the online count', async () => {
    machinesBody = { self: { environmentId: 'env-self', label: 'studio', fingerprint: 'x', shareConversations: true }, links: [link('online'), link('online'), link('offline')], inbound: [] };
    renderItem(false);
    expect(await screen.findByTestId('sidebar-machines-online')).toHaveTextContent('2');
  });

  it('hides the badge with no online machine', async () => {
    machinesBody = { self: { environmentId: 'env-self', label: 'studio', fingerprint: 'x', shareConversations: true }, links: [link('offline'), link('offline')], inbound: [] };
    renderItem(false);
    await screen.findByTestId('sidebar-machines');
    expect(screen.queryByTestId('sidebar-machines-online')).toBeNull();
  });

  it('hides the badge when the response is malformed', async () => {
    machinesBody = {};
    renderItem(false);
    await screen.findByTestId('sidebar-machines');
    expect(screen.queryByTestId('sidebar-machines-online')).toBeNull();
  });

  it('opens Settings → Anywhere', async () => {
    machinesBody = { self: { environmentId: 'env-self', label: 'studio', fingerprint: 'x', shareConversations: true }, links: [], inbound: [] };
    const user = userEvent.setup();
    const { onOpenSettings } = renderItem(false);
    await user.click(screen.getByTestId('sidebar-machines'));
    expect(requestSettingsSection).toHaveBeenCalledTimes(1);
    expect(requestSettingsSection).toHaveBeenCalledWith('anywhere');
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('collapsed shows the count in the title only', async () => {
    machinesBody = { self: { environmentId: 'env-self', label: 'studio', fingerprint: 'x', shareConversations: true }, links: [link('online'), link('online')], inbound: [] };
    renderItem(true);
    const button = await screen.findByTestId('sidebar-machines');
    await waitFor(() => expect(button.getAttribute('title')).toBe('Machines · 2 online'));
    expect(screen.queryByText('Machines')).toBeNull();
    expect(screen.queryByTestId('sidebar-machines-online')).toBeNull();
  });
});
