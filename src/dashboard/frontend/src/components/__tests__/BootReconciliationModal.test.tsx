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
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // The countdown must name both classified expiry outcomes: clean boots resume,
  // while crash or unknown boots hold. It must never promise unconditional resume.
  it('formats a 120-second countdown as 2:00 and states the classified expiry policy', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-29T15:00:00.000Z').getTime());
    renderModal(vi.fn(async () => jsonResponse({
      ...pendingState,
      graceDeadline: '2026-06-29T15:02:00.000Z',
    })));

    expect(await screen.findByText('Applying boot default in 2:00')).toBeInTheDocument();
    expect(screen.queryByText(/Auto-resuming/)).not.toBeInTheDocument();
    expect(screen.getByText('If the timer runs out, clean boots resume and crash boots stay stopped.')).toBeInTheDocument();
  });

  it('renders context rows in a separate section that no decision acts on', async () => {
    renderModal(vi.fn(async () => jsonResponse({
      ...pendingState,
      context: [
        {
          id: 'agent-pan-2167',
          issueId: 'PAN-2167',
          role: 'work',
          model: 'claude-sonnet-4-6',
          whyStopped: 'paused: awaiting close-out (verify on main)',
          concern: 'paused_troubled',
          lastActivity: '2026-06-01T00:00:00.000Z',
          cost: null,
          remote: false,
          readOnly: true,
        },
      ],
    })));

    const context = await screen.findByTestId('boot-reconciliation-context');
    expect(within(context).getByText(/Not part of this boot decision \(1\)/)).toBeInTheDocument();
    expect(within(context).getByText('PAN-2167')).toBeInTheDocument();
    // The candidate list stays clean — a context row is never a decision row.
    expect(screen.queryByTestId('boot-reconciliation-row-PAN-2167')).not.toBeInTheDocument();
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

  it('does not render the pending dialog when the reconciliation set is empty', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...pendingState, set: [] }));
    renderModal(fetchMock);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('boot-reconciliation-modal')).not.toBeInTheDocument();
  });

  it('does not render the pending dialog when every agent in the set is read-only', async () => {
    const readOnlyOnly = {
      ...pendingState,
      set: pendingState.set.filter((agent) => agent.readOnly),
    };
    const fetchMock = vi.fn(async () => jsonResponse(readOnlyOnly));
    renderModal(fetchMock);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId('boot-reconciliation-modal')).not.toBeInTheDocument();
  });

  it('defaults operator-stopped rows to hold and plain rows to resume', async () => {
    const operatorStoppedState: BootReconciliationState = {
      ...pendingState,
      set: [
        { ...pendingState.set[0], stoppedByUser: true, whyStopped: 'stopped by operator' },
        pendingState.set[1],
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/boot-reconciliation') return jsonResponse(operatorStoppedState);
      if (url === '/api/boot-reconciliation/decision') {
        return jsonResponse({ ok: true, count: 0, resumed: [] });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    renderModal(fetchMock);

    expect(await screen.findByTestId('boot-reconciliation-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('boot-reconciliation-review-each'));
    fireEvent.click(screen.getByTestId('boot-reconciliation-apply-per-agent'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/boot-reconciliation/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          decision: 'per_agent',
          perAgent: {
            'PAN-2076': 'hold',
            'PAN-2077': 'resume',
          },
        }),
      }),
    ));
  });

  it('sends resume all, hold all, per-agent review, and freeze actions', async () => {
    let decisionResponses = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/boot-reconciliation') return jsonResponse(pendingState);
      if (url === '/api/deacon/pause') return jsonResponse({ paused: true });
      if (url === '/api/boot-reconciliation/decision') {
        decisionResponses += 1;
        if (decisionResponses === 1) {
          return jsonResponse({
            ok: true,
            count: 0,
            resumed: [],
            skipped: {
              workspace_missing: 28,
              merged: 3,
              completed: 5,
              other: 0,
            },
            deferred: 2,
            outcomes: [
              {
                id: 'agent-pan-2076',
                issueId: 'PAN-2076',
                outcome: 'skipped',
                reason: 'no-resumable-session',
              },
            ],
          });
        }
        if (decisionResponses === 2) {
          return jsonResponse({
            ok: true,
            count: 2,
            resumed: ['agent-pan-2076', 'agent-pan-2077'],
            skipped: {
              workspace_missing: 0,
              merged: 1,
              completed: 0,
              other: 1,
            },
            deferred: 1,
            outcomes: [
              {
                id: 'agent-pan-2079',
                issueId: 'PAN-2079',
                outcome: 'skipped',
                reason: 'deferred-concurrency',
              },
            ],
          });
        }
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
    expect(
      await screen.findByText('Boot decision saved. No agents resumed — 28 workspace missing, 3 already merged, 5 completed, 2 deferred.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('boot-reconciliation-hold-all'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/boot-reconciliation/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'hold_all' }),
      }),
    ));
    expect(
      await screen.findByText('Boot decision saved. Resuming 2 agents. Also skipped 1 already merged, 1 not resumable, 1 deferred.'),
    ).toBeInTheDocument();

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
    expect(await screen.findByText('Boot decision saved. Resumed 0 agents.')).toBeInTheDocument();
  });

  it('shows the held banner for a hold_all decision and resumes all from it (PAN-2278)', async () => {
    const holdState: BootReconciliationState = {
      ...pendingState,
      decision: 'hold_all',
      decidedAt: '2026-06-29T15:00:00.253Z',
      heldCount: 2,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/boot-reconciliation') return jsonResponse(holdState);
      if (url === '/api/boot-reconciliation/decision') {
        return jsonResponse({ ok: true, count: 3, resumed: [] });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });
    renderModal(fetchMock);

    const banner = await screen.findByTestId('boot-reconciliation-held-banner');
    // 3 held: the 4-agent set minus the read-only PAN-2078 row.
    expect(within(banner).getByText(/Holding 3 stopped agents/)).toBeInTheDocument();
    expect(screen.queryByTestId('boot-reconciliation-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('boot-reconciliation-held-resume-all'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/boot-reconciliation/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ decision: 'resume_all' }),
      }),
    ));
  });

  it('hides a hold_all banner when the live held count is zero', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      ...pendingState,
      decision: 'hold_all',
      heldCount: 0,
    }));
    renderModal(fetchMock);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/boot-reconciliation'));
    expect(screen.queryByTestId('boot-reconciliation-held-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('boot-reconciliation-modal')).not.toBeInTheDocument();
  });

  it('counts only agents still held by a per_agent decision, and hides when none are', async () => {
    const perAgentState: BootReconciliationState = {
      ...pendingState,
      decision: 'per_agent',
      perAgent: { 'PAN-2076': 'resume', 'PAN-2077': 'hold', 'PAN-2079': 'resume' },
      heldCount: 1,
    };
    renderModal(vi.fn(async () => jsonResponse(perAgentState)));

    const banner = await screen.findByTestId('boot-reconciliation-held-banner');
    expect(within(banner).getByText(/Holding 1 stopped agent\b/)).toBeInTheDocument();

    cleanup();
    vi.unstubAllGlobals();

    const allResumedState: BootReconciliationState = {
      ...pendingState,
      decision: 'per_agent',
      perAgent: { 'PAN-2076': 'resume', 'PAN-2077': 'resume', 'PAN-2079': 'resume' },
      heldCount: 0,
    };
    renderModal(vi.fn(async () => jsonResponse(allResumedState)));
    await waitFor(() => {
      expect(screen.queryByTestId('boot-reconciliation-held-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boot-reconciliation-modal')).not.toBeInTheDocument();
    });
  });

  it('renders nothing after a resume_all decision', async () => {
    renderModal(vi.fn(async () => jsonResponse({ ...pendingState, decision: 'resume_all' })));
    await waitFor(() => {
      expect(screen.queryByTestId('boot-reconciliation-held-banner')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boot-reconciliation-modal')).not.toBeInTheDocument();
    });
  });
});
