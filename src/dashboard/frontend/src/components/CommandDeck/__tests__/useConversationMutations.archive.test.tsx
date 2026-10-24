/**
 * PAN-4584: the shared archive-pending state (mutationKey
 * ['conversation-archive']) read via useMutationState, the call-time dedupe
 * guard, and the success/error toasts.
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

import { toast } from 'sonner';
import { closeConversationPanes } from '../../../lib/panesStore';
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
  vi.mocked(closeConversationPanes).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useConversationMutations — archive (PAN-4584)', () => {
  it('reports pending for the archived name only, before the request resolves', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockReturnValue(new Promise(() => {}));

    act(() => { view.result.current.archive('a'); });

    await waitFor(() => expect(view.result.current.isArchivePending('a')).toBe(true));
    expect(view.result.current.isArchivePending('b')).toBe(false);
  });

  it('shares pending state across hook instances sharing a QueryClient and dedupes the second call', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['conversations'], [target]);
    fetchMock.mockReturnValue(new Promise(() => {}));

    const instanceA = renderHook(() => useConversationMutations(null, vi.fn()), { wrapper: wrapper(client) });
    const instanceB = renderHook(() => useConversationMutations(null, vi.fn()), { wrapper: wrapper(client) });

    act(() => { instanceA.result.current.archive('a'); });

    await waitFor(() => expect(instanceB.result.current.isArchivePending('a')).toBe(true));

    act(() => { instanceB.result.current.archive('a'); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes two archive calls for the same name within one act', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockReturnValue(new Promise(() => {}));

    act(() => {
      view.result.current.archive('a');
      view.result.current.archive('a');
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it('on success: toasts the title, closes the panes, fires the per-call onSuccess, and clears pending', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const onSuccess = vi.fn();

    act(() => { view.result.current.archive('a', { onSuccess }); });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Archived "Alpha"', { duration: 4000 }));
    expect(closeConversationPanes).toHaveBeenCalledWith('a');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(view.result.current.isArchivePending('a')).toBe(false);
  });

  it('on error: toasts the server message, skips closing panes and the per-call onSuccess, and clears pending', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Archive exploded' }), { status: 500 }));
    const onSuccess = vi.fn();

    act(() => { view.result.current.archive('a', { onSuccess }); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Archive exploded', { duration: 6000 }));
    expect(closeConversationPanes).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(view.result.current.isArchivePending('a')).toBe(false);
  });

  it('falls back to the generic message on a non-JSON 500 body', async () => {
    const target = conv({ name: 'a', title: 'Alpha' });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response('not json', { status: 500 }));

    act(() => { view.result.current.archive('a'); });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to archive conversation', { duration: 6000 }));
  });
});
