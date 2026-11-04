import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildConnectorPairLink, parseConnectorPairLink } from '@overdeck/contracts';

import { ANYWHERE_PUBLIC_MCP_QUERY_KEY, ANYWHERE_STATUS_QUERY_KEY, type PublicMcpStatus } from '../anywhereApi';
import { ConnectBotDialog } from '../ConnectBotDialog';

vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

const ENVIRONMENT = {
  descriptorVersion: 1,
  environmentId: '0f0e0d0c-0000-4000-8000-000000000000',
  label: 'desk',
  platform: { os: 'linux', arch: 'x64' },
  serverVersion: '0.60.0',
  protocolVersion: 1,
  capabilities: {},
};

const PAIRING_STRING = buildConnectorPairLink({
  environmentId: '0f0e0d0c-0000-4000-8000-000000000000',
  machineKeyHex: '1'.repeat(64),
  code: `odp_${'2'.repeat(64)}`,
});

const TOKEN = 'odk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';

/** The `GET /api/mcp/public` body (PAN-4947). */
function publicMcpBody(enabled: boolean, mcpUrl: string | null): PublicMcpStatus {
  return { enabled, funnelCommands: [], funnelOffCommands: [], mcpUrl };
}

function statusBody(serveUrl: string | null) {
  return {
    machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
    addresses: [],
    devices: { active: 0 },
    vault: { state: 'off', backend: null },
    problems: [],
    tailscale: { nextStep: 'none', serveUrl, magicDnsName: null },
    viewer: { kind: 'root-session' },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockServer(opts: { pairingStatus?: number; tokenStatus?: number; serveUrl?: string | null } = {}) {
  const { pairingStatus = 200, tokenStatus = 200, serveUrl = null } = opts;
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/environment') return Promise.resolve(jsonResponse(200, ENVIRONMENT));
    if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, statusBody(serveUrl)));
    if (url === '/api/connectors/pairing' && init?.method === 'POST') {
      return Promise.resolve(pairingStatus === 200
        ? jsonResponse(200, { pairingString: PAIRING_STRING, expiresAt: '2026-11-03T00:10:00Z' })
        : jsonResponse(403, { error: 'only the internal token or the root session can manage connectors' }));
    }
    if (url === '/api/access-tokens' && init?.method === 'POST') {
      const { name, scopes } = JSON.parse(String(init.body)) as { name: string; scopes: string[] };
      return Promise.resolve(tokenStatus === 200
        ? jsonResponse(200, { token: TOKEN, record: { id: 'tok-1', name, scopes } })
        : jsonResponse(403, { error: 'only the internal token or the root session can create access tokens' }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function postedBody(path: string): { name: string; scopes: string[] } {
  const call = fetchMock.mock.calls.find(([input, init]) => input.toString() === path && (init as RequestInit | undefined)?.method === 'POST');
  return JSON.parse(String((call?.[1] as RequestInit).body)) as { name: string; scopes: string[] };
}

function postedTo(path: string): boolean {
  return fetchMock.mock.calls.some(([input, init]) => input.toString() === path && (init as RequestInit | undefined)?.method === 'POST');
}

async function renderDialog(opts: { serveUrl?: string | null; publicMcp?: PublicMcpStatus } = {}) {
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if ('serveUrl' in opts) {
    // staleTime: Infinity keeps the mount-triggered background refetch from clobbering this with mockServer's default (null) response.
    queryClient.setQueryDefaults(ANYWHERE_STATUS_QUERY_KEY, { staleTime: Infinity });
    queryClient.setQueryData(ANYWHERE_STATUS_QUERY_KEY, statusBody(opts.serveUrl ?? null));
  }
  if (opts.publicMcp) {
    queryClient.setQueryDefaults(ANYWHERE_PUBLIC_MCP_QUERY_KEY, { staleTime: Infinity });
    queryClient.setQueryData(ANYWHERE_PUBLIC_MCP_QUERY_KEY, opts.publicMcp);
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ConnectBotDialog open onClose={() => undefined} />
    </QueryClientProvider>,
  );
  return { user };
}

describe('ConnectBotDialog (PAN-4951 WI-3, WI-4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the default scopes and the default Hermes name on the default form', async () => {
    mockServer();
    const { user } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByLabelText('Pairing string');

    const body = postedBody('/api/connectors/pairing');
    expect(body.scopes).toEqual(['read:state', 'read:conversations', 'tell']);
    expect(body.name).toBe('Hermes bot');
  });

  it('adds approve to the body once it is ticked', async () => {
    mockServer();
    const { user } = await renderDialog();

    await user.click(screen.getByLabelText('Approve', { exact: false }));
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByLabelText('Pairing string');

    expect(postedBody('/api/connectors/pairing').scopes).toContain('approve');
  });

  it('renders read:state as checked and disabled, and unticking tell removes it from the body', async () => {
    mockServer();
    const { user } = await renderDialog();

    expect(screen.getByLabelText('Read state (always on)')).toBeChecked();
    expect(screen.getByLabelText('Read state (always on)')).toBeDisabled();

    await user.click(screen.getByLabelText('Send messages'));
    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));
    await screen.findByLabelText('Pairing string');

    expect(postedBody('/api/connectors/pairing').scopes).not.toContain('tell');
  });

  it('renders a parseable pairing string and the connector pair command with the server version', async () => {
    mockServer();
    const { user } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));

    const pairingField = await screen.findByLabelText('Pairing string');
    expect(parseConnectorPairLink((pairingField as HTMLInputElement).value)).not.toBeNull();

    await waitFor(() => {
      expect(String((screen.getByLabelText('Connector commands') as HTMLTextAreaElement).value))
        .toContain('npx -y @overdeck/core@0.60.0 mcp connector pair');
    });
  });

  it('explains a 403 from a browser that is not on this machine (connector)', async () => {
    mockServer({ pairingStatus: 403 });
    const { user } = await renderDialog();

    await user.click(screen.getByRole('button', { name: 'Create pairing code' }));

    expect(await screen.findByText('Only a browser on this machine can connect bots.')).toBeInTheDocument();
  });

  it('defaults Grok Build to the This computer reach and sends the default scopes to /api/access-tokens', async () => {
    mockServer();
    const { user } = await renderDialog();

    await user.click(screen.getByLabelText('Grok Build'));
    expect(screen.getByLabelText('This computer')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Create token' }));
    await screen.findByLabelText('Token setup');

    expect(postedBody('/api/access-tokens').scopes).toEqual(['read:state', 'read:conversations', 'tell']);
    expect(postedBody('/api/access-tokens').name).toBe('Grok Build bot');
  });

  it('shows the token once in Token setup, and keeps it out of the config snippet', async () => {
    mockServer();
    const { user } = await renderDialog();

    await user.click(screen.getByLabelText('Grok Build'));
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    const setupField = await screen.findByLabelText('Token setup');
    expect(String((setupField as HTMLTextAreaElement).value)).toContain(TOKEN);

    const configField = screen.getByLabelText('Grok Build config');
    expect(String((configField as HTMLTextAreaElement).value)).not.toMatch(/od[krl]_/);
  });

  it('renders the Tailscale serve URL in the Hermes config when Tailscale is set up', async () => {
    mockServer();
    const { user } = await renderDialog({ serveUrl: 'https://box.tail1.ts.net' });

    await user.click(screen.getByLabelText('Tailscale'));
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    const configField = await screen.findByLabelText('Hermes config');
    expect(String((configField as HTMLTextAreaElement).value)).toContain('url: "https://box.tail1.ts.net/mcp"');
    expect(screen.queryByText(/Tailscale Serve is not set up/)).not.toBeInTheDocument();
  });

  it('renders the placeholder and the D-10 note when Tailscale is not set up', async () => {
    mockServer();
    const { user } = await renderDialog({ serveUrl: null });

    await user.click(screen.getByLabelText('Tailscale'));
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    const configField = await screen.findByLabelText('Hermes config');
    expect(String((configField as HTMLTextAreaElement).value)).toContain('url: "https://YOUR-MACHINE.YOUR-TAILNET.ts.net/mcp"');
    expect(screen.getByText(/Tailscale Serve is not set up on this machine yet/)).toBeInTheDocument();
  });

  it('renders only the Public MCP reach for Grok Bot', async () => {
    mockServer();
    const { user } = await renderDialog({ publicMcp: publicMcpBody(false, null) });

    await user.click(screen.getByLabelText('Grok Bot'));

    expect(screen.getByLabelText('Public MCP')).toBeInTheDocument();
    expect(screen.queryByLabelText('Overdeck connector')).not.toBeInTheDocument();
  });

  it('renders "Public MCP is off" and sends no POST when the switch is off', async () => {
    mockServer();
    const { user } = await renderDialog({ publicMcp: publicMcpBody(false, null) });

    await user.click(screen.getByLabelText('Grok Bot'));

    expect(screen.getByText(/Public MCP is off/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Public MCP settings' })).toBeInTheDocument();
    expect(postedTo('/api/access-tokens')).toBe(false);
    expect(postedTo('/api/connectors/pairing')).toBe(false);
  });

  it('reads a 404 from /api/mcp/public (an older server) as off (D-6)', async () => {
    mockServer();
    const { user } = await renderDialog();

    await user.click(screen.getByLabelText('Grok Bot'));

    expect(await screen.findByText(/Public MCP is off/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => input.toString() === '/api/mcp/public')).toBe(true);
    expect(screen.getByRole('button', { name: 'Show Public MCP settings' })).toBeInTheDocument();
    expect(postedTo('/api/access-tokens')).toBe(false);
    expect(postedTo('/api/connectors/pairing')).toBe(false);
  });

  it("puts the public URL in Grok Bot's mcp.json", async () => {
    mockServer();
    const { user } = await renderDialog({
      publicMcp: publicMcpBody(true, 'https://box.tail1.ts.net:8443/mcp'),
    });

    await user.click(screen.getByLabelText('Grok Bot'));
    await user.click(screen.getByRole('button', { name: 'Show setup' }));

    const mcpJson = await screen.findByLabelText("Grok Bot mcp.json");
    expect(String((mcpJson as HTMLTextAreaElement).value)).toContain('https://box.tail1.ts.net:8443/mcp');
    expect(postedTo('/api/access-tokens')).toBe(false);
    expect(postedTo('/api/connectors/pairing')).toBe(false);
  });

  it('renders --level operate for the xAI API when operate is ticked', async () => {
    mockServer();
    const { user } = await renderDialog({
      publicMcp: publicMcpBody(true, 'https://box.tail1.ts.net:8443/mcp'),
    });

    await user.click(screen.getByLabelText('xAI API'));
    await user.click(screen.getByLabelText('Operate', { exact: false }));
    await user.click(screen.getByRole('button', { name: 'Show setup' }));

    const getToken = await screen.findByLabelText('Get a token');
    expect((getToken as HTMLInputElement).value).toContain('--level operate');
    expect(postedTo('/api/access-tokens')).toBe(false);
    expect(postedTo('/api/connectors/pairing')).toBe(false);
  });
});
