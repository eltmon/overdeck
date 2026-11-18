/**
 * PAN-5541 WI-4: the agent-request dialog opened from a Needs-you item —
 * renders the shared answer body, closes itself once the request leaves the
 * pending list (D12: never before the first fetch lands), and hands off to
 * Link a machine… without stacking dialogs (D-11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { toastFn, toastSuccess } = vi.hoisted(() => ({ toastFn: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(toastFn, { success: toastSuccess }) }));

vi.mock('../../lib/wsTransport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/wsTransport')>()),
  dashboardMutationJsonHeaders: vi.fn(async () => ({ 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf' })),
}));

import { AgentRequestDialogHost } from '../AgentRequestDialogHost';
import { openAgentRequestDialog, useAgentRequestDialogStore } from '../../lib/agentRequestDialogStore';
import { ANYWHERE_STATUS_QUERY_KEY } from '../Settings/anywhere/anywhereApi';
import { useAnywhereDialogStore } from '../Settings/anywhere/anywhereDialogStore';
import type { AgentRequestRow } from '../../lib/useDecisions';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';

const secretRow: AgentRequestRow = {
  id: REQUEST_ID,
  kind: 'secret',
  agentId: 'agent-pan-1',
  agentKind: 'agent',
  issueId: 'PAN-1',
  label: 'agent-pan-1 · PAN-1',
  name: 'OPENAI_API_KEY',
  prompt: 'The key for the eval run',
  createdAt: '2026-11-04T00:00:00.000Z',
  expiresAt: '2026-11-04T00:10:00.000Z',
};

const linkRow: AgentRequestRow = {
  id: REQUEST_ID,
  kind: 'machine-link',
  agentId: 'agent-pan-1',
  agentKind: 'agent',
  issueId: 'PAN-1',
  label: 'agent-pan-1 · PAN-1',
  hint: 'my desk Mac',
  createdAt: '2026-11-04T00:00:00.000Z',
  expiresAt: '2026-11-05T00:00:00.000Z',
};

function renderHost(rows: AgentRequestRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ANYWHERE_STATUS_QUERY_KEY, { machine: { environmentId: 'env-1', label: 'desk' }, viewer: { kind: 'root-session' } });
  client.setQueryData(['agent-requests'], rows);
  client.setQueryData(['conv-ask-user-question'], []);
  render(<QueryClientProvider client={client}><AgentRequestDialogHost /></QueryClientProvider>);
  return client;
}

function mockFetch(status: number, json: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AgentRequestDialogHost', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toastSuccess.mockClear();
    toastFn.mockClear();
    useAgentRequestDialogStore.setState({ requestId: null });
    useAnywhereDialogStore.setState({ dialog: null, agentRequestId: null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    useAgentRequestDialogStore.setState({ requestId: null });
    useAnywhereDialogStore.setState({ dialog: null, agentRequestId: null });
  });

  it('renders the password input for a pending secret row (AC1)', () => {
    renderHost([secretRow]);
    act(() => openAgentRequestDialog(REQUEST_ID));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Value for OPENAI_API_KEY')).toHaveAttribute('type', 'password');
  });

  it('a 200 Send closes the dialog and toasts the secret name, not its value (AC2)', async () => {
    mockFetch(200, { requestId: REQUEST_ID, status: 'delivered' });
    renderHost([secretRow]);
    act(() => openAgentRequestDialog(REQUEST_ID));
    await userEvent.type(screen.getByLabelText('Value for OPENAI_API_KEY'), 'canary-value');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(useAgentRequestDialogStore.getState().requestId).toBeNull());
    expect(toastSuccess).toHaveBeenCalledWith('Sent OPENAI_API_KEY to agent-pan-1 · PAN-1');
    expect(toastSuccess.mock.calls.flat().join(' ')).not.toContain('canary-value');
  });

  it('closes when the request leaves the pending list, but not before the first fetch (AC3)', async () => {
    const client = renderHost([secretRow]);
    act(() => openAgentRequestDialog(REQUEST_ID));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    client.setQueryData(['agent-requests'], []);
    await waitFor(() => expect(useAgentRequestDialogStore.getState().requestId).toBeNull());
  });

  it('keeps the dialog and its typed input through a failed refetch (HTTP 500) (AC3)', async () => {
    const client = renderHost([secretRow]);
    act(() => openAgentRequestDialog(REQUEST_ID));
    const input = screen.getByLabelText('Value for OPENAI_API_KEY');
    await userEvent.type(input, 'canary-value');

    mockFetch(500, {});
    await client.invalidateQueries({ queryKey: ['agent-requests'] }).catch(() => undefined);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(input).toHaveValue('canary-value');
  });

  it('keeps the dialog and its typed input through a malformed refetch (200 {}) (AC3)', async () => {
    const client = renderHost([secretRow]);
    act(() => openAgentRequestDialog(REQUEST_ID));
    const input = screen.getByLabelText('Value for OPENAI_API_KEY');
    await userEvent.type(input, 'canary-value');

    mockFetch(200, {});
    await client.invalidateQueries({ queryKey: ['agent-requests'] }).catch(() => undefined);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(input).toHaveValue('canary-value');
  });

  it('Link a machine… closes this dialog and opens the anywhere dialog with the request id (AC4)', async () => {
    mockFetch(200, {});
    renderHost([linkRow]);
    act(() => openAgentRequestDialog(REQUEST_ID));
    await userEvent.click(screen.getByRole('button', { name: 'Link a machine…' }));
    await waitFor(() => expect(useAgentRequestDialogStore.getState().requestId).toBeNull());
    expect(useAnywhereDialogStore.getState()).toMatchObject({ dialog: 'link-machine', agentRequestId: REQUEST_ID });
  });
});
