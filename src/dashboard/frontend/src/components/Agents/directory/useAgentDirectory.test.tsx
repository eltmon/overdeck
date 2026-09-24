import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardStore } from '../../../lib/store';
import { PANE_INVALIDATE_THROTTLE_MS, useAgentDirectory } from './useAgentDirectory';

let visibility: DocumentVisibilityState = 'visible';

function paneChange(n: number) {
  act(() => {
    useDashboardStore.setState({
      backendPanesById: { [`w1:p${n}`]: { id: `w1:p${n}`, role: 'work', harness: 'claude-code', model: 'm', state: 'working' } },
    } as Parameters<typeof useDashboardStore.setState>[0]);
  });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  renderHook(() => useAgentDirectory(24), { wrapper });
  return invalidate;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ generatedAt: '', windowHours: 24, entries: [] }))));
  useDashboardStore.setState({ backendPanesById: {} } as Parameters<typeof useDashboardStore.setState>[0]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAgentDirectory pane-driven refetch', () => {
  it('invalidates on a pane change, then once more on the trailing edge of the throttle', async () => {
    const invalidate = setup();
    paneChange(1);
    expect(invalidate).toHaveBeenCalledTimes(1);

    paneChange(2);
    paneChange(3);
    expect(invalidate).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(PANE_INVALIDATE_THROTTLE_MS); });
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate while the document is hidden', async () => {
    const invalidate = setup();
    visibility = 'hidden';
    paneChange(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(PANE_INVALIDATE_THROTTLE_MS * 2); });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('drops a pending trailing refetch when the tab is hidden before it fires', async () => {
    const invalidate = setup();
    paneChange(1);
    paneChange(2);
    visibility = 'hidden';
    await act(async () => { await vi.advanceTimersByTimeAsync(PANE_INVALIDATE_THROTTLE_MS); });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
