/**
 * PAN-4946 (PRD WI-3): the MCP OAuth sign-in card — the operator sees the
 * approval code, picks an access level, and approves or denies. There is no
 * optimistic hide: the row leaves only once the approvals query refetches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

vi.mock('../../lib/wsTransport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/wsTransport')>()),
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf' })),
}));

import { McpSignInCard } from '../McpSignInCard';
import type { Decision } from '../../lib/useDecisions';

const decision: Decision = {
  id: 'appr-1',
  source: 'agent',
  label: 'Claude Desktop',
  kinds: ['mcpSignIn'],
  since: '2026-11-04T00:00:00.000Z',
  blocking: true,
  mcpSignIn: {
    id: 'appr-1',
    clientId: 'odc_123',
    clientName: 'Claude Desktop',
    redirectHost: 'claude.ai',
    requestedLevel: 'operate',
    approvalCode: 'KQZT-MWRB',
    createdAt: '2026-11-04T00:00:00.000Z',
    expiresAt: '2026-11-04T00:10:00.000Z',
  },
};

function renderCard(ui: ReactElement = <McpSignInCard decision={decision} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['mcp-oauth-approvals'], [decision.mcpSignIn]);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockFetch(status: number, json: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('McpSignInCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the subject, code, warning and level options, defaulting to the requested level', () => {
    renderCard();
    expect(screen.getByTestId('mcp-sign-in-card')).toHaveAttribute('data-decision-id', 'appr-1');
    expect(screen.getByText('Claude Desktop wants access to Overdeck')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-sign-in-code')).toHaveTextContent('KQZT-MWRB');
    expect(screen.getByText('claude.ai')).toBeInTheDocument();
    expect(screen.getByText('Approve only if the page you opened shows this code.')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Access level' });
    expect(select).toHaveValue('operate');
    expect(screen.getAllByRole('option')).toHaveLength(4);
    expect(screen.getByRole('option', { name: 'Can operate' })).toBeInTheDocument();
  });

  it('defaults the select to Read only when the requested level is not one of the four', () => {
    renderCard(<McpSignInCard decision={{ ...decision, mcpSignIn: { ...decision.mcpSignIn!, requestedLevel: 'admin' } }} />);
    expect(screen.getByRole('combobox', { name: 'Access level' })).toHaveValue('read');
  });

  it('approves at the selected level', async () => {
    const fetchMock = mockFetch(200, { status: 'approved' });
    renderCard();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Access level' }), 'Can approve');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/mcp-oauth/approvals/appr-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf' },
      body: JSON.stringify({ decision: 'approve', level: 'approve' }),
    });
  });

  it('denies with no level key', async () => {
    const fetchMock = mockFetch(200, { status: 'denied' });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/mcp-oauth/approvals/appr-1', expect.objectContaining({
      body: JSON.stringify({ decision: 'deny' }),
    }));
  });

  it('shows "HTTP 409: ..." when the route reports the sign-in was already decided', async () => {
    mockFetch(409, { error: 'this sign-in request was already approved' });
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 409: this sign-in request was already approved');
  });

  it('shows "Could not reach the dashboard" when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the dashboard');
  });
});
