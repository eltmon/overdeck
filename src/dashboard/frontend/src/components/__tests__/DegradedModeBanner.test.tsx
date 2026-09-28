import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionState, type ConnectionInputs } from '../../lib/connectionState';
import {
  DegradedModeBanner,
  FIRST_LOAD_DELAYED_GRACE_MS,
  RECONNECTED_CONFIRMATION_MS,
  formatDataTime,
} from '../DegradedModeBanner';

// PAN-4279 WI-3: one banner renders every outage state, with copy per phase.

const LAST_LIVE_AT = Date.parse('2026-09-27T23:30:00.000Z');
const LIVE: ConnectionInputs = {
  serverReachable: true,
  streamLive: true,
  restarting: false,
  hasSnapshot: true,
  lastLiveAt: LAST_LIVE_AT,
};

function setInputs(inputs: Partial<ConnectionInputs>) {
  act(() => {
    useConnectionState.setState(inputs);
  });
}

function renderBanner(props: Partial<React.ComponentProps<typeof DegradedModeBanner>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetchQueries = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
  const onRestartBackend = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <DegradedModeBanner lifecycle={{}} onRestartBackend={onRestartBackend} isRestartBackendPending={false} {...props} />
    </QueryClientProvider>,
  );
  return { onRestartBackend, refetchQueries };
}

function banner() {
  return document.querySelector<HTMLElement>('[data-component="degraded-mode-banner"]');
}

/** Mount live (the tab has been live once), then move to the given inputs. */
function renderAfterLive(inputs: Partial<ConnectionInputs>, props?: Parameters<typeof renderBanner>[0]) {
  useConnectionState.setState({ ...LIVE, reconnect: null });
  const result = renderBanner(props);
  setInputs(inputs);
  return result;
}

describe('DegradedModeBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing while live', () => {
    useConnectionState.setState({ ...LIVE, reconnect: null });
    renderBanner();
    expect(banner()).toBeNull();
  });

  it('reports an unreachable server with the data time, Retry and Force Restart', () => {
    const { onRestartBackend } = renderAfterLive({ serverReachable: false });
    const el = banner();
    expect(el?.dataset.phase).toBe('unreachable');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
    expect(el?.textContent).toMatch(/^Can't reach the Overdeck server — showing data from /);
    expect(el?.textContent).toContain(formatDataTime(LAST_LIVE_AT));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Force Restart' }));
    expect(onRestartBackend).toHaveBeenCalledTimes(1);
  });

  it('omits the data clause when no data time is known', () => {
    renderAfterLive({ serverReachable: false, lastLiveAt: null });
    expect(banner()?.querySelector('p')?.textContent).toBe("Can't reach the Overdeck server");
  });

  it('labels Force Restart while a restart is pending', () => {
    renderAfterLive({ serverReachable: false }, { isRestartBackendPending: true });
    const button = screen.getByRole('button', { name: 'Restarting…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('reports delayed live updates with Retry and never says the server is unreachable', () => {
    renderAfterLive({ streamLive: false });
    const el = banner();
    expect(el?.dataset.phase).toBe('delayed');
    expect(el?.textContent).toContain('Live updates are delayed — reconnecting · showing data from ');
    expect(el?.textContent).not.toContain('Server unreachable');
    expect(el?.textContent).not.toContain("Can't reach");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Force Restart' })).toBeNull();
  });

  it('reports a planned restart with the lifecycle issue and reason', () => {
    renderAfterLive({ restarting: true }, { lifecycle: { issueId: 'PAN-4279', reason: 'post-merge deploy' } });
    const el = banner();
    expect(el?.dataset.phase).toBe('restarting');
    expect(el?.textContent).toContain('Overdeck server is restarting — showing data from ');
    expect(el?.textContent).toContain('PAN-4279');
    expect(el?.textContent).toContain('(post-merge deploy)');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('confirms recovery for 2.5 s after an outage, then hides', () => {
    renderAfterLive({ serverReachable: false });
    expect(banner()?.dataset.phase).toBe('unreachable');

    setInputs({ serverReachable: true });
    expect(banner()?.textContent).toBe('Reconnected');

    act(() => {
      vi.advanceTimersByTime(RECONNECTED_CONFIRMATION_MS - 1);
    });
    expect(banner()?.textContent).toBe('Reconnected');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(banner()).toBeNull();
  });

  it('does not flash on a normal first load', () => {
    useConnectionState.setState({ ...LIVE, streamLive: false, hasSnapshot: false, lastLiveAt: null, reconnect: null });
    renderBanner();
    expect(banner()).toBeNull();

    setInputs({ streamLive: true, hasSnapshot: true, lastLiveAt: LAST_LIVE_AT });
    expect(banner()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(FIRST_LOAD_DELAYED_GRACE_MS);
    });
    expect(banner()).toBeNull();
  });

  it('reports a first load that stays delayed past the grace period', () => {
    useConnectionState.setState({ ...LIVE, streamLive: false, reconnect: null });
    renderBanner();
    act(() => {
      vi.advanceTimersByTime(FIRST_LOAD_DELAYED_GRACE_MS - 1);
    });
    expect(banner()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(banner()?.dataset.phase).toBe('delayed');
  });

  it('Retry calls the registered reconnect once and refetches the health poll', () => {
    const reconnect = vi.fn();
    const { refetchQueries } = renderAfterLive({ serverReachable: false });
    act(() => {
      useConnectionState.getState().registerReconnect(reconnect);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(refetchQueries).toHaveBeenCalledWith({ queryKey: ['backend-health'] });
  });
});
