/**
 * PAN-4626: the shared stop-pending state (mutationKey ['conversation-stop'])
 * read via useMutationState, the per-name dedupe guard, and the error toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/panesStore', () => ({
  closeConversationPanes: vi.fn(),
}));

import { toast } from 'sonner';
import { useConversationMutations } from '../useConversationMutations';
import type { Conversation } from '../ConversationList';

const fetchMock = vi.fn();

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function conv(overrides: Partial<Conversation> & { name: string }): Conversation {
  return {
    id: 1,
    tmuxSession: `conv-${overrides.name}`,
    status: 'active',
    cwd: '/tmp/wherever',
    issueId: null,
    createdAt: new Date().toISOString(),
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: true,
    projectKey: null,
    title: overrides.name,
    ...overrides,
  };
}

function setup(initialConversations: Conversation[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['conversations'], initialConversations);
  const view = renderHook(() => useConversationMutations(null, vi.fn()), { wrapper: wrapper(client) });
  return { view, client };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useConversationMutations — stop (PAN-4626)', () => {
  it('reports stop pending for the stopped name only, before the request resolves', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockReturnValue(new Promise(() => {}));

    act(() => { view.result.current.stop('a'); });

    await waitFor(() => expect(view.result.current.isStopPending('a')).toBe(true));
    expect(view.result.current.isStopPending('b')).toBe(false);
  });

  it('shares stop pending across hook instances sharing a QueryClient and dedupes the second call', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['conversations'], [target]);
    fetchMock.mockReturnValue(new Promise(() => {}));

    const instanceA = renderHook(() => useConversationMutations(null, vi.fn()), { wrapper: wrapper(client) });
    const instanceB = renderHook(() => useConversationMutations(null, vi.fn()), { wrapper: wrapper(client) });

    act(() => { instanceA.result.current.stop('a'); });

    await waitFor(() => expect(instanceB.result.current.isStopPending('a')).toBe(true));

    act(() => { instanceB.result.current.stop('a'); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a pending stop for one conversation does not block stop() for another', async () => {
    const a = conv({ name: 'a', title: 'Alpha' });
    const b = conv({ name: 'b', title: 'Bravo' });
    const { view } = setup([a, b]);
    fetchMock.mockReturnValue(new Promise(() => {}));

    act(() => { view.result.current.stop('a'); });
    await waitFor(() => expect(view.result.current.isStopPending('a')).toBe(true));

    act(() => { view.result.current.stop('b'); });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/conversations/b/stop');
  });

  it('on error: toasts the server message and clears pending', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Stop exploded' }), { status: 500 }));

    act(() => { view.result.current.stop('a'); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Stop exploded', { duration: 6000 }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(view.result.current.isStopPending('a')).toBe(false);
  });

  it('falls back to the generic message on a non-JSON 500 body', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response('not json', { status: 500 }));

    act(() => { view.result.current.stop('a'); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to stop conversation', { duration: 6000 }));
  });

  it('stays pending until the conversations refetch resolves, then deselects', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    let resolveRefetch: ((rows: Conversation[]) => void) | null = null;
    const queryFn = vi.fn(() => new Promise<Conversation[]>((resolve) => { resolveRefetch = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['conversations'], [target]);
    const onSelect = vi.fn();
    const view = renderHook(() => {
      useQuery({ queryKey: ['conversations'], queryFn, staleTime: Infinity });
      return useConversationMutations('a', onSelect);
    }, { wrapper: wrapper(client) });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    act(() => { view.result.current.stop('a'); });
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

    expect(view.result.current.isStopPending('a')).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();

    act(() => { resolveRefetch?.([]); });

    await waitFor(() => expect(view.result.current.isStopPending('a')).toBe(false));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
