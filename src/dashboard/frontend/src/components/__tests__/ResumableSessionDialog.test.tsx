/**
 * Start-block recovery dialog: 409s (resumable session, troubled gate,
 * paused gate) become working buttons, not CLI-text alerts.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogProvider';
import { ResumableSessionDialog } from '../ResumableSessionDialog';
import { recoveryFromBody, openRecoveryForStartBlock, useResumeRecovery } from '../../lib/resumeRecovery';

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DialogProvider>
        <ResumableSessionDialog />
      </DialogProvider>
    </QueryClientProvider>,
  );
}

function fetchCalls(): Array<{ url: string; method: string; body?: string }> {
  return (window.fetch as ReturnType<typeof vi.fn>).mock.calls.map((call) => ({
    url: String(call[0]),
    method: (call[1]?.method as string) ?? 'GET',
    body: call[1]?.body as string | undefined,
  }));
}

describe('recoveryFromBody', () => {
  it('extracts a resumable recovery from a lifecycle body', () => {
    expect(recoveryFromBody({ error: '…resumable Claude session…', lifecycle: { agentId: 'agent-x', canResumeSession: true } }))
      .toEqual({ kind: 'resumable', agentId: 'agent-x' });
  });

  it('extracts a troubled recovery with the failure count', () => {
    expect(recoveryFromBody({ success: false, error: 'Agent agent-pan-2876 is troubled (3 failures).', agentId: 'agent-pan-2876', troubled: true }))
      .toEqual({ kind: 'troubled', agentId: 'agent-pan-2876', detail: '3 failures' });
  });

  it('extracts a paused recovery with the reason', () => {
    expect(recoveryFromBody({ success: false, error: 'Agent agent-x is paused (waiting on review).', agentId: 'agent-x', paused: true }))
      .toEqual({ kind: 'paused', agentId: 'agent-x', detail: 'waiting on review' });
  });

  it('ignores non-recoverable bodies', () => {
    expect(recoveryFromBody({ error: 'boom' })).toBeNull();
    expect(recoveryFromBody({ lifecycle: { agentId: 'agent-x', canResumeSession: false } })).toBeNull();
    expect(recoveryFromBody(null)).toBeNull();
  });

  it('extracts a live-session recovery from a live-tmux 409, ahead of resumable', () => {
    expect(recoveryFromBody({ error: '…has a live tmux session…', lifecycle: { agentId: 'agent-x', hasLiveTmuxSession: true } }))
      .toEqual({ kind: 'live-session', agentId: 'agent-x' });
    // A stopped-on-paper agent with a live session can look resumable — the
    // live session wins, because resume would just 409 again.
    expect(recoveryFromBody({ lifecycle: { agentId: 'agent-x', hasLiveTmuxSession: true, canResumeSession: true } }))
      .toEqual({ kind: 'live-session', agentId: 'agent-x' });
  });
});

describe('openRecoveryForStartBlock', () => {
  beforeEach(() => {
    useResumeRecovery.setState({ request: null });
  });

  it('opens the recovery dialog for a start-block 409', () => {
    const handled = openRecoveryForStartBlock(409, { lifecycle: { agentId: 'agent-x', canResumeSession: true } }, 'PAN-2876');
    expect(handled).toBe(true);
    expect(useResumeRecovery.getState().request).toEqual({ kind: 'resumable', agentId: 'agent-x', issueId: 'PAN-2876' });
  });

  it('ignores non-409 statuses and non-recovery 409s', () => {
    expect(openRecoveryForStartBlock(500, { lifecycle: { agentId: 'agent-x', canResumeSession: true } })).toBe(false);
    expect(openRecoveryForStartBlock(409, { requiresAcknowledgement: true })).toBe(false);
    expect(useResumeRecovery.getState().request).toBeNull();
  });
});

describe('ResumableSessionDialog', () => {
  beforeEach(() => {
    useResumeRecovery.setState({ request: null });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf' });
      return Response.json({ success: true });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing without a request', () => {
    renderDialog();
    expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
  });

  it('Resume session posts to the resume endpoint and closes', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'resumable', agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();
    expect(screen.getByText('agent-pan-2876')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    await waitFor(() => {
      expect(fetchCalls().some((c) => c.url === '/api/agents/agent-pan-2876/resume' && c.method === 'POST')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
    });
  });

  it('Start fresh posts reset-session then starts the issue', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'resumable', agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();

    fireEvent.click(screen.getByTestId('recovery-start-fresh'));

    await waitFor(() => {
      const calls = fetchCalls();
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2876/reset-session' && c.method === 'POST')).toBe(true);
      expect(calls.some((c) => c.url === '/api/agents' && c.method === 'POST' && c.body === JSON.stringify({ issueId: 'PAN-2876' }))).toBe(true);
    });
  });

  it('Troubled recovery clears the gate then starts the issue', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'troubled', agentId: 'agent-pan-2876', issueId: 'PAN-2876', detail: '3 failures' });
    renderDialog();
    expect(screen.getByTestId('resumable-session-dialog')).toHaveAttribute('data-kind', 'troubled');
    expect(screen.getByRole('button', { name: /Clear gate & start/ })).toBeInTheDocument();
    expect(screen.queryByTestId('recovery-start-fresh')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    await waitFor(() => {
      const calls = fetchCalls();
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2876/untroubled' && c.method === 'POST')).toBe(true);
      expect(calls.some((c) => c.url === '/api/agents' && c.method === 'POST' && c.body === JSON.stringify({ issueId: 'PAN-2876' }))).toBe(true);
    });
  });

  it('Paused recovery unpauses then starts the issue', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'paused', agentId: 'agent-pan-2876', issueId: 'PAN-2876', detail: 'waiting on review' });
    renderDialog();
    expect(screen.getByRole('button', { name: /Unpause & start/ })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    await waitFor(() => {
      const calls = fetchCalls();
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2876/unpause' && c.method === 'POST')).toBe(true);
      expect(calls.some((c) => c.url === '/api/agents' && c.method === 'POST' && c.body === JSON.stringify({ issueId: 'PAN-2876' }))).toBe(true);
    });
  });

  it('Paused recovery skips the follow-up start when the unpause route already resumed', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'paused', agentId: 'agent-pan-2997', issueId: 'PAN-2997' });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf' });
      if (url.endsWith('/unpause')) return Response.json({ success: true, resumeTriggered: true });
      return Response.json({ success: true });
    }));
    renderDialog();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    // Unpause fired the resume server-side — a start POST would race it.
    await waitFor(() => {
      expect(fetchCalls().some((c) => c.url === '/api/agents/agent-pan-2997/unpause' && c.method === 'POST')).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument());
    expect(fetchCalls().some((c) => c.url === '/api/agents' && c.method === 'POST')).toBe(false);
  });

  it('swaps to the resumable recovery when the start-after-clear hits a new 409', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'paused', agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/session')) return Response.json({ csrfToken: 'test-csrf' });
      if (url === '/api/agents') {
        return Response.json(
          { error: "Agent agent-pan-2876 has a resumable Claude session. Use 'pan resume …' …", lifecycle: { agentId: 'agent-pan-2876', canResumeSession: true } },
          { status: 409 },
        );
      }
      return Response.json({ success: true });
    }));
    renderDialog();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    // The dialog stays open but becomes the resumable-session recovery —
    // the operator gets Resume / Start fresh buttons, not a CLI-text alert.
    await waitFor(() => {
      expect(screen.getByTestId('resumable-session-dialog')).toHaveAttribute('data-kind', 'resumable');
    });
    expect(screen.getByTestId('recovery-start-fresh')).toBeInTheDocument();
    expect(useResumeRecovery.getState().request).toEqual({ kind: 'resumable', agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
  });

  it('Stop & restart stops the live agent then re-runs the original request (PAN-2997)', async () => {
    useResumeRecovery.getState().openRecovery({
      kind: 'live-session',
      agentId: 'agent-pan-2997',
      issueId: 'PAN-2997',
      retry: { url: '/api/agents/agent-pan-2997/restart-fresh', body: { spawn: true, model: 'kimi-k3-1m' } },
    });
    renderDialog();
    expect(screen.getByTestId('resumable-session-dialog')).toHaveAttribute('data-kind', 'live-session');
    expect(screen.getByRole('button', { name: /Stop & restart/ })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    await waitFor(() => {
      const calls = fetchCalls();
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2997' && c.method === 'DELETE')).toBe(true);
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2997/restart-fresh' && c.method === 'POST' && c.body === JSON.stringify({ spawn: true, model: 'kimi-k3-1m' }))).toBe(true);
    });
    await waitFor(() => expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument());
  });

  it('live-session without a retry payload only stops the agent — never does more than asked', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'live-session', agentId: 'agent-pan-2997', issueId: 'PAN-2997' });
    renderDialog();
    expect(screen.getByRole('button', { name: /Stop agent/ })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    await waitFor(() => {
      const calls = fetchCalls();
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2997' && c.method === 'DELETE')).toBe(true);
    });
    expect(fetchCalls().some((c) => c.url.includes('restart-fresh'))).toBe(false);
  });

  it('Cancel closes without any lifecycle calls', () => {
    useResumeRecovery.getState().openRecovery({ kind: 'resumable', agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
    expect(fetchCalls().some((c) => c.url.includes('/resume') || c.url.includes('/reset-session') || c.url.includes('/untroubled'))).toBe(false);
  });

  it('never traps the operator: Cancel works while a start is in flight', async () => {
    useResumeRecovery.getState().openRecovery({ kind: 'paused', agentId: 'agent-min-852', issueId: 'MIN-852' });
    // A start that never resolves — simulates a multi-minute docker stack rebuild.
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/session')) return Promise.resolve(Response.json({ csrfToken: 'test-csrf' }));
      return new Promise<Response>(() => {});
    }));
    renderDialog();

    fireEvent.click(screen.getByTestId('recovery-primary'));

    // Pending: the action button locks and the hint explains the wait…
    await waitFor(() => expect(screen.getByTestId('recovery-pending-hint')).toBeInTheDocument());
    expect(screen.getByTestId('recovery-primary')).toBeDisabled();
    // …but Cancel and the X are never taken away.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
  });
});
