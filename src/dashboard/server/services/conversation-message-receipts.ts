import { createHash } from 'node:crypto';

import { jsonResponse } from '../http-helpers.js';

type Response = ReturnType<typeof jsonResponse>;
interface Receipt {
  fingerprint: string;
  result: Promise<Response>;
  settledAt: number | null;
}

const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RECEIPTS = 2_000;

/**
 * Coalesce HTTP retries without changing the harness delivery transport.
 * Receipts are transient: after restart/expiry an explicit retry is refused,
 * never treated as a fresh send. An ambiguous transport failure is retained
 * because it may have happened after injection. No exactly-once claim is made
 * about the harness itself.
 */
export function createConversationMessageReceipts() {
  const receipts = new Map<string, Receipt>();
  return async (name: string, body: Record<string, unknown>, deliver: () => Promise<Response>): Promise<Response> => {
    const id = body['clientMessageId'];
    if (id === undefined && body['retry'] !== true) return deliver();
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      return jsonResponse({ error: 'A valid clientMessageId is required', deliveryUnknown: false }, { status: 400 });
    }
    const now = Date.now();
    for (const [key, entry] of receipts) {
      if (entry.settledAt !== null && now - entry.settledAt >= RECEIPT_TTL_MS) receipts.delete(key);
    }
    const key = JSON.stringify([name, id]);
    const fingerprint = createHash('sha256').update(JSON.stringify([
      body['message'], body['deliverAs'], body['confirmationNonce'], body['confirmationText'],
    ])).digest('hex');
    const previous = receipts.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return jsonResponse({
          error: 'This message ID belongs to a different send. Keep the original text when retrying.',
          deliveryUnknown: true,
          retryable: false,
        }, { status: 409 });
      }
      return previous.result;
    }
    if (body['retry'] === true) {
      return jsonResponse({
        error: 'The previous delivery receipt is unavailable. Check the conversation before sending this text again.',
        deliveryUnknown: true,
        retryable: false,
      }, { status: 409 });
    }
    // Never evict an in-flight reservation. Refuse new work if all slots are busy.
    if (receipts.size >= MAX_RECEIPTS) {
      const settled = [...receipts].find(([, entry]) => entry.settledAt !== null);
      if (settled) receipts.delete(settled[0]);
      else return jsonResponse({ error: 'Too many messages are being delivered', deliveryUnknown: false }, { status: 429 });
    }
    const entry: Receipt = { fingerprint, settledAt: null, result: Promise.resolve().then(deliver) };
    receipts.set(key, entry);
    // A rejected promise must remain a receipt too: retrying an uncertain side
    // effect could duplicate it. The route translates the error for each caller.
    void entry.result.then(
      () => { entry.settledAt = Date.now(); },
      () => { entry.settledAt = Date.now(); },
    );
    return entry.result;
  };
}

export const withConversationMessageReceipt = createConversationMessageReceipts();
