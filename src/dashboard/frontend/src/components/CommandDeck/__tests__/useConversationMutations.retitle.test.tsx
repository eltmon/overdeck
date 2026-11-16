/**
 * PAN-4561: retitle-pending must change the mutations object's identity.
 * Memoized conversation rows re-render only when that object changes, and
 * under the React Compiler a useMemo dependency the body never reads is
 * dropped, so the pending state has to be something the memo reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/panesStore', () => ({
  closeConversationPanes: vi.fn(),
}));

import { useConversationMutations } from '../useConversationMutations';

const fetchMock = vi.fn();

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(['conversations'], []);
  return renderHook(() => useConversationMutations(null, vi.fn()), { wrapper: wrapper(client) });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useConversationMutations — retitle pending (PAN-4561)', () => {
  it('returns a new object when a retitle starts and again when it settles', async () => {
    let rejectFetch: (err: Error) => void = () => {};
    fetchMock.mockReturnValue(new Promise((_resolve, reject) => { rejectFetch = reject; }));
    const view = setup();
    const idle = view.result.current;
    expect(idle.isRetitlePending('a')).toBe(false);

    act(() => { view.result.current.retitle('a'); });

    await waitFor(() => expect(view.result.current.isRetitlePending('a')).toBe(true));
    const pending = view.result.current;
    expect(pending).not.toBe(idle);
    expect(pending.isRetitlePending('b')).toBe(false);

    await act(async () => { rejectFetch(new Error('network down')); });

    await waitFor(() => expect(view.result.current.isRetitlePending('a')).toBe(false));
    expect(view.result.current).not.toBe(pending);
  });

  it('ignores a second retitle of the same name while the first is pending', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const view = setup();

    act(() => {
      view.result.current.retitle('a');
      view.result.current.retitle('a');
    });

    await waitFor(() => expect(view.result.current.isRetitlePending('a')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
