/**
 * The resumable-session recovery dialog: the 409 "has a resumable session"
 * becomes Resume / Start fresh buttons, not a CLI-text alert.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../DialogProvider';
import { ResumableSessionDialog } from '../ResumableSessionDialog';
import { resumableRecoveryFromBody, useResumeRecovery } from '../../lib/resumeRecovery';

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

describe('resumableRecoveryFromBody', () => {
  it('extracts the recovery request from a 409 lifecycle body', () => {
    expect(resumableRecoveryFromBody({ error: 'Agent agent-x has a resumable Claude session…', lifecycle: { agentId: 'agent-x', canResumeSession: true, recommendedAction: 'resume' } }))
      .toEqual({ agentId: 'agent-x' });
  });
  it('ignores non-resumable bodies', () => {
    expect(resumableRecoveryFromBody({ error: 'boom' })).toBeNull();
    expect(resumableRecoveryFromBody({ lifecycle: { agentId: 'agent-x', canResumeSession: false } })).toBeNull();
    expect(resumableRecoveryFromBody(null)).toBeNull();
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
    useResumeRecovery.getState().openRecovery({ agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();
    expect(screen.getByText('agent-pan-2876')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('recovery-resume'));

    await waitFor(() => {
      expect(fetchCalls().some((c) => c.url === '/api/agents/agent-pan-2876/resume' && c.method === 'POST')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
    });
  });

  it('Start fresh posts reset-session then starts the issue', async () => {
    useResumeRecovery.getState().openRecovery({ agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();

    fireEvent.click(screen.getByTestId('recovery-start-fresh'));

    await waitFor(() => {
      const calls = fetchCalls();
      expect(calls.some((c) => c.url === '/api/agents/agent-pan-2876/reset-session' && c.method === 'POST')).toBe(true);
      expect(calls.some((c) => c.url === '/api/agents' && c.method === 'POST' && c.body === JSON.stringify({ issueId: 'PAN-2876' }))).toBe(true);
    });
  });

  it('Cancel closes without any lifecycle calls', () => {
    useResumeRecovery.getState().openRecovery({ agentId: 'agent-pan-2876', issueId: 'PAN-2876' });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('resumable-session-dialog')).not.toBeInTheDocument();
    expect(fetchCalls().some((c) => c.url.includes('/resume') || c.url.includes('/reset-session'))).toBe(false);
  });
});
