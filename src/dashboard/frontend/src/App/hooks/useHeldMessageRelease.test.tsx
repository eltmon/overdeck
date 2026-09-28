/**
 * PAN-4278 — composer messages held behind a permission prompt: the held
 * bubble's label, and their release (fresh clientMessageId, no retry flag)
 * once a feed read newer than the hold shows no pendingPermission.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetComposerStore, useComposerStore } from '../../lib/composerStore';
import { UserMessageRow } from '../../components/chat/messagesTimeline/messageRows';
import { useHeldMessageRelease } from './useHeldMessageRelease';

const CONV = '20260927-3978';
const T0 = new Date('2026-09-27T15:24:00.000Z');
const FEED_KEY = ['conv-ask-user-question'];
const store = () => useComposerStore.getState();
const optimistic = () => store().byConversation[CONV]?.optimistic ?? [];

const PERMISSION_ROW = {
  name: CONV,
  pendingPermission: {
    signature: 'sig', answerable: true, agentLabel: 'Main agent', agentKey: 'main', toolName: 'Bash',
    header: 'Bash command', detailLines: [], reason: null, options: [], since: T0.toISOString(),
  },
};

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
const messagePosts = () => fetchMock.mock.calls
  .filter(([url]) => String(url) === `/api/conversations/${CONV}/message`)
  .map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);

function holdMessage(text: string, clientMessageId: string) {
  store().addOptimistic(CONV, text, 0, { clientMessageId });
  store().hold(CONV, clientMessageId);
}

function renderRelease() {
  return renderHook(() => useHeldMessageRelease(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

async function feed(rows: unknown[], at: number) {
  vi.setSystemTime(at);
  await act(async () => {
    queryClient.setQueryData(FEED_KEY, rows);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetComposerStore();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  queryClient.setQueryData(FEED_KEY, [PERMISSION_ROW]);
  fetchMock = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('held composer messages', () => {
  it('a 409 permission-pending leaves a held bubble with the waiting label', () => {
    holdMessage('Look like a lot of stuff has been merged?', 'orig-1');
    expect(optimistic()[0]).toMatchObject({ deliveryState: 'held', heldAt: T0.getTime() });
    render(<UserMessageRow message={optimistic()[0]!} />);
    expect(screen.getByText(/Waiting: the agent needs a permission answer first/)).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Discard' }).click());
    expect(optimistic()).toEqual([]);
  });

  it('held messages stay held while pendingPermission remains', async () => {
    holdMessage('BTW How can I launch Orca?', 'orig-1');
    renderRelease();
    await feed([PERMISSION_ROW], T0.getTime() + 4000);
    expect(messagePosts()).toEqual([]);
    expect(optimistic()[0]!.deliveryState).toBe('held');
  });

  it('does not release on a feed read older than the hold', async () => {
    vi.setSystemTime(T0.getTime() + 10_000);
    holdMessage('BTW How can I launch Orca?', 'orig-1');
    await feed([], T0.getTime() + 5000);
    renderRelease();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(messagePosts()).toEqual([]);
  });

  it('held messages resend when the feed drops pendingPermission', async () => {
    holdMessage('Look like a lot of stuff has been merged?', 'orig-1');
    holdMessage('BTW How can I launch Orca?', 'orig-2');
    renderRelease();
    await feed([], T0.getTime() + 4000);
    expect(messagePosts().map((body) => body.message)).toEqual([
      'Look like a lot of stuff has been merged?',
      'BTW How can I launch Orca?',
    ]);
    expect(optimistic().map((m) => m.deliveryState)).toEqual(['accepted', 'accepted']);
  });

  it('releases on a row that no longer carries pendingPermission', async () => {
    holdMessage('BTW How can I launch Orca?', 'orig-1');
    renderRelease();
    await feed([{ name: CONV, pendingAskUserQuestion: { toolUseId: 't', askedAt: T0.toISOString(), questions: [] } }], T0.getTime() + 4000);
    expect(messagePosts().map((body) => body.message)).toEqual(['BTW How can I launch Orca?']);
  });

  it('the resend uses a new clientMessageId', async () => {
    holdMessage('BTW How can I launch Orca?', 'orig-1');
    renderRelease();
    await feed([], T0.getTime() + 4000);
    const [body] = messagePosts();
    expect(body!.clientMessageId).toEqual(expect.any(String));
    expect(body!.clientMessageId).not.toBe('orig-1');
    expect(body).not.toHaveProperty('retry');
    expect(optimistic()[0]!.clientMessageId).toBe(body!.clientMessageId);
  });

  it('a second permission-pending re-holds the message', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      error: 'Waiting: the agent needs a permission answer first', code: 'permission-pending', deliveryUnknown: false, retryable: true,
    }), { status: 409 }));
    holdMessage('BTW How can I launch Orca?', 'orig-1');
    renderRelease();
    await feed([], T0.getTime() + 4000);
    expect(messagePosts()).toHaveLength(1);
    expect(optimistic()[0]).toMatchObject({ deliveryState: 'held', heldAt: T0.getTime() + 4000 });
    expect(store().byConversation[CONV]!.failed).toEqual([]);
  });
});
