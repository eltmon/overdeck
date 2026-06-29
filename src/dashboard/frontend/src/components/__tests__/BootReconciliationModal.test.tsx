import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogProvider';
import { BootReconciliationModal, type BootReconciliationState } from '../BootReconciliationModal';

const pendingState: BootReconciliationState = {
  decision: 'pending',
  perAgent: {},
  decidedAt: '2026-06-29T15:00:00.000Z',
  bootId: 'boot-pan-2076',
  graceDeadline: '2026-06-29T15:00:30.000Z',
  set: [
    {
      id: 'agent-pan-2076',
      issueId: 'PAN-2076',
      role: 'work',
      model: 'claude-sonnet-4-6',
      whyStopped: 'stopped cleanly',
      concern: 'stopped_cleanly',
      lastActivity: '2026-06-29T14:59:00.000Z',
      cost: 1.25,
      remote: false,
      readOnly: false,
    },
    {
      id: 'agent-pan-2077',
      issueId: 'PAN-2077',
      role: 'work',
      model: 'gpt-5.5',
      whyStopped: 'orphaned: tmux session missing',
      concern: 'orphaned',
      lastActivity: '2026-06-29T14:58:00.000Z',
      cost: null,
      remote: false,
      readOnly: false,
    },
    {
      id: 'agent-pan-2078',
      issueId: 'PAN-2078',
      role: 'work',
      model: 'claude-sonnet-4-6',
      whyStopped: 'paused: operator',
      concern: 'paused_troubled',
      lastActivity: '2026-06-29T14:57:00.000Z',
      cost: null,
      remote: false,
      readOnly: true,
    },
    {
      id: 'agent-pan-2079',
      issueId: 'PAN-2079',
      role: 'work',
      model: 'kimi-k2',
      whyStopped: 'running remote',
      concern: 'running_remote',
      lastActivity: '2026-06-29T14:56:00.000Z',
      cost: 4.5,
      remote: true,
      readOnly: false,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderModal(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <DialogProvider>
        <BootReconciliationModal />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

describe('BootReconciliationModal', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders grouped held agents and keeps read-only rows non-resumable', async () => {
    renderModal(vi.fn(async () => jsonResponse(pendingState)));

    expect(await screen.findByTestId('boot-reconciliation-modal')).toBeInTheDocument();
    expect(screen.getByText('Running remote ($)')).toBeInTheDocument();
    expect(screen.getByText('Orphaned (tmux gone)')).toBeInTheDocument();
    expect(screen.getByText('Stopped cleanly')).toBeInTheDocument();
    expect(screen.getByText('Paused / troubled')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('boot-reconciliation-review-each'));

    expect(screen.getByTestId('boot-reconciliation-resume-PAN-2076')).toBeInTheDocument();
    const readOnlyRow = screen.getByTestId('boot-reconciliation-row-PAN-2078');
    expect(within(readOnlyRow).queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(within(readOnlyRow).getByText('Not resumable here')).toBeInTheDocument();
  });

  it('sends resume all, hold all, per-agent review, and freeze actions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/boot-reconciliation') return jsonResponse(pendingState);
      if (url === '/api/deacon/pause') return jsonResponse({ paused: true });
      if (url === '/api/boot-reconciliation/decision') {
        return jsonResponse({ ok: true, count: 0, resumed: [] });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    renderModal(fetchMock);

    expect(await screen.findByTestId('boot-reconciliation-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('boot-reconciliation-resume-all'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/boot-reconciliation/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'resume_all' }),
      }),
    ));

    fireEvent.click(screen.getByTestId('boot-reconciliation-hold-all'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/boot-reconciliation/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'hold_all' }),
      }),
    ));

    fireEvent.click(screen.getByTestId('boot-reconciliation-freeze'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/deacon/pause',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ paused: true }),
      }),
    ));

    fireEvent.click(screen.getByTestId('boot-reconciliation-review-each'));
    fireEvent.click(screen.getByTestId('boot-reconciliation-hold-PAN-2077'));
    fireEvent.click(screen.getByTestId('boot-reconciliation-apply-per-agent'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/boot-reconciliation/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          decision: 'per_agent',
          perAgent: {
            'PAN-2076': 'resume',
            'PAN-2077': 'hold',
            'PAN-2079': 'resume',
          },
        }),
      }),
    ));
  });
});
