import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { SetUpPhoneAppPanel, GOOGLE_PLAY_URL, APP_STORE_URL } from '../SetUpPhoneAppPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const ENV = '0b5c6c1e-3f2a-4d8e-9a7b-1c2d3e4f5a6b';
const KEY = 'ab'.repeat(32);
const CODE = 'odp_' + 'cd34'.repeat(16);

const SIGNED_IN_DIRECTORY = {
  signedIn: true,
  state: 'online',
  url: 'https://connect.overdeck.ai',
  plan: 'free',
  refusal: null,
  machines: [],
  approvals: [],
  joins: [],
  relay: null,
};

const SIGNED_OUT_DIRECTORY = { ...SIGNED_IN_DIRECTORY, signedIn: false, state: 'off' as const };

function environmentDescriptor(machineKey: string | undefined): unknown {
  return {
    descriptorVersion: 1,
    environmentId: ENV,
    label: 'this machine',
    platform: { os: 'linux', arch: 'x64' },
    serverVersion: '1.0.0',
    protocolVersion: 1,
    capabilities: { pairing: true, deviceSessions: true, terminalAuth: true },
    ...(machineKey === undefined ? {} : { machineKey }),
  };
}

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

function stubFetch(handlers: {
  directory?: unknown;
  environment?: unknown;
  pairingStatus?: number;
  pairingBody?: unknown;
}) {
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/directory') return Promise.resolve(jsonResponse(200, handlers.directory ?? SIGNED_IN_DIRECTORY));
    if (url === '/api/environment') return Promise.resolve(jsonResponse(200, handlers.environment ?? environmentDescriptor(KEY)));
    if (url === '/api/pairing/credentials' && init?.method === 'POST') {
      return Promise.resolve(jsonResponse(
        handlers.pairingStatus ?? 200,
        handlers.pairingBody ?? { credential: CODE, expiresAt: new Date(Date.now() + 600_000).toISOString(), pairingPath: '/pair' },
      ));
    }
    if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

describe('SetUpPhoneAppPanel (PAN-4836, epic PAN-4823 AC-8)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) renders the pairing QR with the documented link format once created', async () => {
    stubFetch({});
    const user = userEvent.setup();
    renderWithProviders(<SetUpPhoneAppPanel />);

    await user.click(await screen.findByRole('button', { name: 'Create pairing code' }));

    const img = await screen.findByAltText('Overdeck app pairing QR code');
    expect(img.getAttribute('data-qr-value')).toBe(`ai.overdeck.app:/pair#v=1&e=${ENV}&k=${KEY}&c=${CODE}`);
  });

  it('(b) shows the signed-out text and no create button when signed out', async () => {
    stubFetch({ directory: SIGNED_OUT_DIRECTORY });
    renderWithProviders(<SetUpPhoneAppPanel />);

    const text = await screen.findByTestId('phone-app-signed-out');
    expect(text.textContent).toContain('pan account login');
    expect(screen.queryByRole('button', { name: 'Create pairing code' })).toBeNull();
  });

  it('(c) shows the 403 text when the pairing route forbids it', async () => {
    stubFetch({ pairingStatus: 403, pairingBody: { error: 'forbidden' } });
    const user = userEvent.setup();
    renderWithProviders(<SetUpPhoneAppPanel />);

    await user.click(await screen.findByRole('button', { name: 'Create pairing code' }));
    expect(await screen.findByText('Pairing codes can be created only from a browser on this machine.')).toBeInTheDocument();
  });

  it('(d) shows the no-machine-key text and no button when the descriptor lacks a machine key', async () => {
    stubFetch({ environment: environmentDescriptor(undefined) });
    renderWithProviders(<SetUpPhoneAppPanel />);

    expect(await screen.findByText("Could not read this machine's identity: no machine key")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create pairing code' })).toBeNull();
  });

  it('(e) renders both store links with the documented URLs', async () => {
    stubFetch({});
    renderWithProviders(<SetUpPhoneAppPanel />);

    expect(await screen.findByRole('link', { name: 'Google Play' })).toHaveAttribute('href', GOOGLE_PLAY_URL);
    expect(screen.getByRole('link', { name: 'App Store' })).toHaveAttribute('href', APP_STORE_URL);
  });

  it('(f) still offers Create pairing code when the directory state is refused', async () => {
    stubFetch({ directory: { ...SIGNED_IN_DIRECTORY, state: 'refused', refusal: 'limit' } });
    renderWithProviders(<SetUpPhoneAppPanel />);

    expect(await screen.findByText('limit')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Create pairing code' })).toBeInTheDocument();
  });

  it('shows an environment-read error and no button when /api/environment fails', async () => {
    fetchMock = vi.fn((input: string | URL | Request) => {
      const url = input.toString();
      if (url === '/api/directory') return Promise.resolve(jsonResponse(200, SIGNED_IN_DIRECTORY));
      if (url === '/api/environment') return Promise.resolve(jsonResponse(500, { error: 'boom' }));
      if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<SetUpPhoneAppPanel />);

    expect(await screen.findByText("Could not read this machine's identity: boom")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create pairing code' })).toBeNull();
  });

  it('shows "This code expired." and offers Create another code once the pairing expires', async () => {
    stubFetch({ pairingBody: { credential: CODE, expiresAt: new Date(Date.now() - 1).toISOString(), pairingPath: '/pair' } });
    const user = userEvent.setup();
    renderWithProviders(<SetUpPhoneAppPanel />);

    await user.click(await screen.findByRole('button', { name: 'Create pairing code' }));

    await waitFor(() => expect(screen.getByText('This code expired.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Create another code' })).toBeInTheDocument();
  });
});
