/**
 * PAN-5091: the terminal-backend restart card lists the stopped conversations,
 * posts Resume all and Dismiss, shows the run, and disables both while it runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BackendRestartRecoverySnapshot } from '@overdeck/contracts';

import { BackendRestartCard } from '../BackendRestartCard';
import type { Decision } from '../../lib/useDecisions';

function makeDecision(snapshot: BackendRestartRecoverySnapshot): Decision {
  return {
    id: 'backend-restart',
    source: 'agent',
    label: `${snapshot.conversations.length} conversations stopped when the terminal backend restarted`,
    kinds: ['backendRestart'],
    since: snapshot.lostAt ?? '',
    blocking: false,
    backendRestart: snapshot,
  };
}

function renderCard(snapshot: BackendRestartRecoverySnapshot) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BackendRestartCard decision={makeDecision(snapshot)} />
    </QueryClientProvider>,
  );
}

const OFFER: BackendRestartRecoverySnapshot = {
  lostAt: '2026-11-06T09:13:00.000Z',
  conversations: [{ name: 'a', title: 'Fernkite deploy' }, { name: 'b', title: null }],
  run: null,
};

afterEach(() => vi.restoreAllMocks());

describe('BackendRestartCard', () => {
  it('lists the conversations by title or name and posts Resume all', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ started: true, conversations: 2 }), { status: 202 }));
    renderCard(OFFER);

    expect(screen.getByText('2 conversations stopped when the terminal backend restarted')).toBeTruthy();
    expect(screen.getByText('Fernkite deploy, b')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume all' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/backend-restart-recovery/resume-all', { method: 'POST' }));
  });

  it('shows a refusal from the route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Resume all is already running' }), { status: 409 }));
    renderCard(OFFER);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Resume all is already running');
  });

  it('disables both buttons and says it is waiting while memory pressure is high', () => {
    renderCard({
      ...OFFER,
      run: { state: 'running', startedAt: '2026-11-06T09:20:00.000Z', finishedAt: null, current: null, waitingForMemory: true, results: [] },
    });
    expect(screen.getByTestId('backend-restart-run').textContent).toBe('Waiting for memory pressure to fall before the next resume.');
    expect((screen.getByRole('button', { name: 'Resume all' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('summarizes a finished run and lists each failure with its reason', () => {
    renderCard({
      ...OFFER,
      conversations: [{ name: 'a', title: 'Fernkite deploy' }],
      run: {
        state: 'done',
        startedAt: '2026-11-06T09:20:00.000Z',
        finishedAt: '2026-11-06T09:21:00.000Z',
        current: null,
        waitingForMemory: false,
        results: [
          { name: 'a', outcome: 'failed', reason: 'Invalid cwd' },
          { name: 'b', outcome: 'resumed' },
          { name: 'c', outcome: 'skipped', reason: 'paused' },
        ],
      },
    });
    expect(screen.getByTestId('backend-restart-run').textContent).toBe('Last Resume all: 1 resumed, 1 skipped, 1 failed.');
    expect(screen.getByText(': Invalid cwd', { exact: false })).toBeTruthy();
  });
});
