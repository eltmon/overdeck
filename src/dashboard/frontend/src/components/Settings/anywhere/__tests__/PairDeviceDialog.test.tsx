import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PairDeviceDialog } from '../PairDeviceDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function status(addresses: Array<{ origin: string; loopback: boolean }>) {
  return {
    machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
    addresses,
    devices: { active: 0 },
    vault: { state: 'off', backend: null },
    problems: [],
  };
}

const LOCAL = { origin: 'http://127.0.0.1:3011', loopback: true };
const DESK = { origin: 'https://desk.tailnet.ts.net', loopback: false };

let fetchMock: ReturnType<typeof vi.fn>;
let pairingStatus = 200;

function mockServer(addresses: Array<{ origin: string; loopback: boolean }>) {
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, status(addresses)));
    if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
    if (url === '/api/pairing/credentials' && init?.method === 'POST') {
      return Promise.resolve(pairingStatus === 200
        ? jsonResponse(200, { credential: 'odp_test', expiresAt: new Date(Date.now() + 600_000).toISOString(), pairingPath: '/#pair=odp_test' })
        : jsonResponse(403, { error: 'only the internal token or the root session can issue pairing credentials' }));
    }
    if (url === '/api/anywhere/trusted-origins' && init?.method === 'POST') {
      const { origin } = JSON.parse(String(init.body)) as { origin: string };
      return Promise.resolve(jsonResponse(200, { origin, added: true }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PairDeviceDialog open onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('PairDeviceDialog (PAN-4445)', () => {
  beforeEach(() => {
    pairingStatus = 200;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a pairing link for a trusted reachable address and shows its QR code', async () => {
    mockServer([LOCAL, DESK]);
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() => expect(screen.getByLabelText('Address the other device opens')).toHaveValue('https://desk.tailnet.ts.net'));
    await user.click(screen.getByRole('button', { name: 'Create pairing link' }));

    expect(await screen.findByLabelText('Pairing link')).toHaveValue('https://desk.tailnet.ts.net/#pair=odp_test');
    const qr = screen.getByAltText('Pairing QR code');
    expect(qr.getAttribute('src')).toMatch(/^data:image\//);
    expect(screen.getByText(/works once/)).toBeInTheDocument();
  });

  it('offers to trust a typed address and posts it to /api/anywhere/trusted-origins', async () => {
    mockServer([LOCAL]);
    const user = userEvent.setup();
    renderDialog();

    expect(await screen.findByText(/Other devices need an address they can reach/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create pairing link' })).toBeDisabled();
    await user.type(screen.getByLabelText('Address'), 'https://desk.example.test');
    await user.click(await screen.findByRole('button', { name: 'Add to trusted addresses' }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url]) => url === '/api/anywhere/trusted-origins');
      expect(post).toBeDefined();
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ origin: 'https://desk.example.test' });
    });
  });

  it('explains instead of showing a link when pairing credentials are refused with 403', async () => {
    mockServer([LOCAL, DESK]);
    pairingStatus = 403;
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() => expect(screen.getByLabelText('Address the other device opens')).toHaveValue('https://desk.tailnet.ts.net'));
    await user.click(screen.getByRole('button', { name: 'Create pairing link' }));

    expect(await screen.findByText(/Pairing links can be created only from a browser on this machine/)).toBeInTheDocument();
    expect(screen.queryByAltText('Pairing QR code')).toBeNull();
    expect(screen.queryByLabelText('Pairing link')).toBeNull();
  });

  it('allows a this-machine-only link and labels it', async () => {
    mockServer([LOCAL]);
    const user = userEvent.setup();
    renderDialog();

    await screen.findByText(/Other devices need an address they can reach/);
    const select = screen.getByLabelText('Address the other device opens');
    const localOption = Array.from((select as HTMLSelectElement).options).find((option) => option.text.startsWith('Use this machine only'));
    await user.selectOptions(select, localOption!.value);
    await user.click(screen.getByRole('button', { name: 'Create pairing link' }));

    expect(await screen.findByText('Works only on this machine')).toBeInTheDocument();
    expect((screen.getByLabelText('Pairing link') as HTMLInputElement).value).toMatch(/^http:\/\/[^/]+\/#pair=odp_test$/);
  });
});
