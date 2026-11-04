/**
 * PAN-4941 (W-SEC1 WI-8): the secret request card — a root-session viewer
 * answers from a masked input that is cleared whatever the answer; any other
 * viewer is told where to answer; the Decisions panel shows the card instead
 * of the generic Answer button. PAN-4942 (W-LINK1 WI-6): the machine-link
 * card opens Link a machine with the request id, or dismisses the request.
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

import { AgentRequestCard } from '../AgentRequestCard';
import { DecisionsPanel } from '../DecisionsPanel';
import { ANYWHERE_STATUS_QUERY_KEY } from '../Settings/anywhere/anywhereApi';
import { useAnywhereDialogStore } from '../Settings/anywhere/anywhereDialogStore';
import * as useDecisionsModule from '../../lib/useDecisions';
import type { Decision } from '../../lib/useDecisions';

const REQUEST_ID = '0123456789abcdef0123456789abcdef';

const decision: Decision = {
  id: REQUEST_ID,
  source: 'agent',
  label: 'agent-pan-1 · PAN-1',
  kinds: ['secretRequest'],
  since: '2026-11-04T00:00:00.000Z',
  blocking: true,
  agentRequest: {
    id: REQUEST_ID,
    kind: 'secret',
    name: 'OPENAI_API_KEY',
    prompt: 'The key for the eval run',
    agentId: 'agent-pan-1',
    expiresAt: '2026-11-04T00:10:00.000Z',
  },
};

function renderAs(viewerKind: 'root-session' | 'device', ui: ReactElement = <AgentRequestCard decision={decision} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ANYWHERE_STATUS_QUERY_KEY, { machine: { environmentId: 'env-1', label: 'desk' }, viewer: { kind: viewerKind } });
  client.setQueryData(['agent-requests'], []);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function mockFetch(status: number, json: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AgentRequestCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a root-session viewer the prompt, the name, a password input, Send and Decline', () => {
    renderAs('root-session');
    expect(screen.getByTestId('agent-request-card')).toHaveAttribute('data-decision-id', REQUEST_ID);
    expect(screen.getByText('Secret requested')).toBeInTheDocument();
    expect(screen.getByText('The key for the eval run')).toBeInTheDocument();
    expect(screen.getByText('OPENAI_API_KEY')).toBeInTheDocument();
    expect(screen.getByLabelText('Value for OPENAI_API_KEY')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });

  it('posts { value } to the secret route and clears the input on success', async () => {
    const fetchMock = mockFetch(200, { requestId: REQUEST_ID, status: 'delivered' });
    renderAs('root-session');
    const input = screen.getByLabelText('Value for OPENAI_API_KEY');
    await userEvent.type(input, 'canary-value');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`/api/agent-requests/${REQUEST_ID}/secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-overdeck-csrf-token': 'csrf' },
      body: JSON.stringify({ value: 'canary-value' }),
    });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears the input and shows the error when the answer fails', async () => {
    mockFetch(500, { error: 'could not write the secret file', code: 'write-failed' });
    renderAs('root-session');
    const input = screen.getByLabelText('Value for OPENAI_API_KEY');
    await userEvent.type(input, 'canary-value');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500: could not write the secret file');
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert').textContent).not.toContain('canary-value');
  });

  it('posts an empty object to the decline route', async () => {
    const fetchMock = mockFetch(200, { requestId: REQUEST_ID, status: 'declined' });
    renderAs('root-session');
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`/api/agent-requests/${REQUEST_ID}/decline`, expect.objectContaining({ method: 'POST', body: '{}' }));
  });

  it('tells any other viewer to answer on the machine and offers no input', () => {
    renderAs('device');
    expect(screen.getByText("Answer this on desk's own dashboard")).toBeInTheDocument();
    expect(screen.queryByLabelText('Value for OPENAI_API_KEY')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('is what the Decisions panel shows for a secret request, with no Answer button', () => {
    vi.spyOn(useDecisionsModule, 'useDecisions').mockReturnValue([decision]);
    renderAs('root-session', <DecisionsPanel />);
    expect(screen.getByTestId('agent-request-card')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Answer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });
});

describe('AgentRequestCard for a machine-link request (PAN-4942)', () => {
  const linkDecision: Decision = {
    id: REQUEST_ID,
    source: 'agent',
    label: 'agent-pan-1 · PAN-1',
    kinds: ['machineLink'],
    since: '2026-11-04T00:00:00.000Z',
    blocking: true,
    agentRequest: { id: REQUEST_ID, kind: 'machine-link', hint: 'my desk Mac', agentId: 'agent-pan-1', expiresAt: '2026-11-05T00:00:00.000Z' },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    useAnywhereDialogStore.setState({ dialog: null, agentRequestId: null });
  });
  afterEach(() => {
    useAnywhereDialogStore.setState({ dialog: null, agentRequestId: null });
    vi.unstubAllGlobals();
  });

  it('shows a root-session viewer the hint, Link a machine… and Dismiss, and no password input', () => {
    renderAs('root-session', <AgentRequestCard decision={linkDecision} />);
    expect(screen.getByTestId('agent-request-card')).toHaveAttribute('data-blocking', 'true');
    expect(screen.getByText('Machine link requested')).toBeInTheDocument();
    expect(screen.getByText('agent-pan-1 · PAN-1 asks you to link a machine: my desk Mac')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link a machine…' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('opens Link a machine with the request id', async () => {
    const fetchMock = mockFetch(200, {});
    renderAs('root-session', <AgentRequestCard decision={linkDecision} />);
    await userEvent.click(screen.getByRole('button', { name: 'Link a machine…' }));
    expect(useAnywhereDialogStore.getState()).toMatchObject({ dialog: 'link-machine', agentRequestId: REQUEST_ID });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts an empty object to the decline route on Dismiss', async () => {
    const fetchMock = mockFetch(200, { requestId: REQUEST_ID, status: 'declined' });
    renderAs('root-session', <AgentRequestCard decision={linkDecision} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(`/api/agent-requests/${REQUEST_ID}/decline`, expect.objectContaining({ method: 'POST', body: '{}' }));
  });

  it('tells any other viewer to answer on the machine and offers no buttons', () => {
    renderAs('device', <AgentRequestCard decision={linkDecision} />);
    expect(screen.getByText("Answer this on desk's own dashboard")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link a machine…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('maps a machine-link row to one blocking decision with the hint, and a secret row as before', () => {
    const base = { id: REQUEST_ID, agentId: 'agent-pan-1', agentKind: 'agent' as const, label: 'agent-pan-1 · PAN-1', createdAt: '2026-11-04T00:00:00.000Z' };
    expect(useDecisionsModule.agentRequestDecisions([
      { ...base, kind: 'machine-link', hint: 'my desk Mac', expiresAt: '2026-11-05T00:00:00.000Z' },
    ])).toEqual([linkDecision]);
    expect(useDecisionsModule.agentRequestDecisions([
      { ...base, kind: 'secret', name: 'OPENAI_API_KEY', prompt: 'The key for the eval run', expiresAt: '2026-11-04T00:10:00.000Z' },
    ])).toEqual([decision]);
  });
});
