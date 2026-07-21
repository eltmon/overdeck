/**
 * Start-block recovery dialog: 409s (resumable session, troubled gate,
 * paused gate) become working buttons, not CLI-text alerts.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogProvider';
import { ResumableSessionDialog } from '../ResumableSessionDialog';
import { recoveryFromBody, useResumeRecovery } from '../../lib/resumeRecovery';

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

  it('Cancel closes without any lifecycle calls', () => {
    useResumeRecovery.getState().openRecovery({ kind: 'resumable', agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
    expect(fetchCalls().some((c) => c.url.includes('/resume') || c.url.includes('/reset-session') || c.url.includes('/untroubled'))).toBe(false);
  });
});
