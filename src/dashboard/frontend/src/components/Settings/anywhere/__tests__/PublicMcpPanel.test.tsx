import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { PublicMcpPanel } from '../PublicMcpPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const COMMANDS = [
  'tailscale funnel --bg --https=8443 --set-path=/mcp http://127.0.0.1:3011/mcp',
  'tailscale funnel --bg --https=8443 --set-path=/.well-known http://127.0.0.1:3011/.well-known',
  'tailscale funnel --bg --https=8443 --set-path=/oauth http://127.0.0.1:3011/oauth',
];
const OFF_COMMANDS = [
  'tailscale funnel --https=8443 --set-path=/mcp off',
  'tailscale funnel --https=8443 --set-path=/.well-known off',
  'tailscale funnel --https=8443 --set-path=/oauth off',
];

let state: { enabled: boolean; mcpUrl: string | null };
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function body() {
  return { enabled: state.enabled, funnelCommands: COMMANDS, funnelOffCommands: OFF_COMMANDS, mcpUrl: state.mcpUrl };
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PublicMcpPanel />
    </QueryClientProvider>,
  );
}

describe('PublicMcpPanel (PAN-4947)', () => {
  beforeEach(() => {
    state = { enabled: false, mcpUrl: 'https://m.t.ts.net:8443/mcp' };
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/mcp/public' && !init?.method) return Promise.resolve(jsonResponse(200, body()));
      if (url === '/api/mcp/public' && init?.method === 'PUT') {
        state.enabled = (JSON.parse(String(init.body)) as { enabled: boolean }).enabled;
        return Promise.resolve(jsonResponse(200, body()));
      }
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the off line and no Funnel commands while off', async () => {
    renderPanel();
    expect(await screen.findByText('Off. Funnel requests to /mcp and the sign-in pages get 404.')).toBeInTheDocument();
    expect(screen.queryByText(/tailscale funnel --bg/)).toBeNull();
    expect(screen.getByText(/Anyone on the internet can reach the sign-in page/)).toBeInTheDocument();
  });

  it('sends PUT /api/mcp/public with {"enabled":true} when the switch is clicked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('switch'));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT');
      expect(put?.[0]).toBe('/api/mcp/public');
      expect((put?.[1] as RequestInit).body).toBe('{"enabled":true}');
    });
    expect(await screen.findByText(COMMANDS[0] as string)).toBeInTheDocument();
  });

  it('shows the three commands and the public URL while on', async () => {
    state.enabled = true;
    renderPanel();
    for (const command of COMMANDS) expect(await screen.findByText(command)).toBeInTheDocument();
    expect(screen.getByText('https://m.t.ts.net:8443/mcp')).toBeInTheDocument();
  });

  it('shows the trusted-address hint when there is no public URL', async () => {
    state = { enabled: true, mcpUrl: null };
    renderPanel();
    expect(await screen.findByText(/as a trusted address to see the public URL/)).toBeInTheDocument();
  });

  it('copies the first command', async () => {
    state.enabled = true;
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    renderPanel();
    await screen.findByText(COMMANDS[0] as string);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Copy Funnel command 1' }));
    expect(writeText).toHaveBeenCalledWith(COMMANDS[0]);
  });
});
