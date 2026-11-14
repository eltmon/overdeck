import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../http-helpers.js', () => ({
  jsonResponse: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }),
}));

import { jsonResponse } from '../../http-helpers.js';
import {
  createConversationMessageReceipts,
  handleConversationMessageCancel,
  type ConversationDeliveryGate,
} from '../conversation-message-receipts.js';

describe('conversation message HTTP receipts', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('joins concurrent retries and replays the original complete response without a second delivery', async () => {
    const send = createConversationMessageReceipts().deliver;
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
    const send = createConversationMessageReceipts().deliver;
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
    const send = createConversationMessageReceipts().deliver;
    const deliver = vi.fn(async () => { throw new Error('response lost after injection'); });
    const body = { clientMessageId: 'send-1', message: 'hello' };
    await expect(send('a', body, deliver)).rejects.toThrow('response lost');
    await expect(send('a', { ...body, retry: true }, deliver)).rejects.toThrow('response lost');
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('scopes IDs by conversation and rejects changed text, delivery mode, or confirmation', async () => {
    const send = createConversationMessageReceipts().deliver;
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
    const send = createConversationMessageReceipts().deliver;
    const response = jsonResponse({ kind: 'confirmation', nonce: 'abc' }, { status: 422 });
    const deliver = vi.fn(async () => response);
    expect(await send('a', { message: '/pan stop' }, deliver)).toBe(response);
    expect(await send('a', { message: 'hello', retry: true }, deliver)).toMatchObject({ status: 400 });
    expect(await send('a', { clientMessageId: 'x'.repeat(129) }, deliver)).toMatchObject({ status: 400 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it('cancel while pending makes commit() return false and isCancelled() true', async () => {
    const receipts = createConversationMessageReceipts();
    let gate!: ConversationDeliveryGate;
    let finish!: () => void;
    const run = vi.fn((g: ConversationDeliveryGate) => {
      gate = g;
      return new Promise<ReturnType<typeof jsonResponse>>((resolve) => {
        finish = () => resolve(g.commit() ? jsonResponse({ ok: true }) : jsonResponse({ code: 'cancelled' }, { status: 409 }));
      });
    });
    const pending = receipts.deliver('a', { clientMessageId: 'c1', message: 'hi' }, run);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(receipts.cancel('a', 'c1')).toBe('cancelled');
    expect(gate.isCancelled()).toBe(true);
    expect(gate.commit()).toBe(false);
    finish();
    expect(await pending).toMatchObject({ status: 409 });
    expect(receipts.cancel('a', 'c1')).toBe('cancelled');
  });

  it('cancel after commit answers delivered, also after the receipt settles', async () => {
    const receipts = createConversationMessageReceipts();
    let finish!: () => void;
    const run = vi.fn((g: ConversationDeliveryGate) => {
      g.commit();
      return new Promise<ReturnType<typeof jsonResponse>>((resolve) => { finish = () => resolve(jsonResponse({ ok: true })); });
    });
    const pending = receipts.deliver('a', { clientMessageId: 'c1', message: 'hi' }, run);
    await Promise.resolve();
    expect(receipts.cancel('a', 'c1')).toBe('delivered');
    finish();
    expect(await pending).toMatchObject({ status: 200 });
    await vi.advanceTimersByTimeAsync(0);
    expect(receipts.cancel('a', 'c1')).toBe('delivered');
  });

  it('cancel of an unknown id writes a tombstone that refuses a late POST without calling run', async () => {
    const receipts = createConversationMessageReceipts();
    const run = vi.fn(async () => jsonResponse({ ok: true }));
    expect(receipts.cancel('a', 'late')).toBe('unknown');
    expect(receipts.cancel('a', 'late')).toBe('unknown');
    expect(await receipts.deliver('a', { clientMessageId: 'late', message: 'hi' }, run)).toMatchObject({
      status: 409,
      body: { code: 'cancelled', deliveryUnknown: false, retryable: false },
    });
    expect(await receipts.deliver('a', { clientMessageId: 'late', message: 'other', retry: true }, run)).toMatchObject({
      status: 409,
      body: { code: 'cancelled' },
    });
    expect(run).not.toHaveBeenCalled();
    expect(receipts.cancel('a', 'late')).toBe('cancelled');
    // The tombstone is scoped to its conversation.
    await receipts.deliver('b', { clientMessageId: 'late', message: 'hi' }, run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel of a receipt that settled without committing answers cancelled', async () => {
    const receipts = createConversationMessageReceipts();
    const refusal = jsonResponse({ code: 'permission-pending' }, { status: 409 });
    const run = vi.fn(async () => refusal);
    expect(await receipts.deliver('a', { clientMessageId: 'c1', message: 'hi' }, run)).toBe(refusal);
    await vi.advanceTimersByTimeAsync(0);
    expect(receipts.cancel('a', 'c1')).toBe('cancelled');
    expect(await receipts.deliver('a', { clientMessageId: 'c1', message: 'hi', retry: true }, run)).toBe(refusal);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancel with an invalid id answers invalid', () => {
    const receipts = createConversationMessageReceipts();
    expect(receipts.cancel('a', undefined)).toBe('invalid');
    expect(receipts.cancel('a', 42)).toBe('invalid');
    expect(receipts.cancel('a', 'bad id')).toBe('invalid');
    expect(receipts.cancel('a', 'x'.repeat(129))).toBe('invalid');
  });

  it('a send without a clientMessageId runs with the open gate', async () => {
    const receipts = createConversationMessageReceipts();
    let gate!: ConversationDeliveryGate;
    await receipts.deliver('a', { message: 'hi' }, async (g) => { gate = g; return jsonResponse({ ok: true }); });
    expect(gate.isCancelled()).toBe(false);
    expect(gate.commit()).toBe(true);
  });

  it('handleConversationMessageCancel answers 404 for an unknown conversation, 400 for an invalid id, 200 with the outcome', () => {
    const exists = (name: string) => name === 'known';
    expect(handleConversationMessageCancel('missing', { clientMessageId: 'h1' }, exists)).toMatchObject({
      status: 404,
      body: { error: 'Conversation not found' },
    });
    expect(handleConversationMessageCancel('known', { clientMessageId: '' }, exists)).toMatchObject({ status: 400 });
    expect(handleConversationMessageCancel('known', {}, exists)).toMatchObject({ status: 400 });
    expect(handleConversationMessageCancel('known', { clientMessageId: 'handler-tombstone' }, exists)).toMatchObject({
      status: 200,
      body: { outcome: 'unknown' },
    });
  });

  it('a tombstone expires after 24 h so a new POST with that id delivers', async () => {
    const receipts = createConversationMessageReceipts();
    const run = vi.fn(async () => jsonResponse({ ok: true }));
    expect(receipts.cancel('a', 'old')).toBe('unknown');
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1_000);
    expect(await receipts.deliver('a', { clientMessageId: 'old', message: 'hi' }, run)).toMatchObject({ status: 200 });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
