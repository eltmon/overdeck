/**
 * PAN-4946 (PRD WI-5): active MCP OAuth sign-ins, with Revoke. Mirrors
 * AccessTokensPanel.test.tsx's fetch-mocking pattern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { DialogProvider } from '../../../DialogProvider';
import { McpSignInsList } from '../McpSignInsList';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../lib/wsTransport', () => ({
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'test' })),
}));

const SIGN_INS = [
  {
    familyId: 'fam-1',
    clientId: 'odc_1',
    clientName: 'Claude Desktop',
    level: 'operate',
    scopes: ['read:state', 'read:conversations', 'tell', 'operate'],
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: '2026-10-30T00:00:00.000Z',
    accessExpiresAt: '2026-10-31T00:00:00.000Z',
    refreshExpiresAt: '2026-12-01T00:00:00.000Z',
    headless: false,
  },
  {
    familyId: 'fam-2',
    clientId: 'odc_2',
    clientName: 'CI bot',
    level: 'message',
    scopes: ['read:state', 'read:conversations', 'tell'],
    createdAt: '2026-10-05T00:00:00.000Z',
    lastUsedAt: null,
    accessExpiresAt: null,
    refreshExpiresAt: '2026-12-05T00:00:00.000Z',
    headless: true,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) } as Response;
}

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DialogProvider><McpSignInsList /></DialogProvider>
    </QueryClientProvider>,
  );
}

function deleteCalls() {
  return fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');
}

describe('McpSignInsList (PAN-4946)', () => {
  beforeEach(() => {
    fetchMock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/mcp-oauth/sign-ins' && !init?.method) return Promise.resolve(jsonResponse(200, { signIns: SIGN_INS }));
      if (url === '/api/mcp-oauth/sign-ins/fam-1' && init?.method === 'DELETE') return Promise.resolve(jsonResponse(200, { revoked: true }));
      return Promise.resolve(jsonResponse(404, { error: 'not found' }));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ac1: renders both client names, the level label and a headless chip only on the headless row', async () => {
    renderList();
    const operate = (await screen.findByText('Claude Desktop')).closest('li') as HTMLElement;
    const headless = screen.getByText('CI bot').closest('li') as HTMLElement;
    expect(within(operate).getByText(/Can operate/)).toBeInTheDocument();
    expect(within(operate).queryByText('headless')).toBeNull();
    expect(within(headless).getByText(/Can message/)).toBeInTheDocument();
    expect(within(headless).getByText('headless')).toBeInTheDocument();
  });

  it('ac2: sends DELETE /api/mcp-oauth/sign-ins/fam-1 and refetches when Revoke is confirmed', async () => {
    const user = userEvent.setup();
    renderList();

    const row = (await screen.findByText('Claude Desktop')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Its access and refresh tokens stop working/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0]?.[0]).toBe('/api/mcp-oauth/sign-ins/fam-1');
  });

  it('ac2: sends no DELETE when the confirm is cancelled', async () => {
    const user = userEvent.setup();
    renderList();

    const row = (await screen.findByText('Claude Desktop')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(deleteCalls()).toHaveLength(0);
  });

  it('ac3: explains a 403 from a browser that is not on this machine', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(403, { error: 'only the internal token or the root session can manage MCP sign-ins' })));
    renderList();
    expect(await screen.findByText('Only a browser on this machine can list sign-ins.')).toBeInTheDocument();
  });

  it('ac3: shows the empty state', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { signIns: [] })));
    renderList();
    expect(await screen.findByText('No sign-ins. An MCP client that signs in with OAuth appears here after you approve it.')).toBeInTheDocument();
  });
});
