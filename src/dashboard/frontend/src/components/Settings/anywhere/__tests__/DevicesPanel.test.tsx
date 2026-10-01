import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { SETTINGS_NAV_ITEMS } from '../../settingsPageConstants';
import { AnywhereSection } from '../../sections/AnywhereSection';
import { DevicesPanel } from '../DevicesPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const DEVICES = [
  { id: 'dev-1', name: 'Pixel phone', scopes: ['read', 'agents'], createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: '2026-09-29T00:00:00.000Z', revokedAt: null },
  { id: 'dev-2', name: 'Old laptop', scopes: ['admin'], createdAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-09-02T00:00:00.000Z' },
];

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

function deleteCalls() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
}

describe('DevicesPanel (PAN-4445)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/devices' && !init?.method) return Promise.resolve(jsonResponse(200, { devices: DEVICES }));
      if (url === '/api/devices/dev-1' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse(200, { ok: true, device: { ...DEVICES[0], revokedAt: '2026-09-30T00:00:00.000Z' } }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders active and revoked devices with scopes, and Revoke only on the active row', async () => {
    renderWithProviders(<DevicesPanel />);

    const active = (await screen.findByText('Pixel phone')).closest('li') as HTMLElement;
    const revoked = screen.getByText('Old laptop').closest('li') as HTMLElement;
    expect(within(active).getByText(/read, agents/)).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(within(revoked).queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(within(revoked).getByText(/^Revoked/)).toBeInTheDocument();
  });

  it('sends DELETE /api/devices/dev-1 when the in-app confirm is accepted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DevicesPanel />);

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Revoke Pixel phone?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]?.[0]).toBe('/api/devices/dev-1');
  });

  it('sends no DELETE when the confirm is declined', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DevicesPanel />);

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleteCalls()).toHaveLength(0);
  });

  it('shows the empty state when no device is paired', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { devices: [] })));
    renderWithProviders(<DevicesPanel />);
    expect(await screen.findByText('No devices are paired yet.')).toBeInTheDocument();
  });
});

describe('Settings → Anywhere (PAN-4445 FR-8)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { devices: [] }))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the Anywhere nav item immediately before Remote', () => {
    const ids = SETTINGS_NAV_ITEMS.map((item) => item.id);
    expect(ids.indexOf('anywhere')).toBeGreaterThan(-1);
    expect(ids.indexOf('remote')).toBe(ids.indexOf('anywhere') + 1);
  });

  it('renders a section with id anywhere', () => {
    const { container } = renderWithProviders(<AnywhereSection />);
    expect(container.querySelector('section#anywhere')).not.toBeNull();
  });
});
