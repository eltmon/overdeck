/**
 * PAN-5342 WI-11 — the safe-shutdown status banner. The snapshot is set on the
 * dashboard store directly; fetch is stubbed, so no test reaches a real route.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownSnapshot } from '@overdeck/contracts';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

import { useDashboardStore } from '../lib/store';
import { HiddenWhenShutDown, ShutdownBanner } from './ShutdownBanner';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');

function snapshot(overrides: Partial<ShutdownSnapshot> = {}): ShutdownSnapshot {
  return {
    phase: 'draining',
    startedAt: '2026-11-15T11:59:00.000Z',
    deadlineAt: '2026-11-15T12:01:30.000Z',
    overdue: false,
    reboot: false,
    force: 'never',
    pending: [
      {
        id: 'agent-pan-7',
        kind: 'agent',
        label: 'PAN-7 work agent',
        issueId: 'PAN-7',
        activity: 'working',
        tool: 'Bash',
        toolDescription: 'Run the unit tests',
        toolStartedAt: '2026-11-15T11:59:48.000Z',
      },
      { id: 'conv-fort', kind: 'conversation', label: 'Fort fixes', conversationName: 'fort', activity: 'thinking' },
    ],
    writers: [],
    stoppedCount: 2,
    warnings: [],
    ...overrides,
  };
}

function setShutdown(shutdown: ShutdownSnapshot | null) {
  act(() => {
    useDashboardStore.setState({ shutdown } as Parameters<typeof useDashboardStore.setState>[0]);
  });
}

const header = () => screen.getByTestId('shutdown-banner-header');
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.history.replaceState(null, '', '/');
  toastError.mockClear();
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  setShutdown(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ShutdownBanner', () => {
  it('renders nothing without a shutdown', () => {
    setShutdown(null);
    render(<ShutdownBanner />);
    expect(screen.queryByTestId('shutdown-banner')).toBeNull();
  });

  it.each([
    [snapshot(), 'Shutting down · letting 2 sessions finish · 1:30 left'],
    [snapshot({ overdue: true, pending: snapshot().pending.slice(0, 1) }), 'Shutting down · past the deadline · 1 session still running'],
    [snapshot({ phase: 'waiting-for-writers', pending: [] }), 'Waiting for server work to finish'],
    [snapshot({ phase: 'verifying', pending: [] }), 'Checking that nothing is still writing'],
    [snapshot({ phase: 'complete', pending: [] }), 'Overdeck is shut down. It is safe to reboot.'],
    [snapshot({ phase: 'complete', pending: [], reboot: true }), 'Rebooting…'],
  ] as const)('shows the header for case %#: "%s"', (shutdown, text) => {
    setShutdown(shutdown);
    render(<ShutdownBanner />);
    expect(header()).toHaveTextContent(text);
  });

  it('counts down once a second and clamps at 0:00', async () => {
    setShutdown(snapshot());
    render(<ShutdownBanner />);
    expect(header()).toHaveTextContent('1:30 left');

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(header()).toHaveTextContent('1:29 left');

    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(header()).toHaveTextContent('0:30 left');

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(header()).toHaveTextContent('0:00 left');
  });

  it('shows each pending session with its tool and age, or its activity word', async () => {
    setShutdown(snapshot());
    render(<ShutdownBanner />);
    const rows = screen.getAllByTestId('shutdown-pending-row');
    expect(rows[0]).toHaveTextContent('PAN-7 work agentBash: Run the unit tests · 12s');
    expect(rows[1]).toHaveTextContent('Fort fixesthinking');

    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(rows[0]).toHaveTextContent('Bash: Run the unit tests · 15s');
  });

  it('posts the session id from Force stop', async () => {
    setShutdown(snapshot());
    render(<ShutdownBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Force stop PAN-7 work agent' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/shutdown/force-stop');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ id: 'agent-pan-7' });
  });

  it('posts Force all and Cancel shutdown, and toasts a route error', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/shutdown/cancel'
        ? Response.json({ error: 'The shutdown is already complete.' }, { status: 409 })
        : new Response('{}', { status: 200 }));
    setShutdown(snapshot());
    render(<ShutdownBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Force all' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel shutdown' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/shutdown/force-all', '/api/shutdown/cancel']);
    expect(toastError).toHaveBeenCalledWith('The shutdown is already complete.');
  });

  it('opens an agent at its issue and a conversation at /conv/<name>', () => {
    setShutdown(snapshot());
    render(<ShutdownBanner />);
    const [agentOpen, convOpen] = screen.getAllByRole('button', { name: 'Open' });
    fireEvent.click(agentOpen!);
    expect(window.location.pathname).toBe('/issues/PAN-7');
    fireEvent.click(convOpen!);
    expect(window.location.pathname).toBe('/conv/fort');
  });

  it('lists writers with their age, and hides Force all once nothing is pending', () => {
    setShutdown(snapshot({
      phase: 'waiting-for-writers',
      pending: [],
      writers: [{ kind: 'auto-merge', label: 'Merging PAN-9', startedAt: '2026-11-15T11:58:55.000Z' }],
    }));
    const { unmount } = render(<ShutdownBanner />);
    expect(screen.getByTestId('shutdown-writer-row')).toHaveTextContent('Merging PAN-9 · 1m 5s');
    expect(screen.getByRole('button', { name: 'Force all' })).toBeInTheDocument();
    unmount();

    setShutdown(snapshot({ phase: 'verifying', pending: [], writers: [] }));
    render(<ShutdownBanner />);
    expect(screen.queryByRole('button', { name: 'Force all' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel shutdown' })).toBeInTheDocument();
  });

  it('collapses the stopped count and keeps the warnings visible', () => {
    setShutdown(snapshot({ phase: 'complete', pending: [], stoppedCount: 4, warnings: ['/w/feature-pan-1: index.lock is present'] }));
    render(<ShutdownBanner />);
    expect(screen.getByText('4 stopped').closest('details')).not.toBeNull();
    const warnings = screen.getByTestId('shutdown-warnings');
    expect(warnings).toHaveTextContent('/w/feature-pan-1: index.lock is present');
    expect(warnings.closest('details')).toBeNull();
  });

  it('hides Force all, Cancel shutdown and Force stop in complete', () => {
    setShutdown(snapshot({ phase: 'complete' }));
    render(<ShutdownBanner />);
    expect(screen.queryByRole('button', { name: 'Force all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel shutdown' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Force stop/ })).toBeNull();
  });
});

describe('HiddenWhenShutDown', () => {
  it('hides its children only when the shutdown is complete', () => {
    setShutdown(null);
    render(<HiddenWhenShutDown><span data-testid="child" /></HiddenWhenShutDown>);
    expect(screen.getByTestId('child')).toBeInTheDocument();

    setShutdown(snapshot());
    expect(screen.getByTestId('child')).toBeInTheDocument();

    setShutdown(snapshot({ phase: 'complete' }));
    expect(screen.queryByTestId('child')).toBeNull();
  });
});
