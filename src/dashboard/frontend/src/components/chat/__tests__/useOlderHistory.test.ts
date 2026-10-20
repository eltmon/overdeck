import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../chat-types';
import type { HistoryRows } from '../conversationHistory';
import { useOlderHistory } from '../useOlderHistory';

const KEY = ['conversation-messages', 'conv-paging'] as const;
const at = (i: number) => new Date(Date.UTC(2026, 9, 19) + i * 1000).toISOString();
const message = (i: number): ChatMessage => ({ id: `m${i}`, role: 'user', text: `m${i}`, createdAt: at(i), sequence: i });
const cursor = (i: number) => JSON.stringify([at(i), i, 0, `m${i}`]);
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, k) => message(from + k));

/** A server holding m0..m(total-1) that pages `size` rows before a cursor. */
function stubPagingServer(total: number, size: number) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost');
    const before = JSON.parse(url.searchParams.get('before')!) as [string, number];
    const end = before[1];
    const start = Math.max(0, end - size);
    return Response.json({
      messages: range(start, end), workLog: [],
      window: { cursor: start < end ? cursor(start) : null, hasOlder: start > 0, transcript: '1:2' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setup(initial: HistoryRows) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(KEY, initial);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(
    () => useOlderHistory({ queryKey: KEY, pagePath: '/api/conversations/conv-paging/messages', history: client.getQueryData<HistoryRows>(KEY)?.history }),
    { wrapper },
  );
  return { client, hook };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useOlderHistory (PAN-4558)', () => {
  it('pages a five-page history to the start of the conversation with no duplicated rows', async () => {
    const fetchMock = stubPagingServer(400, 75);
    const { client, hook } = setup({ messages: range(325, 400), workLog: [], history: { cursor: cursor(325), hasOlder: true, transcript: '1:2' } });

    for (let i = 0; i < 10 && client.getQueryData<HistoryRows>(KEY)!.history!.hasOlder; i++) {
      await act(() => hook.result.current.loadOlder());
    }

    const cache = client.getQueryData<HistoryRows>(KEY)!;
    expect(cache.messages.map((m) => m.id)).toEqual(range(0, 400).map((m) => m.id));
    expect(cache.history).toMatchObject({ cursor: cursor(0), hasOlder: false });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/conversations/conv-paging/messages?before=${encodeURIComponent(cursor(325))}&limit=75`);
    expect(hook.result.current.loadedOlder).toBe(true);
  });

  it('keeps one request in flight at a time', async () => {
    const fetchMock = stubPagingServer(200, 75);
    const { hook } = setup({ messages: range(150, 200), workLog: [], history: { cursor: cursor(150), hasOlder: true } });
    await act(async () => {
      await Promise.all([hook.result.current.loadOlder(), hook.result.current.loadOlder()]);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a page whose cursor went stale while it was loading', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    const { client, hook } = setup({ messages: range(150, 200), workLog: [], history: { cursor: cursor(150), hasOlder: true } });

    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.loadOlder(); });
    // A reset snapshot replaced the cache meanwhile.
    client.setQueryData<HistoryRows>(KEY, { messages: range(180, 200), workLog: [], history: { cursor: cursor(180), hasOlder: true } });
    await act(async () => {
      release(Response.json({ messages: range(75, 150), workLog: [], window: { cursor: cursor(75), hasOlder: true } }));
      await pending;
    });
    expect(client.getQueryData<HistoryRows>(KEY)!.messages.map((m) => m.id)).toEqual(range(180, 200).map((m) => m.id));
  });

  it('loads older pages until a message id is present', async () => {
    stubPagingServer(400, 75);
    const { client, hook } = setup({ messages: range(325, 400), workLog: [], history: { cursor: cursor(325), hasOlder: true } });
    let found = false;
    await act(async () => { found = await hook.result.current.loadOlderUntil('m120'); });
    expect(found).toBe(true);
    expect(client.getQueryData<HistoryRows>(KEY)!.messages.some((m) => m.id === 'm120')).toBe(true);
    expect(client.getQueryData<HistoryRows>(KEY)!.history!.hasOlder).toBe(true);
  });

  it('resolves false when the id is not in the transcript', async () => {
    stubPagingServer(100, 75);
    const { hook } = setup({ messages: range(75, 100), workLog: [], history: { cursor: cursor(75), hasOlder: true } });
    let found = true;
    await act(async () => { found = await hook.result.current.loadOlderUntil('missing'); });
    expect(found).toBe(false);
  });
});
