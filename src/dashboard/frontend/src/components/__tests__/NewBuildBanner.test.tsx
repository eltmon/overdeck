import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NewBuildBanner } from '../NewBuildBanner';
import { RELOADED_FOR_KEY, useBuildDrift } from '../../lib/buildDrift';
import { useConnectionState } from '../../lib/connectionState';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function fetchFor(buildCommit: string | null | undefined) {
  return vi.fn(async () => jsonResponse(buildCommit === undefined ? { status: 'ok' } : { status: 'ok', buildCommit }));
}

function goLive() {
  act(() => {
    useConnectionState.setState({ streamLive: false });
    useConnectionState.setState({ streamLive: true });
  });
}

function banner() {
  return document.querySelector<HTMLElement>('[data-component="new-build-banner"]');
}

beforeEach(() => {
  useConnectionState.setState({ streamLive: false });
  useBuildDrift.setState({ serverCommit: null });
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NewBuildBanner (PAN-5236)', () => {
  it('renders on a bundle/server mismatch with the Reload button', async () => {
    const fetchImpl = fetchFor('bbb222');
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(banner()?.textContent).toContain('A newer Overdeck is running. Reload to update.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('renders nothing when the commits match', async () => {
    const fetchImpl = fetchFor('aaa111');
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(banner()).toBeNull();
  });

  it('renders nothing when the bundle commit is null', async () => {
    const fetchImpl = fetchFor('bbb222');
    render(<NewBuildBanner bundleCommit={null} fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(banner()).toBeNull();
  });

  it('renders nothing when the health body has no buildCommit', async () => {
    const fetchImpl = fetchFor(undefined);
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(banner()).toBeNull();
  });

  it('shows "Unsent drafts are kept." only with a saved draft', async () => {
    localStorage.setItem('conv-draft:c1', 'half-typed');
    const fetchImpl = fetchFor('bbb222');
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(banner()?.textContent).toContain('Unsent drafts are kept.');
  });

  it('omits the drafts sentence with no saved draft', async () => {
    const fetchImpl = fetchFor('bbb222');
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(banner()).not.toBeNull());
    expect(banner()?.textContent).not.toContain('Unsent drafts are kept.');
  });

  it('Reload calls reload once, keeps the draft, and marks the server commit tried', async () => {
    localStorage.setItem('conv-draft:c1', 'half-typed');
    const fetchImpl = fetchFor('bbb222');
    const reload = vi.fn();
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} reload={reload} />);
    goLive();
    await waitFor(() => expect(banner()).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('conv-draft:c1')).toBe('half-typed');
    expect(sessionStorage.getItem(RELOADED_FOR_KEY)).toBe('bbb222');
  });

  it('hides the banner after a remount for a tried server commit, and shows it again for a new one', async () => {
    sessionStorage.setItem(RELOADED_FOR_KEY, 'bbb222');
    const fetchImpl = fetchFor('bbb222');
    const first = render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} />);
    goLive();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(banner()).toBeNull();
    first.unmount();

    const fetchImpl2 = fetchFor('ccc333');
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl2} />);
    goLive();
    await waitFor(() => expect(banner()).not.toBeNull());
  });

  it('never calls reload on its own, even after 10 minutes', async () => {
    const fetchImpl = fetchFor('bbb222');
    const reload = vi.fn();
    render(<NewBuildBanner bundleCommit="aaa111" fetchImpl={fetchImpl} reload={reload} />);
    goLive();
    await waitFor(() => expect(banner()).not.toBeNull());

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    });
    expect(reload).not.toHaveBeenCalled();
  });
});
