import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { AccessTokensPanel } from '../AccessTokensPanel';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const TOKENS = [
  { id: 'tok-1', name: 'Claude Desktop', scopes: ['read:state', 'read:conversations', 'operate'], createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-30T00:00:00.000Z' },
  { id: 'tok-2', name: 'Old bot', scopes: ['tell'], createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-09-02T00:00:00.000Z' },
];

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider><AccessTokensPanel /></DialogProvider>
    </QueryClientProvider>,
  );
}

function deleteCalls() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
}

describe('AccessTokensPanel (PAN-4649)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/access-tokens' && !init?.method) return Promise.resolve(jsonResponse(200, { tokens: TOKENS }));
      if (url === '/api/access-tokens/tok-1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { ok: true }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders tokens with their scopes; a revoked row shows Revoked and no button', async () => {
    renderPanel();
    const active = (await screen.findByText('Claude Desktop')).closest('li') as HTMLElement;
    const revoked = screen.getByText('Old bot').closest('li') as HTMLElement;
    expect(within(active).getByText(/read:state, read:conversations, operate/)).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    expect(within(revoked).getByText(/^tell/)).toBeInTheDocument();
    expect(within(revoked).queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(within(revoked).getByText(/^Revoked/)).toBeInTheDocument();
  });

  it('sends DELETE /api/access-tokens/tok-1 when the confirm is accepted', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('The token stops working on its next request.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]?.[0]).toBe('/api/access-tokens/tok-1');
  });

  it('shows the empty state', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { tokens: [] })));
    renderPanel();
    expect(await screen.findByText('No access tokens. Copy MCP URL creates one.')).toBeInTheDocument();
  });

  it('explains a 403 from a browser that is not on this machine', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, { error: 'only the internal token or the root session can list access tokens' })));
    renderPanel();
    expect(await screen.findByText('Only a browser on this machine can list access tokens.')).toBeInTheDocument();
  });
});

describe('AccessTokensPanel — agent token fold (PAN-4946)', () => {
  const AGENT_TOKENS = [
    ...TOKENS,
    { id: 'tok-agent-1', name: 'agent-pan-1', scopes: ['operate'], createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: null, agentId: 'agent-pan-1' },
    { id: 'tok-agent-2', name: 'agent-pan-2', scopes: ['read:state'], createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: null, revokedAt: '2026-09-02T00:00:00.000Z', agentId: 'agent-pan-2' },
  ];

  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/access-tokens' && !init?.method) return Promise.resolve(jsonResponse(200, { tokens: AGENT_TOKENS }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ac1: hides agent tokens behind "Show agent tokens (2)", counting a revoked one', async () => {
    renderPanel();
    expect(await screen.findByText('Claude Desktop')).toBeInTheDocument();
    expect(screen.queryByText('agent-pan-1')).not.toBeInTheDocument();
    expect(screen.queryByText('agent-pan-2')).not.toBeInTheDocument();
    const toggle = screen.getByTestId('show-agent-tokens');
    expect(toggle).toHaveTextContent('Show agent tokens (2)');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('ac2: expands to show both agent tokens and reads "Hide agent tokens (2)"', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('Claude Desktop');

    await user.click(screen.getByTestId('show-agent-tokens'));

    expect(screen.getByText('agent-pan-1')).toBeInTheDocument();
    expect(screen.getByText('agent-pan-2')).toBeInTheDocument();
    const toggle = screen.getByTestId('show-agent-tokens');
    expect(toggle).toHaveTextContent('Hide agent tokens (2)');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('ac3: renders no toggle when no record carries an agentId', async () => {
    fetchMock.mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/access-tokens' && !init?.method) return Promise.resolve(jsonResponse(200, { tokens: TOKENS }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    renderPanel();
    await screen.findByText('Claude Desktop');
    expect(screen.queryByTestId('show-agent-tokens')).not.toBeInTheDocument();
  });
});
