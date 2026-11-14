/**
 * PAN-5237 — cancelling a composer message while it shows "Sending…".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueConversationSend } from '../composerSendQueue';
import {
  registerComposerRestoreTarget,
  resetComposerStore,
  runCancellableSend,
  sendConversationMessage,
  useComposerStore,
} from '../composerStore';

const CONV = 'cancel-conv';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Deferred { promise: Promise<Response>; resolve(response: Response): void }
function deferred(): Deferred {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((r) => { resolve = r; });
  return { promise, resolve };
}

const state = () => useComposerStore.getState();
const slice = () => state().byConversation[CONV];
const bubble = (clientMessageId: string) => slice()?.optimistic.find((m) => m.clientMessageId === clientMessageId);

describe('composer cancel (PAN-5237)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let messagePosts: Array<{ url: string; body: Record<string, unknown>; signal: AbortSignal | undefined }>;
  let messageResponses: Deferred[];
  let cancelResponse: () => Promise<Response>;

  beforeEach(() => {
    resetComposerStore();
    messagePosts = [];
    messageResponses = [];
    cancelResponse = async () => json(200, { outcome: 'cancelled' });
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/message/cancel')) return cancelResponse();
      messagePosts.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown>, signal: init?.signal ?? undefined });
      const next = deferred();
      messageResponses.push(next);
      return next.promise;
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A queued bubble whose POST starts through runCancellableSend. */
  function startSend(clientMessageId: string, agentId?: string) {
    state().addOptimistic(CONV, `text ${clientMessageId}`, 0, { clientMessageId, sendPhase: 'queued' });
    return runCancellableSend(CONV, clientMessageId, agentId ? 'agent' : 'conversation', () =>
      sendConversationMessage(CONV, `text ${clientMessageId}`, agentId, undefined, undefined, { clientMessageId }));
  }

  const cancelCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/message/cancel'));

  it('in-flight cancel with outcome cancelled removes the bubble and the late 409 cancelled adds no failure', async () => {
    const send = startSend('c1');
    await vi.waitFor(() => expect(messagePosts).toHaveLength(1));
    expect(bubble('c1')).toMatchObject({ sendPhase: 'in-flight', sendRoute: 'conversation' });

    await state().cancelSend(bubble('c1')!.id);
    expect(bubble('c1')).toBeUndefined();
    expect(cancelCalls()).toHaveLength(1);
    expect(JSON.parse(String(cancelCalls()[0]![1]!.body))).toEqual({ clientMessageId: 'c1' });

    messageResponses[0]!.resolve(json(409, { error: 'Cancelled before delivery', code: 'cancelled', deliveryUnknown: false, retryable: false }));
    expect(await send).toEqual({ cancelled: true });
    // Only the Cancelled entry from the cancel itself, never a failure entry.
    expect(slice()?.failed).toEqual([expect.objectContaining({ code: 'cancelled', text: 'text c1', retryable: true, deliveryUnknown: false })]);
    expect(messagePosts[0]!.signal?.aborted).toBe(false);
  });

  it('in-flight cancel with outcome delivered keeps the bubble as too-late and the 200 acknowledges it', async () => {
    cancelResponse = async () => json(200, { outcome: 'delivered' });
    const send = startSend('c1');
    await vi.waitFor(() => expect(messagePosts).toHaveLength(1));
    await state().cancelSend(bubble('c1')!.id);
    expect(bubble('c1')?.cancelState).toBe('too-late');

    messageResponses[0]!.resolve(new Response('', { status: 200 }));
    expect(await send).toEqual({ cancelled: false, result: null });
    state().acknowledgeOptimistic(CONV, 'text c1', 'c1');
    expect(bubble('c1')).toMatchObject({ acknowledged: true });
    expect(slice()?.failed ?? []).toEqual([]);
  });

  it.each([
    ['outcome unknown', async () => json(200, { outcome: 'unknown' })],
    ['a failed cancel request', async () => { throw new TypeError('network down'); }],
    ['a 500 answer', async () => json(500, { error: 'boom' })],
  ])('%s sets cancelState unconfirmed and keeps the bubble', async (_label, response) => {
    cancelResponse = response;
    void startSend('c1');
    await vi.waitFor(() => expect(messagePosts).toHaveLength(1));
    await state().cancelSend(bubble('c1')!.id);
    expect(bubble('c1')?.cancelState).toBe('unconfirmed');
  });

  it('an in-flight agent-route bubble ignores cancelSend', async () => {
    void startSend('c1', 'agent-7');
    await vi.waitFor(() => expect(messagePosts).toHaveLength(1));
    expect(bubble('c1')).toMatchObject({ sendPhase: 'in-flight', sendRoute: 'agent' });
    await state().cancelSend(bubble('c1')!.id);
    expect(cancelCalls()).toHaveLength(0);
    expect(bubble('c1')?.cancelState).toBeUndefined();
  });

  it('a bubble without sendPhase is never cancellable', async () => {
    state().addOptimistic(CONV, 'plain', 0, { clientMessageId: 'c1' });
    await state().cancelSend(bubble('c1')!.id);
    expect(bubble('c1')).toBeDefined();
    expect(cancelCalls()).toHaveLength(0);
  });

  it('a queued cancel is settled locally and the send never posts', async () => {
    state().addOptimistic(CONV, 'text c1', 0, { clientMessageId: 'c1', sendPhase: 'queued' });
    await state().cancelSend(bubble('c1')!.id);
    expect(bubble('c1')).toBeUndefined();
    const outcome = await runCancellableSend(CONV, 'c1', 'conversation', () =>
      sendConversationMessage(CONV, 'text c1', undefined, undefined, undefined, { clientMessageId: 'c1' }));
    expect(outcome).toEqual({ cancelled: true });
    expect(messagePosts).toHaveLength(0);
    expect(cancelCalls()).toHaveLength(0);
  });

  it('a held bubble cancel removes it and releaseHeld never posts it', async () => {
    state().addOptimistic(CONV, 'held text', 0, { clientMessageId: 'c1', sendPhase: 'queued' });
    state().hold(CONV, 'c1');
    await state().cancelSend(bubble('c1')!.id);
    expect(bubble('c1')).toBeUndefined();
    await state().releaseHeld(CONV);
    expect(messagePosts).toHaveLength(0);
    expect(slice()?.failed).toEqual([expect.objectContaining({ code: 'cancelled', text: 'held text' })]);
  });

  it('cancelHeldOffline turns the entry into a Cancelled entry that the reconnect flush skips', () => {
    state().holdSend(CONV, 'offline text', { clientMessageId: 'c1', deliverAs: 'steer' });
    const id = slice()!.failed[0]!.id;
    state().cancelHeldOffline(id);
    const entry = slice()!.failed[0]!;
    expect(entry).toMatchObject({ id, text: 'offline text', code: 'cancelled', clientMessageId: 'c1', retryable: true, deliveryUnknown: false });
    expect(entry.heldOffline).toBeUndefined();
    expect(entry.deliverAs).toBeUndefined();
  });

  it('with an empty registered restore target the text goes to the composer and no outbox entry is added', async () => {
    const setText = vi.fn();
    registerComposerRestoreTarget(CONV, { isEmpty: () => true, setText });
    state().addOptimistic(CONV, 'give it back', 0, { clientMessageId: 'c1', sendPhase: 'queued' });
    await state().cancelSend(bubble('c1')!.id);
    expect(setText).toHaveBeenCalledWith('give it back');
    expect(slice()?.failed ?? []).toEqual([]);
    expect(slice()?.optimistic ?? []).toEqual([]);

    state().holdSend(CONV, 'offline', { clientMessageId: 'c2' });
    state().cancelHeldOffline(slice()!.failed[0]!.id);
    expect(setText).toHaveBeenLastCalledWith('offline');
    expect(slice()?.failed ?? []).toEqual([]);
  });

  it('with a non-empty target the text goes to the outbox as Cancelled', async () => {
    const setText = vi.fn();
    registerComposerRestoreTarget(CONV, { isEmpty: () => false, setText });
    state().addOptimistic(CONV, 'keep me', 0, { clientMessageId: 'c1', sendPhase: 'queued' });
    await state().cancelSend(bubble('c1')!.id);
    expect(setText).not.toHaveBeenCalled();
    expect(slice()?.failed).toEqual([expect.objectContaining({ code: 'cancelled', text: 'keep me' })]);
  });

  it('an unregistered restore target leaves later cancels to the outbox', async () => {
    const setText = vi.fn();
    const unregister = registerComposerRestoreTarget(CONV, { isEmpty: () => true, setText });
    unregister();
    state().addOptimistic(CONV, 'after unmount', 0, { clientMessageId: 'c1', sendPhase: 'queued' });
    await state().cancelSend(bubble('c1')!.id);
    expect(setText).not.toHaveBeenCalled();
    expect(slice()?.failed).toEqual([expect.objectContaining({ code: 'cancelled' })]);
  });

  it('retrying a Cancelled entry sends a fresh clientMessageId without retry: true', async () => {
    state().addOptimistic(CONV, 'again', 0, { clientMessageId: 'c1', sendPhase: 'queued' });
    await state().cancelSend(bubble('c1')!.id);
    const entry = slice()!.failed[0]!;
    const retry = state().retryFailed(CONV, entry.id, 'again', 0);
    await vi.waitFor(() => expect(messagePosts).toHaveLength(1));
    const body = messagePosts[0]!.body;
    expect(body['clientMessageId']).toEqual(expect.any(String));
    expect(body['clientMessageId']).not.toBe('c1');
    expect(body['retry']).toBeUndefined();
    messageResponses[0]!.resolve(new Response('', { status: 200 }));
    await retry;
    expect(slice()?.failed ?? []).toEqual([]);
  });

  it('a cancelled retry is never posted and leaves no failure entry', async () => {
    state().failSend(CONV, 'retry me', 'prompt', { deliveryUnknown: false, retryable: true });
    const first = slice()!.failed[0]!;
    // Hold the queue so the retry waits its turn.
    const blocker = enqueueConversationSend(CONV, () => startSend('blocker'));
    await vi.waitFor(() => expect(messagePosts).toHaveLength(1));
    const retry = state().retryFailed(CONV, first.id, 'retry me', 0);
    const queued = slice()!.optimistic.find((m) => m.text === 'retry me')!;
    expect(queued.sendPhase).toBe('queued');
    await state().cancelSend(queued.id);
    messageResponses[0]!.resolve(new Response('', { status: 200 }));
    await blocker;
    expect(await retry).toBeNull();
    expect(messagePosts).toHaveLength(1);
    expect(slice()?.failed).toEqual([expect.objectContaining({ code: 'cancelled', text: 'retry me' })]);
  });
});
