import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetComposerStore, sendConversationMessage, sendFailureDetails, useComposerStore } from '../composerStore';
import type { ChatMessage } from '../../components/chat/chat-types';

const CONV = 'delivery-conv';
const NOW = new Date('2026-09-09T12:00:00Z');
const store = () => useComposerStore.getState();
const slice = () => store().byConversation[CONV];
function send(id = 'send-1', text = 'hello') {
  store().addOptimistic(CONV, text, 1, { clientMessageId: id, echoBaselineIds: ['old'] });
}
function echo(id: string, text = 'hello', offset = 1000): ChatMessage {
  return { id, text, role: 'user', createdAt: new Date(NOW.getTime() + offset).toISOString() };
}

describe('composer delivery and echo identity', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); resetComposerStore(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('acknowledges only the intended same-text send and removes each echo once', () => {
    send(); send('send-2');
    store().acknowledgeOptimistic(CONV, 'hello', 'send-2');
    expect(slice().optimistic.map(m => m.deliveryState)).toEqual(['pending', 'accepted']);
    store().reconcileEchoes(CONV, [echo('new')]);
    expect(slice().optimistic.map(m => m.clientMessageId)).toEqual(['send-2']);
    store().reconcileEchoes(CONV, [echo('new')]);
    expect(slice().optimistic).toHaveLength(1);
    store().reconcileEchoes(CONV, [echo('new'), echo('second')]);
    expect(slice()?.optimistic ?? []).toEqual([]);
  });

  it('ignores assistant growth, old same-text history and unrelated new user turns', () => {
    send();
    store().reconcileEchoes(CONV, [
      { ...echo('assistant'), role: 'assistant' }, echo('old'), echo('inserted-history', 'hello', -1000), echo('other', 'different'),
    ]);
    expect(slice().optimistic).toHaveLength(1);
    store().reconcileEchoes(CONV, [echo('new')]);
    expect(slice()?.optimistic ?? []).toEqual([]);
  });

  it('cleans up a late failed echo without dropping other sends or command results', () => {
    send(); send('send-2', 'second');
    store().failSend(CONV, 'hello', 'prompt', { clientMessageId: 'send-1', deliveryUnknown: true });
    store().failSend(CONV, '/pan status', 'command');
    expect(slice().optimistic.map(m => m.text)).toEqual(['second']);
    store().reconcileEchoes(CONV, [echo('new')]);
    expect(slice().failed.map(m => m.kind)).toEqual(['command']);
    expect(slice().optimistic.map(m => m.text)).toEqual(['second']);
  });

  it('does not resurrect a prompt when the transcript settles before an HTTP error', () => {
    send(); store().reconcileEchoes(CONV, [echo('new')]);
    store().failSend(CONV, 'hello', 'prompt', { clientMessageId: 'send-1', deliveryUnknown: true });
    expect(slice()?.failed ?? []).toEqual([]);
  });

  it('uses an explicit transcript request identity before text or timestamp heuristics', () => {
    send();
    store().reconcileEchoes(CONV, [{ ...echo('old', 'normalized by harness', -1000), clientMessageId: 'send-1' }]);
    expect(slice()?.optimistic ?? []).toEqual([]);
  });

  it('preserves the request ID, original send time, attachments and delivery mode through retries', async () => {
    const text = '@/tmp/attachment.png\nhello';
    send('send-1', text);
    store().failSend(CONV, text, 'prompt', { clientMessageId: 'send-1', deliverAs: 'follow_up', deliveryUnknown: true });
    const failed = slice().failed[0];
    await vi.advanceTimersByTimeAsync(60_000);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await store().retryFailed(CONV, failed.id, text, 2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ message: text, clientMessageId: 'send-1', retry: true, deliverAs: 'follow_up' });
    expect(slice().optimistic[0]).toMatchObject({ createdAt: NOW.toISOString(), acknowledged: true });
    store().reconcileEchoes(CONV, [echo('late-original', text, 500)]);
    expect(slice()?.optimistic ?? []).toEqual([]);
  });

  it('does not send twice when Retry is clicked twice or when the text changes', async () => {
    send(); store().failSend(CONV, 'hello', 'prompt', { clientMessageId: 'send-1' });
    const failed = slice().failed[0];
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    await store().retryFailed(CONV, failed.id, 'changed text', 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await Promise.all([store().retryFailed(CONV, failed.id, 'hello', 1), store().retryFailed(CONV, failed.id, 'hello', 1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('delivery response classification', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  const post = (agentId?: string) => sendConversationMessage(CONV, 'hello', agentId, undefined, undefined, { clientMessageId: 'stable-id' });

  it.each([
    [400, { error: 'invalid attachment' }, false, false],
    [503, { error: 'response lost' }, true, true],
    [409, { error: 'receipt expired', deliveryUnknown: true, retryable: false }, true, false],
    [503, { error: 'known rejection', deliveryUnknown: false, retryable: true }, false, true],
  ])('classifies HTTP %s using explicit delivery evidence', async (status, body, deliveryUnknown, retryable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
    const details = await post().catch(sendFailureDetails);
    expect(details).toMatchObject({ error: body.error, deliveryUnknown, retryable });
  });

  it('does not offer a duplicate-risk retry for an unknown agent delivery', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection lost')));
    expect(await post('agent-1').catch(sendFailureDetails)).toMatchObject({ deliveryUnknown: true, retryable: false });
    expect(await post().catch(sendFailureDetails)).toMatchObject({ deliveryUnknown: true, retryable: true });
  });

  it('treats a broken response body as unknown, even after successful HTTP headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: () => Promise.reject(new Error('reset')) }));
    expect(await post().catch(sendFailureDetails)).toMatchObject({ deliveryUnknown: true, retryable: true });
  });

  it('bounds a stalled send and keeps its outcome unknown', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('timeout')));
    })));
    const result = post().catch(sendFailureDetails);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await result).toMatchObject({ deliveryUnknown: true, retryable: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
