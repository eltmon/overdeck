import { createHash } from 'node:crypto';

import { jsonResponse } from '../http-helpers.js';

type Response = ReturnType<typeof jsonResponse>;
interface Receipt {
  /** null = tombstone: a cancel arrived for an id no POST had used yet (PAN-5237). */
  fingerprint: string | null;
  result: Promise<Response>;
  settledAt: number | null;
  /** PAN-5237: 'committed' once the handler passed its commit point; 'cancelled' after a cancel won. */
  phase: 'pending' | 'committed' | 'cancelled';
  /** PAN-5237 tombstones only: a POST hit the tombstone and was refused. */
  refusedPost: boolean;
}

/**
 * PAN-5237: the cancel gate a receipt hands to the delivery handler.
 * `isCancelled()` is a read-only check. `commit()` atomically checks and
 * claims: after it returns true the send can no longer be cancelled.
 */
export interface ConversationDeliveryGate {
  isCancelled(): boolean;
  commit(): boolean;
}

/** The gate for sends without a receipt: never cancelled, always commits. */
export const OPEN_DELIVERY_GATE: ConversationDeliveryGate = { isCancelled: () => false, commit: () => true };

export type ConversationMessageCancelOutcome = 'cancelled' | 'delivered' | 'unknown';

export function cancelledBeforeDeliveryResponse(): Response {
  return jsonResponse(
    { error: 'Cancelled before delivery', code: 'cancelled', deliveryUnknown: false, retryable: false },
    { status: 409 },
  );
}

const RECEIPT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RECEIPTS = 2_000;
const CLIENT_MESSAGE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Coalesce HTTP retries without changing the harness delivery transport.
 * Receipts are transient: after restart/expiry an explicit retry is refused,
 * never treated as a fresh send. An ambiguous transport failure is retained
 * because it may have happened after injection. No exactly-once claim is made
 * about the harness itself.
 *
 * PAN-5237: each receipt also carries a cancel gate. `cancel` wins only before
 * the handler's commit point; after it, the answer is `delivered`. A cancel
 * for an id never seen writes a tombstone so a late POST is refused, but the
 * answer stays `unknown` until a POST has actually hit the tombstone.
 */
export function createConversationMessageReceipts() {
  const receipts = new Map<string, Receipt>();

  const prune = (now: number): void => {
    for (const [key, entry] of receipts) {
      if (entry.settledAt !== null && now - entry.settledAt >= RECEIPT_TTL_MS) receipts.delete(key);
    }
  };

  /** Free one slot by evicting a settled receipt. Never evicts an in-flight reservation. */
  const makeRoom = (): boolean => {
    if (receipts.size < MAX_RECEIPTS) return true;
    const settled = [...receipts].find(([, entry]) => entry.settledAt !== null);
    if (!settled) return false;
    receipts.delete(settled[0]);
    return true;
  };

  const deliver = async (
    name: string,
    body: Record<string, unknown>,
    run: (gate: ConversationDeliveryGate) => Promise<Response>,
  ): Promise<Response> => {
    const id = body['clientMessageId'];
    if (id === undefined && body['retry'] !== true) return run(OPEN_DELIVERY_GATE);
    if (typeof id !== 'string' || !CLIENT_MESSAGE_ID.test(id)) {
      return jsonResponse({ error: 'A valid clientMessageId is required', deliveryUnknown: false }, { status: 400 });
    }
    prune(Date.now());
    const key = JSON.stringify([name, id]);
    const previous = receipts.get(key);
    if (previous?.fingerprint === null) {
      previous.refusedPost = true;
      return previous.result;
    }
    const fingerprint = createHash('sha256').update(JSON.stringify([
      body['message'], body['deliverAs'], body['confirmationNonce'], body['confirmationText'],
    ])).digest('hex');
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
    // Refuse new work if every slot holds an in-flight reservation.
    if (!makeRoom()) {
      return jsonResponse({ error: 'Too many messages are being delivered', deliveryUnknown: false }, { status: 429 });
    }
    const entry: Receipt = {
      fingerprint,
      settledAt: null,
      phase: 'pending',
      refusedPost: false,
      result: Promise.resolve(cancelledBeforeDeliveryResponse()),
    };
    const gate: ConversationDeliveryGate = {
      isCancelled: () => entry.phase === 'cancelled',
      commit: () => {
        if (entry.phase === 'cancelled') return false;
        entry.phase = 'committed';
        return true;
      },
    };
    entry.result = Promise.resolve().then(() => run(gate));
    receipts.set(key, entry);
    // A rejected promise must remain a receipt too: retrying an uncertain side
    // effect could duplicate it. The route translates the error for each caller.
    void entry.result.then(
      () => { entry.settledAt = Date.now(); },
      () => { entry.settledAt = Date.now(); },
    );
    return entry.result;
  };

  const cancel = (name: string, clientMessageId: unknown): ConversationMessageCancelOutcome | 'invalid' => {
    if (typeof clientMessageId !== 'string' || !CLIENT_MESSAGE_ID.test(clientMessageId)) return 'invalid';
    const now = Date.now();
    prune(now);
    const key = JSON.stringify([name, clientMessageId]);
    const entry = receipts.get(key);
    if (!entry) {
      // The POST may not have arrived yet, or its receipt was lost to a restart
      // or eviction: refuse a late POST, but do not claim a cancel.
      if (makeRoom()) {
        receipts.set(key, {
          fingerprint: null,
          phase: 'cancelled',
          refusedPost: false,
          settledAt: now,
          result: Promise.resolve(cancelledBeforeDeliveryResponse()),
        });
      }
      return 'unknown';
    }
    if (entry.fingerprint === null) return entry.refusedPost ? 'cancelled' : 'unknown';
    if (entry.phase === 'committed') return 'delivered';
    // Pending (the handler has not reached its commit point) or settled without
    // a commit (it refused before delivering): nothing reached the agent.
    entry.phase = 'cancelled';
    return 'cancelled';
  };

  return { deliver, cancel };
}

const conversationMessageReceipts = createConversationMessageReceipts();
export const withConversationMessageReceipt = conversationMessageReceipts.deliver;
export const cancelConversationMessage = conversationMessageReceipts.cancel;

/**
 * PAN-5237: the cancel route's handler. `conversationExists` is injected so
 * this module never imports the conversation database.
 */
export function handleConversationMessageCancel(
  name: string,
  body: Record<string, unknown>,
  conversationExists: (name: string) => boolean,
): Response {
  if (!conversationExists(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
  const outcome = cancelConversationMessage(name, body['clientMessageId']);
  if (outcome === 'invalid') return jsonResponse({ error: 'A valid clientMessageId is required' }, { status: 400 });
  return jsonResponse({ outcome });
}
