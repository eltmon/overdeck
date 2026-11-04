import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { PairedPhonesList } from '../PairedPhonesList';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const DEVICES = [
  { id: 'dev-1', name: 'Laptop browser', scopes: ['read'], createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: '2026-09-29T00:00:00.000Z', revokedAt: null },
  { id: 'phone-revoked', name: 'Old phone', kind: 'phone' as const, scopes: ['tell'], createdAt: '2026-08-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-09-02T00:00:00.000Z' },
  { id: 'phone-1', name: 'iris', kind: 'phone' as const, scopes: ['tell', 'operate'], createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-05T00:00:00.000Z', revokedAt: null },
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

describe('PairedPhonesList (PAN-4836)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/devices' && !init?.method) return Promise.resolve(jsonResponse(200, { devices: DEVICES }));
      if (url === '/api/devices/phone-1' && init?.method === 'DELETE') {
        return Promise.resolve(jsonResponse(200, { ok: true, device: { ...DEVICES[2], revokedAt: '2026-10-06T00:00:00.000Z' } }));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders only active phone rows', async () => {
    renderWithProviders(<PairedPhonesList />);

    expect(await screen.findByText('iris')).toBeInTheDocument();
    expect(screen.queryByText('Old phone')).toBeNull();
    expect(screen.queryByText('Laptop browser')).toBeNull();
  });

  it('shows the empty state when no active phone is paired', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { devices: [DEVICES[0], DEVICES[1]] })));
    renderWithProviders(<PairedPhonesList />);
    expect(await screen.findByText('No phones are paired with this machine yet.')).toBeInTheDocument();
  });

  it('sends DELETE /api/devices/phone-1 when Remove is confirmed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PairedPhonesList />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove iris?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]?.[0]).toBe('/api/devices/phone-1');
  });

  it('sends no DELETE when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PairedPhonesList />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deleteCalls()).toHaveLength(0);
  });

  it('toasts the error message on a failed DELETE', async () => {
    const { toast } = await import('sonner');
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/devices' && !init?.method) return Promise.resolve(jsonResponse(200, { devices: DEVICES }));
      if (url === '/api/devices/phone-1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(500, { error: 'boom' }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });

    const user = userEvent.setup();
    renderWithProviders(<PairedPhonesList />);

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
  });
});
