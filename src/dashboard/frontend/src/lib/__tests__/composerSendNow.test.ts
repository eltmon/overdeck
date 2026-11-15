/**
 * PAN-5353: the Send now client — requestSendNow's URL, sendNowQueued's toast
 * on failure, and the shared per-conversation send queue ordering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

import { requestSendNow, sendNowQueued } from '../composerSendNow.js';
import { resetConversationSendQueues } from '../composerSendQueue.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  resetConversationSendQueues();
  toastError.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestSendNow', () => {
  it('posts to /api/agents/<id>/send-now when agentId is set', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await requestSendNow('conv a', 'agent-pan-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/agents/agent-pan-1/send-now');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
  });

  it('posts to /api/conversations/<name>/send-now, encoded, without an agentId', async () => {
    const fetchMock = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await requestSendNow('conv a');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/conversations/conv%20a/send-now');
  });

  it('throws the body error on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'Waiting: the agent needs a permission answer first', code: 'permission-pending' })));

    await expect(requestSendNow('conv a')).rejects.toThrow('Waiting: the agent needs a permission answer first');
  });

  it('falls back to a status-coded message when the body has no error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));

    await expect(requestSendNow('conv a')).rejects.toThrow('Send now failed (500)');
  });
});

describe('sendNowQueued', () => {
  it('never rejects, and reports a 409 permission-pending error via toast.error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: 'Waiting: the agent needs a permission answer first', code: 'permission-pending' })));

    await expect(sendNowQueued('conv a')).resolves.toBeUndefined();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Waiting: the agent needs a permission answer first');
  });

  it('delays its fetch until an earlier pending task on the same conversation resolves', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const fetchMock = vi.fn(async () => {
      order.push('fetch');
      return json(200, { ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { enqueueConversationSend } = await import('../composerSendQueue.js');
    const blocker = enqueueConversationSend('conv a', async () => {
      order.push('blocker-start');
      await first;
      order.push('blocker-end');
    });

    const sendNow = sendNowQueued('conv a');
    expect(order).toEqual(['blocker-start']);
    expect(fetchMock).not.toHaveBeenCalled();

    releaseFirst();
    await blocker;
    await sendNow;

    expect(order).toEqual(['blocker-start', 'blocker-end', 'fetch']);
  });
});
