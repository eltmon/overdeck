import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionState } from '../../../../../src/dashboard/frontend/src/lib/connectionState';
import { installResumeHandler, markResumed, RESUME_BANNER_WINDOW_MS } from '../lifecycle';
import { UpdatingBanner } from '../UpdatingBanner';

function fakeApp() {
  const listeners: Array<(state: { isActive: boolean }) => void> = [];
  return {
    listeners,
    app: {
      addListener: vi.fn(async (_event: string, listener: (state: { isActive: boolean }) => void) => {
        listeners.push(listener);
        return { remove: vi.fn() };
      }),
    } as never,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  useConnectionState.setState({ serverReachable: true, streamLive: true, restarting: false, sessionAuthFailed: false });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('installResumeHandler', () => {
  it('restarts the directory, forgets routes and resets the transport once per resume', () => {
    const { app, listeners } = fakeApp();
    const directory = { stop: vi.fn(), start: vi.fn(async () => undefined) };
    const connection = { forgetRoutes: vi.fn() };
    const resetTransport = vi.fn();
    installResumeHandler(() => ({ directory, connection, resetTransport }), app);

    listeners[0]!({ isActive: false });
    expect(resetTransport).not.toHaveBeenCalled();

    listeners[0]!({ isActive: true });
    expect(directory.stop).toHaveBeenCalledTimes(1);
    expect(directory.start).toHaveBeenCalledTimes(1);
    expect(directory.stop.mock.invocationCallOrder[0]).toBeLessThan(directory.start.mock.invocationCallOrder[0]!);
    expect(connection.forgetRoutes).toHaveBeenCalledTimes(1);
    expect(resetTransport).toHaveBeenCalledTimes(1);
  });

  it('refreshes the Live Activity on each resume (PAN-4839)', () => {
    const { app, listeners } = fakeApp();
    const liveActivity = { refresh: vi.fn(async () => undefined) };
    installResumeHandler(() => ({ directory: null, connection: null, resetTransport: vi.fn(), liveActivity }), app);
    listeners[0]!({ isActive: false });
    expect(liveActivity.refresh).not.toHaveBeenCalled();
    listeners[0]!({ isActive: true });
    listeners[0]!({ isActive: true });
    expect(liveActivity.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('UpdatingBanner', () => {
  it('shows "Updating…" after a resume while the connection is not live, and hides once live', () => {
    render(<UpdatingBanner />);
    expect(screen.queryByText('Updating…')).toBeNull();

    act(() => {
      useConnectionState.setState({ serverReachable: false });
      markResumed();
    });
    expect(screen.getByText('Updating…')).toBeTruthy();

    act(() => useConnectionState.setState({ serverReachable: true, streamLive: true }));
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  it('stops showing 30 s after the resume even if the connection is still down', async () => {
    render(<UpdatingBanner />);
    act(() => {
      useConnectionState.setState({ streamLive: false });
      markResumed();
    });
    expect(screen.getByText('Updating…')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(RESUME_BANNER_WINDOW_MS));
    expect(screen.queryByText('Updating…')).toBeNull();
  });
});
