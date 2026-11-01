import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SetUpPhoneDialog } from '../SetUpPhoneDialog';
import { requestSettingsSection } from '../../../../lib/settingsSection';

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));
vi.mock('../../../../lib/settingsSection', () => ({ requestSettingsSection: vi.fn() }));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

const DESK = { origin: 'https://desk.tailnet.ts.net', loopback: false };
const CODE = `odp_${'cd34'.repeat(16)}`;

let requireTokenMint = true;
let pairingStatus = 200;
let addresses: Array<{ origin: string; loopback: boolean }> = [DESK];

function mockServer() {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/settings') return Promise.resolve(jsonResponse(200, { dashboard: { require_token_mint: requireTokenMint } }));
    if (url === '/api/anywhere/status') {
      return Promise.resolve(jsonResponse(200, {
        machine: null, addresses, devices: { active: 0 }, vault: { state: 'off', backend: null }, problems: [], viewer: { kind: 'root-session' },
      }));
    }
    if (url === '/api/pairing/credentials' && init?.method === 'POST') {
      return Promise.resolve(pairingStatus === 200
        ? jsonResponse(200, { credential: CODE, expiresAt: new Date(Date.now() + 600_000).toISOString(), pairingPath: `/#pair=${CODE}` })
        : jsonResponse(403, { error: 'forbidden' }));
    }
    if (url === '/api/anywhere/trusted-origins' && init?.method === 'POST') {
      const { origin } = JSON.parse(String(init.body)) as { origin: string };
      return Promise.resolve(jsonResponse(200, { origin, added: true }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  }));
}

function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SetUpPhoneDialog open onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('SetUpPhoneDialog (PAN-2355)', () => {
  beforeEach(() => {
    requireTokenMint = true;
    pairingStatus = 200;
    addresses = [DESK];
    vi.mocked(requestSettingsSection).mockClear();
    mockServer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hides step 4 and links to the setting while require_token_mint is off', async () => {
    requireTokenMint = false;
    const user = userEvent.setup();
    renderDialog();
    const open = await screen.findByRole('button', { name: 'Open the setting' });
    expect(screen.queryByRole('heading', { name: /Scan the pairing code/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create pairing link' })).not.toBeInTheDocument();
    await user.click(open);
    expect(requestSettingsSection).toHaveBeenCalledWith('access-tokens');
  });

  it('creates a phone link at the chosen https address', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Create pairing link' }));
    expect(await screen.findByLabelText('Pairing link')).toHaveValue(`https://desk.tailnet.ts.net/m#pair=${CODE}`);
    expect(screen.getByAltText('Pairing QR code')).toHaveAttribute('data-qr-value', `https://desk.tailnet.ts.net/m#pair=${CODE}`);
  });

  it('offers only trusted non-loopback https addresses and refuses an http one', async () => {
    addresses = [
      { origin: 'http://192.168.1.5:3011', loopback: false },
      { origin: 'http://localhost:3011', loopback: true },
      DESK,
    ];
    const user = userEvent.setup();
    renderDialog();
    const select = await screen.findByLabelText('Phone address');
    await waitFor(() => expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual(['https://desk.tailnet.ts.net']));
    await user.type(screen.getByLabelText('Add an https:// address'), 'http://x');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('A phone app needs an https:// address.')).toBeInTheDocument();
  });

  it('shows two QR codes for an iPhone, the first opening the app', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'iPhone' }));
    await user.click(screen.getByRole('button', { name: 'Create pairing link' }));
    expect(await screen.findByAltText('Phone app QR code')).toHaveAttribute('data-qr-value', 'https://desk.tailnet.ts.net/m');
    expect(screen.getByAltText('Pairing QR code')).toHaveAttribute('data-qr-value', `https://desk.tailnet.ts.net/m#pair=${CODE}`);
  });

  it('explains a 403 from the pairing route', async () => {
    pairingStatus = 403;
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Create pairing link' }));
    expect(await screen.findByText('Pairing links can be created only from a browser on this machine.')).toBeInTheDocument();
  });
});
