import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TailscalePhoneQr } from '../TailscalePhoneQr';
import { AnywhereSection } from '../../sections/AnywhereSection';
import { DialogProvider } from '../../../DialogProvider';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));
vi.mock('../../../XTerminal', () => ({ XTerminal: () => <div data-testid="x-terminal" /> }));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

describe('TailscalePhoneQr (PAN-1254)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the app download QR and the account to sign in with', () => {
    render(<TailscalePhoneQr loginName="me@example.com" onPair={() => undefined} />);
    expect(screen.getByRole('img', { name: 'Tailscale app download QR code' })).toBeInTheDocument();
    expect(screen.getByText(/sign in as me@example\.com/)).toBeInTheDocument();
  });

  it('calls onPair once for Pair a device', async () => {
    const user = userEvent.setup();
    const onPair = vi.fn();
    render(<TailscalePhoneQr loginName="me@example.com" onPair={onPair} />);
    await user.click(screen.getByRole('button', { name: 'Pair a device' }));
    expect(onPair).toHaveBeenCalledTimes(1);
  });
});

describe('Set up Tailscale ready step (PAN-1254)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      const url = input.toString();
      if (url.startsWith('/api/tailscale/status')) {
        return Promise.resolve(jsonResponse(200, {
          state: {
            installed: true,
            mode: 'system',
            version: '1.104.4',
            daemonRunning: true,
            backendState: 'Running',
            authUrl: null,
            magicDnsName: 'desk.tailnet.ts.net',
            serveUrl: 'https://desk.tailnet.ts.net',
            loginName: 'me@example.com',
            serve: { proxiesDashboard: true, otherHandlerOn443: false, funnelOn443: false },
            requireTokenMint: true,
            nextStep: 'ready',
          },
          install: { kind: 'pane', command: 'curl -fsSL https://tailscale.com/install.sh | sh' },
          operatorCommand: null,
          port: 3011,
          platform: 'linux',
          userspaceAvailable: false,
        }));
      }
      if (url === '/api/anywhere/status') {
        return Promise.resolve(jsonResponse(200, {
          machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
          addresses: [{ origin: 'https://desk.tailnet.ts.net', loopback: false }],
          devices: { active: 0 },
          vault: { state: 'off', backend: null },
          problems: [],
          tailscale: { nextStep: 'ready', serveUrl: 'https://desk.tailnet.ts.net', magicDnsName: 'desk.tailnet.ts.net' },
          viewer: { kind: 'root-session' },
        }));
      }
      if (url === '/api/devices') return Promise.resolve(jsonResponse(200, { devices: [] }));
      if (url === '/api/tailscale/peers') return Promise.resolve(jsonResponse(200, { peers: [] }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the phone QR, and Pair a device swaps the setup dialog for the pair dialog', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <DialogProvider>
          <AnywhereSection />
        </DialogProvider>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Set up Tailscale' }));
    const setup = await screen.findByRole('dialog', { name: 'Set up Tailscale' });
    expect(await within(setup).findByRole('img', { name: 'Tailscale app download QR code' })).toBeInTheDocument();

    await user.click(within(setup).getByRole('button', { name: 'Pair a device' }));
    expect(screen.queryByRole('dialog', { name: 'Set up Tailscale' })).toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Pair a device' })).toBeInTheDocument();
  });
});
