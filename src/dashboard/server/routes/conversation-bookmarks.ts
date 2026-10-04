/** PAN-4498 WI-2: the bookmark door's HTTP surface — GET/PUT/DELETE /api/conversations/:name/bookmarks. */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import {
  listConversationBookmarks,
  removeConversationBookmark,
  upsertConversationBookmark,
  validateBookmarkInput,
} from '../../../lib/overdeck/conversation-bookmarks.js';
import { getConversationByName } from '../../../lib/overdeck/conversations.js';
import { validateOrigin } from './origin-validation.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {} as Record<string, unknown>;
  }
});

const getConversationBookmarksRoute = HttpRouter.add(
  'GET',
  '/api/conversations/:name/bookmarks',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    if (!getConversationByName(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    return jsonResponse({ bookmarks: listConversationBookmarks(name) });
  }),
);

const putConversationBookmarkRoute = HttpRouter.add(
  'PUT',
  '/api/conversations/:name/bookmarks/:messageId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const messageId = decodeURIComponent(params['messageId'] ?? '');
    if (!getConversationByName(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    const body = yield* readJsonBody;
    const validated = validateBookmarkInput({
      messageId,
      label: body['label'],
      messageCreatedAt: body['messageCreatedAt'],
    });
    if (!validated.ok) return jsonResponse({ error: validated.error }, { status: 400 });
    const result = upsertConversationBookmark(name, {
      messageId: validated.messageId,
      label: validated.label,
      messageCreatedAt: validated.messageCreatedAt,
    });
    switch (result.status) {
      case 'saved':
        return jsonResponse({ bookmark: result.bookmark });
      case 'not-found':
        return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
      case 'limit':
        return jsonResponse({ error: 'Bookmark limit reached (500)' }, { status: 409 });
    }
  }),
);

const deleteConversationBookmarkRoute = HttpRouter.add(
  'DELETE',
  '/api/conversations/:name/bookmarks/:messageId',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = decodeURIComponent(params['name'] ?? '');
    const messageId = decodeURIComponent(params['messageId'] ?? '');
    if (!getConversationByName(name)) return jsonResponse({ error: 'Conversation not found' }, { status: 404 });
    return jsonResponse({ removed: removeConversationBookmark(name, messageId) });
  }),
);

export const conversationBookmarksRouteLayer = Layer.mergeAll(
  getConversationBookmarksRoute,
  putConversationBookmarkRoute,
  deleteConversationBookmarkRoute,
);
