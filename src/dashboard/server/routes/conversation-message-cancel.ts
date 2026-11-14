/**
 * PAN-5237: POST /api/conversations/:name/message/cancel — drop a composer send
 * that has not reached the agent. Answers `{ outcome }`: `cancelled` (nothing
 * was or will be delivered), `delivered` (past the commit point) or `unknown`
 * (no receipt yet; a tombstone refuses a late POST with that id).
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { jsonResponse } from '../http-helpers.js';
import { handleConversationMessageCancel } from '../services/conversation-message-receipts.js';
import { validateOrigin } from './origin-validation.js';

export const conversationMessageCancelRouteLayer = HttpRouter.add(
  'POST',
  '/api/conversations/:name/message/cancel',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const text = yield* request.text;
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 });
    }
    return handleConversationMessageCancel(params['name'] ?? '', body, (n) => getConversationByName(n) !== null);
  }),
);
