/**
 * PAN-4641 WI-5: the scheduled-messages door's HTTP surface —
 * GET/POST /api/conversations/:name/scheduled-messages and
 * PATCH/DELETE /api/conversations/:name/scheduled-messages/:id.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import {
  cancelScheduledMessage,
  editScheduledMessage,
  listScheduledMessages,
  scheduleConversationMessage,
} from '../../../lib/overdeck/conversation-scheduled-messages.js';
import {
  conversationSupportsScheduledMessages,
  readConversationUsageLimit,
} from '../../../lib/overdeck/conversation-usage-limit.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { validateOrigin } from './origin-validation.js';

/** Rows the timeline shows: a `sent` row is already in the transcript, a `delivered` one is done. */
const VISIBLE_STATUSES = new Set(['pending', 'sending', 'failed', 'unknown']);

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

/** A positive integer `:id`, else null (answered as 404). */
function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const getScheduledMessagesRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/scheduled-messages',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const conv = getConversationByName(name);
    if (!conv) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    const limit = yield* Effect.promise(() => readConversationUsageLimit(conv));
    return jsonResponse({
      supported: conversationSupportsScheduledMessages(conv),
      limit,
      messages: listScheduledMessages(name).filter((message) => VISIBLE_STATUSES.has(message.status)),
    });
  }),
);

const postScheduledMessageRoute = HttpRouter.add(
  'POST',
  '/api/conversations/:name/scheduled-messages',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const body = yield* readJsonBody;
    const result = yield* Effect.promise(() => scheduleConversationMessage(name, body['message']));
    switch (result.status) {
      case 'scheduled':
        return jsonResponse({ message: result.message, limit: result.limit }, { status: 201 });
      case 'not-found':
        return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
      case 'invalid':
        return jsonResponse({ error: result.error, code: result.code }, { status: 422 });
      case 'queue-full':
        return jsonResponse({ error: 'Too many queued messages (max 20)', code: 'queue-full' }, { status: 409 });
    }
  }),
);

const patchScheduledMessageRoute = HttpRouter.add(
  'PATCH',
  '/api/conversations/:name/scheduled-messages/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const id = parseId(params['id']);
    if (id === null) return jsonResponse({ error: 'Scheduled message not found' }, { status: 404 });
    const body = yield* readJsonBody;
    const result = editScheduledMessage(name, id, body['message'], Date.now());
    switch (result.status) {
      case 'saved':
        return jsonResponse({ message: result.message });
      case 'not-found':
        return jsonResponse({ error: 'Scheduled message not found' }, { status: 404 });
      case 'not-editable':
        return jsonResponse({ error: 'Only a pending message can be edited', code: 'not-editable' }, { status: 409 });
      case 'invalid':
        return jsonResponse({ error: result.error }, { status: 400 });
    }
  }),
);

const deleteScheduledMessageRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name/scheduled-messages/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const id = parseId(params['id']);
    if (id === null) return jsonResponse({ error: 'Scheduled message not found' }, { status: 404 });
    const result = cancelScheduledMessage(name, id);
    switch (result.status) {
      case 'removed':
        return jsonResponse({ removed: true });
      case 'not-found':
        return jsonResponse({ error: 'Scheduled message not found' }, { status: 404 });
      case 'already-sent':
        return jsonResponse({ error: 'The message was already sent', code: 'already-sent' }, { status: 409 });
    }
  }),
);

export const conversationScheduledMessagesRouteLayer = Layer.mergeAll(
  getScheduledMessagesRoute,
  postScheduledMessageRoute,
  patchScheduledMessageRoute,
  deleteScheduledMessageRoute,
);
