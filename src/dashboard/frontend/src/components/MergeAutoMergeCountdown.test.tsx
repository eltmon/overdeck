import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MergeAutoMergeCountdown } from './MergeAutoMergeCountdown';
import { useDashboardStore } from '../lib/store';

const baseNow = new Date('2026-05-23T12:00:00.000Z');

function renderCountdown(props: Partial<Parameters<typeof MergeAutoMergeCountdown>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MergeAutoMergeCountdown
        issueId="PAN-1418"
        executeAt="2026-05-23T12:02:05.000Z"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('MergeAutoMergeCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(baseNow);
    vi.stubGlobal('fetch', vi.fn());
    useDashboardStore.setState({ rpcConnected: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders and updates the M:SS countdown every second', async () => {
    renderCountdown();

    expect(screen.getByText('Auto-merging in')).toBeTruthy();
    expect(screen.getByText('2:05')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText('2:04')).toBeTruthy();
  });

  it('posts cancellation and shows a loading state while in flight', async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValue(fetchPromise);
    const onCancel = vi.fn();
    renderCountdown({ onCancel });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await Promise.resolve();
    });

    expect(screen.getByText('Cancelling…')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith('/api/issues/PAN-1418/merge/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'manual' }),
    });

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
      await fetchPromise;
      await Promise.resolve();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows the disconnected local-view warning when the RPC stream is down', () => {
    useDashboardStore.setState({ rpcConnected: false });

    renderCountdown();

    expect(screen.getByText('Connection lost')).toBeTruthy();
    expect(screen.getByText('(local view — host may be offline)')).toBeTruthy();
  });

  it('renders nothing after the executeAt time passes', async () => {
    const { container } = renderCountdown({ executeAt: '2026-05-23T12:00:01.000Z' });

    expect(screen.getByText('0:01')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(container.textContent).toBe('');
  });
});
