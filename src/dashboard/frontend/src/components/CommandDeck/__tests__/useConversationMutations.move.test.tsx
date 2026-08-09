/**
 * PAN-1577: the shared `move` mutation used by both the menu action and
 * drag-drop. Optimistic re-group, rollback on error, and title-based toasts.
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useConversationMutations — move (PAN-1577)', () => {
  it('optimistically sets the moved conversation projectKey before the request settles', async () => {
    const target = conv({ name: 'conv-a', title: 'My Conversation', projectKey: 'krux' });
    const { view, client } = setup([target]);
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => {
      view.result.current.move({ name: 'conv-a', projectKey: 'myn', projectName: 'MYN' });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Conversation[]>(['conversations']);
      expect(cached?.find((c) => c.name === 'conv-a')?.projectKey).toBe('myn');
    });

    resolveFetch(new Response(JSON.stringify({ projectKey: 'myn' }), { status: 200 }));
  });

  it('rolls back the optimistic projectKey and shows an error toast when the request fails', async () => {
    const target = conv({ name: 'conv-b', title: 'Another Conversation', projectKey: 'krux' });
    const { view, client } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Unknown project: nope' }), { status: 400 }));

    act(() => {
      view.result.current.move({ name: 'conv-b', projectKey: 'nope', projectName: 'Nope' });
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Unknown project: nope', expect.anything());
    });

    const cached = client.getQueryData<Conversation[]>(['conversations']);
    expect(cached?.find((c) => c.name === 'conv-b')?.projectKey).toBe('krux');
  });

  it('shows a success toast with the conversation title and target project name (title, not id)', async () => {
    const target = conv({ name: 'conv-c', title: 'Ship the release notes', projectKey: null });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ projectKey: 'myn' }), { status: 200 }));

    act(() => {
      view.result.current.move({ name: 'conv-c', projectKey: 'myn', projectName: 'MYN' });
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Moved "Ship the release notes" to MYN', expect.anything());
    });
  });

  it('settles the cache from the server-confirmed response on success, without a redundant invalidate (review fix: avoid double refetch)', async () => {
    const target = conv({ name: 'conv-d', title: 'Settle test', projectKey: null });
    const { view, client } = setup([target]);
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ projectKey: 'myn' }), { status: 200 }));

    act(() => {
      view.result.current.move({ name: 'conv-d', projectKey: 'myn', projectName: 'MYN' });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Conversation[]>(['conversations']);
      expect(cached?.find((c) => c.name === 'conv-d')?.projectKey).toBe('myn');
    });

    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('invalidates the conversations query as a safety net when the request fails', async () => {
    const target = conv({ name: 'conv-e', title: 'Error settle test', projectKey: 'krux' });
    const { view, client } = setup([target]);
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));

    act(() => {
      view.result.current.move({ name: 'conv-e', projectKey: 'myn', projectName: 'MYN' });
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversations'] });
    });
  });
});
