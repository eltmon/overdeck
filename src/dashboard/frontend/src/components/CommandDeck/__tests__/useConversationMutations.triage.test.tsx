/**
 * PAN-4639 WI-6: the triage mutation — optimistic D3 update, rollback on
 * error, the module-level undo stack, and the toast's Undo action.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { toastFn, toastErrorFn } = vi.hoisted(() => ({ toastFn: vi.fn(), toastErrorFn: vi.fn() }));
vi.mock('sonner', () => ({
  toast: Object.assign(toastFn, { error: toastErrorFn, success: vi.fn() }),
}));

vi.mock('../../../lib/panesStore', () => ({
  closeConversationPanes: vi.fn(),
}));

import { useConversationMutations, __resetTriageUndoStackForTests } from '../useConversationMutations';
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

function lastRequestBody(): unknown {
  const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return JSON.parse(call[1].body as string);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  __resetTriageUndoStackForTests();
  toastFn.mockClear();
  toastErrorFn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useConversationMutations — triage (PAN-4639 WI-6)', () => {
  it('triage-mutation.ac1: settling sets a non-null settledAt before the fetch resolves and sends exactly one POST', async () => {
    const target = conv({ name: 'conv-a' });
    const { view, client } = setup([target]);
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => {
      view.result.current.triage({ updates: [{ name: 'conv-a', settled: true }], label: 'Settled "conv-a"' });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Conversation[]>(['conversations']);
      expect(cached?.find((c) => c.name === 'conv-a')?.settledAt).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/triage', expect.objectContaining({ method: 'POST' }));
    expect(lastRequestBody()).toEqual({ updates: [{ name: 'conv-a', settled: true }] });

    resolveFetch(new Response(JSON.stringify({ conversations: [], notFound: [], rejected: [] }), { status: 200 }));
  });

  it('triage-mutation.ac2: Undo on a snoozed-then-settled conversation sends {settled: false, snoozedUntil: T}', async () => {
    const until = '2026-12-01T09:00:00.000Z';
    const target = conv({ name: 'conv-b', snoozedUntil: until });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ conversations: [], notFound: [], rejected: [] }), { status: 200 }));

    act(() => {
      view.result.current.triage({ updates: [{ name: 'conv-b', settled: true }], label: 'Settled "conv-b"' });
    });

    await waitFor(() => expect(toastFn).toHaveBeenCalledWith('Settled "conv-b"', expect.anything()));
    const [, options] = toastFn.mock.calls.at(-1) as [string, { action: { onClick: () => void } }];

    act(() => {
      options.action.onClick();
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastRequestBody()).toEqual({ updates: [{ name: 'conv-b', settled: false, snoozedUntil: until }] });
  });

  it('triage-mutation.ac3: a failed request restores the prior triage state and calls toast.error; undo on an empty stack sends nothing', async () => {
    const target = conv({ name: 'conv-c' });
    const { view, client } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));

    act(() => {
      view.result.current.triage({ updates: [{ name: 'conv-c', settled: true }], label: 'Settled "conv-c"' });
    });

    await waitFor(() => expect(toastErrorFn).toHaveBeenCalledWith('boom', expect.anything()));
    const cached = client.getQueryData<Conversation[]>(['conversations']);
    expect(cached?.find((c) => c.name === 'conv-c')?.settledAt).toBeNull();

    fetchMock.mockClear();
    let undone: boolean = true;
    act(() => {
      undone = view.result.current.undoLastTriage();
    });
    expect(undone).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('undoLastTriage pops the newest entry and replays its priors', async () => {
    const target = conv({ name: 'conv-d' });
    const { view } = setup([target]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ conversations: [], notFound: [], rejected: [] }), { status: 200 }));

    act(() => {
      view.result.current.triage({ updates: [{ name: 'conv-d', settled: true }], label: 'Settled "conv-d"' });
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    let undone = false;
    act(() => {
      undone = view.result.current.undoLastTriage();
    });
    expect(undone).toBe(true);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastRequestBody()).toEqual({ updates: [{ name: 'conv-d', settled: false, snoozedUntil: null }] });
  });
});

describe('useConversationMutations — setAutoSettleOverride (PAN-4653 WI-7)', () => {
  it('posts an override-only update, updates the cached row before the response, and pushes no undo entry', async () => {
    const { view, client } = setup([conv({ name: 'conv-o' })]);
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => { resolveFetch = resolve; }));

    act(() => {
      view.result.current.setAutoSettleOverride({ name: 'conv-o', override: 'off' });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Conversation[]>(['conversations']);
      expect(cached?.find((c) => c.name === 'conv-o')?.autoSettleOverride).toBe('off');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/triage', expect.objectContaining({ method: 'POST' }));
    expect(lastRequestBody()).toEqual({ updates: [{ name: 'conv-o', autoSettleOverride: 'off' }] });

    await act(async () => {
      resolveFetch(new Response(JSON.stringify({ conversations: [], notFound: [], rejected: [] }), { status: 200 }));
    });
    await waitFor(() => expect(client.isMutating()).toBe(0));

    let undone = true;
    act(() => {
      undone = view.result.current.undoLastTriage();
    });
    expect(undone).toBe(false);
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('restores the prior override and calls toast.error when the request fails', async () => {
    const { view, client } = setup([conv({ name: 'conv-p', autoSettleOverride: 'on' })]);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }));

    act(() => {
      view.result.current.setAutoSettleOverride({ name: 'conv-p', override: 'off' });
    });

    await waitFor(() => expect(toastErrorFn).toHaveBeenCalledWith('boom', expect.anything()));
    const cached = client.getQueryData<Conversation[]>(['conversations']);
    expect(cached?.find((c) => c.name === 'conv-p')?.autoSettleOverride).toBe('on');
  });
});
