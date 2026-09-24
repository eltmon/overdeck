import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http-helpers.js', () => ({
  jsonResponse: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }),
}));

import { jsonResponse } from '../../http-helpers.js';
import { createConversationMessageReceipts } from '../conversation-message-receipts.js';

describe('conversation message HTTP receipts', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('joins concurrent retries and replays the original complete response without a second delivery', async () => {
    const send = createConversationMessageReceipts();
    const accepted = jsonResponse({ ok: true, imagesDropped: 2 });
    let finish!: (response: typeof accepted) => void;
    const deliver = vi.fn(() => new Promise<typeof accepted>((resolve) => { finish = resolve; }));
    const body = { clientMessageId: 'send-1', message: 'hello', deliverAs: 'steer' };
    const first = send('conversation-a', body, deliver);
    const retry = send('conversation-a', { ...body, retry: true }, deliver);
    await Promise.resolve();
    expect(deliver).toHaveBeenCalledTimes(1);
    finish(accepted);
    expect(await first).toBe(accepted);
    expect(await retry).toBe(accepted);
    expect(await send('conversation-a', { ...body, retry: true }, deliver)).toBe(accepted);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('does not inject an unknown retry after restart or receipt expiry', async () => {
    const send = createConversationMessageReceipts();
    const deliver = vi.fn(async () => jsonResponse({ ok: true }));
    const body = { clientMessageId: 'send-1', message: 'hello' };
    const unknown = await send('a', { ...body, retry: true }, deliver);
    expect(unknown).toMatchObject({ status: 409, body: { deliveryUnknown: true, retryable: false } });
    expect(deliver).not.toHaveBeenCalled();
    await send('a', body, deliver);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(await send('a', { ...body, retry: true }, deliver)).toMatchObject({ status: 409 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('retains ambiguous delivery errors without invoking the transport again', async () => {
    const send = createConversationMessageReceipts();
    const deliver = vi.fn(async () => { throw new Error('response lost after injection'); });
    const body = { clientMessageId: 'send-1', message: 'hello' };
    await expect(send('a', body, deliver)).rejects.toThrow('response lost');
    await expect(send('a', { ...body, retry: true }, deliver)).rejects.toThrow('response lost');
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('scopes IDs by conversation and rejects changed text, delivery mode, or confirmation', async () => {
    const send = createConversationMessageReceipts();
    const deliver = vi.fn(async () => jsonResponse({ ok: true }));
    const body = { clientMessageId: 'send-1', message: 'hello', deliverAs: 'steer' };
    await send('a', body, deliver);
    for (const change of [{ message: 'different' }, { deliverAs: 'follow_up' }, { confirmationNonce: 'approved' }]) {
      expect(await send('a', { ...body, ...change, retry: true }, deliver)).toMatchObject({ status: 409 });
    }
    await send('b', body, deliver);
    expect(deliver).toHaveBeenCalledTimes(2);
  });

  it('preserves legacy no-ID clients but validates identified retries', async () => {
    const send = createConversationMessageReceipts();
    const response = jsonResponse({ kind: 'confirmation', nonce: 'abc' }, { status: 422 });
    const deliver = vi.fn(async () => response);
    expect(await send('a', { message: '/pan stop' }, deliver)).toBe(response);
    expect(await send('a', { message: 'hello', retry: true }, deliver)).toMatchObject({ status: 400 });
    expect(await send('a', { clientMessageId: 'x'.repeat(129) }, deliver)).toMatchObject({ status: 400 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
