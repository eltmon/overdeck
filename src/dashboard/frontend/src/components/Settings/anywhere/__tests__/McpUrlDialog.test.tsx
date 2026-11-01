import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { McpUrlDialog } from '../McpUrlDialog';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

const STATUS = {
  machine: { environmentId: '0f0e0d0c-0000-4000-8000-000000000000', label: 'desk' },
  addresses: [
    { origin: 'http://127.0.0.1:3011', loopback: true },
    { origin: 'http://192.168.1.20:3011', loopback: false },
    { origin: 'https://desk.tailnet.ts.net', loopback: false },
  ],
  devices: { active: 0 },
  vault: { state: 'off', backend: null },
  problems: [],
  viewer: { kind: 'root-session' },
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockServer(mintStatus: number) {
  fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url === '/api/anywhere/status') return Promise.resolve(jsonResponse(200, STATUS));
    if (url === '/api/access-tokens' && init?.method === 'POST') {
      const { name, scopes } = JSON.parse(String(init.body)) as { name: string; scopes: string[] };
      return Promise.resolve(mintStatus === 200
        ? jsonResponse(200, { token: 'odk_test', record: { id: 'tok-1', name, scopes } })
        : jsonResponse(403, { error: 'only the internal token or the root session can create access tokens' }));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function postedScopes(): string[] {
  const call = fetchMock.mock.calls.find(([input, init]) => input.toString() === '/api/access-tokens' && (init as RequestInit | undefined)?.method === 'POST');
  return (JSON.parse(String((call?.[1] as RequestInit).body)) as { scopes: string[] }).scopes;
}

async function renderAndSetup() {
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <McpUrlDialog open onClose={() => undefined} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue('https://desk.tailnet.ts.net'));
  return { user, writeText };
}

describe('McpUrlDialog (PAN-4649)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mints a token with the default scopes, copies <address>/mcp and shows the header and config', async () => {
    mockServer(200);
    const { user, writeText } = await renderAndSetup();

    await user.click(screen.getByRole('button', { name: 'Create and copy URL' }));

    expect(await screen.findByLabelText('URL')).toHaveValue('https://desk.tailnet.ts.net/mcp');
    expect(postedScopes()).toEqual(['read:state', 'read:conversations', 'operate']);
    expect(writeText).toHaveBeenCalledWith('https://desk.tailnet.ts.net/mcp');
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain('odk_');
    expect(screen.getByLabelText('Header')).toHaveValue('Authorization: Bearer odk_test');
    expect(String((screen.getByLabelText('Client config') as HTMLTextAreaElement).value)).toContain('"Authorization": "Bearer odk_test"');
    expect(screen.getByText('This token is shown once.')).toBeInTheDocument();
  });

  it('adds approve only when the box is ticked', async () => {
    mockServer(200);
    const { user } = await renderAndSetup();

    await user.click(screen.getByLabelText('Allow answering questions and approving permissions'));
    await user.click(screen.getByRole('button', { name: 'Create and copy URL' }));

    await screen.findByLabelText('URL');
    expect(postedScopes()).toEqual(['read:state', 'read:conversations', 'operate', 'approve']);
  });

  it('explains a 403 from a browser that is not on this machine', async () => {
    mockServer(403);
    const { user, writeText } = await renderAndSetup();

    await user.click(screen.getByRole('button', { name: 'Create and copy URL' }));

    expect(await screen.findByText('Only a browser on this machine can create MCP tokens.')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});
