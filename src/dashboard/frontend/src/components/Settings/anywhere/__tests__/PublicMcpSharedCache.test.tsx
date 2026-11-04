/**
 * PAN-4947: the Public MCP panel and the Connect-a-bot dialog (PAN-4951) read
 * `/api/mcp/public` through one query key. React Query keys data by key, not by
 * loader, so both must use `ANYWHERE_PUBLIC_MCP_QUERY_KEY` + `loadPublicMcp`.
 * `staleTime: 0` makes each observer refetch and overwrite the shared entry,
 * which is the path that crashed the panel when the dialog had its own loader.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ConnectBotDialog } from '../ConnectBotDialog';
import { PublicMcpPanel } from '../PublicMcpPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const MCP_URL = 'https://box.tail1.ts.net:8443/mcp';
const COMMANDS = [
  'tailscale funnel --bg --https=8443 --set-path=/mcp http://127.0.0.1:3011/mcp',
  'tailscale funnel --bg --https=8443 --set-path=/.well-known http://127.0.0.1:3011/.well-known',
  'tailscale funnel --bg --https=8443 --set-path=/oauth http://127.0.0.1:3011/oauth',
];
const OFF_COMMANDS = COMMANDS.map((command) => command.replace(/ --bg/, '').replace(/ http:.*$/, ' off'));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function mockServer() {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    if (input.toString() === '/api/mcp/public') {
      return Promise.resolve(jsonResponse(200, { enabled: true, funnelCommands: COMMANDS, funnelOffCommands: OFF_COMMANDS, mcpUrl: MCP_URL }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Public MCP panel and Connect-a-bot dialog share one cache entry (PAN-4947)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders both against one QueryClient without crashing, and the dialog uses the public /mcp URL', async () => {
    const fetchMock = mockServer();
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PublicMcpPanel />
        <ConnectBotDialog open onClose={() => undefined} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(COMMANDS[0] as string)).toBeInTheDocument();

    // Selecting a public-reach platform mounts the dialog's observer, which refetches the shared key.
    await user.click(screen.getByLabelText('Grok Bot'));
    await user.click(await screen.findByRole('button', { name: 'Show setup' }));

    const mcpJson = await screen.findByLabelText('Grok Bot mcp.json');
    expect(String((mcpJson as HTMLTextAreaElement).value)).toContain(MCP_URL);
    // The panel still renders the commands after the dialog's fetch.
    for (const command of COMMANDS) expect(screen.getByText(command)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => input.toString() === '/api/mcp/public').length).toBeGreaterThanOrEqual(1);
  });

  it('gives the panel the data-component the dialog scrolls to', async () => {
    mockServer();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PublicMcpPanel />
      </QueryClientProvider>,
    );
    await screen.findByText(COMMANDS[0] as string);
    expect(container.querySelector('[data-component="public-mcp-panel"]')).not.toBeNull();
  });
});
