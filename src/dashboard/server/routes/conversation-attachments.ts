/**
 * PAN-4493 — GET /api/conversations/:name/attachments/:file serves one image
 * from that conversation's own attachments folder, so the dashboard can show
 * pasted images full size. Images only; every other request is 404.
 */
import { readFile } from 'node:fs/promises';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { resolveConversationImageAttachment } from '../services/conversation-attachments.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

export const conversationAttachmentRoutes = HttpRouter.add(
  'GET',
  '/api/conversations/:name/attachments/:file',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) return jsonResponse({ error: originCheck.error }, { status: 403 });
    const params = yield* HttpRouter.params;
    const name = safeDecode(params['name'] ?? '');
    const file = safeDecode(params['file'] ?? '');
    const found = name && file ? yield* Effect.promise(() => resolveConversationImageAttachment(name, file)) : null;
    if (!found) return jsonResponse({ error: 'Attachment not found' }, { status: 404 });
    const bytes = yield* Effect.promise(() => readFile(found.path).catch(() => null));
    if (!bytes) return jsonResponse({ error: 'Attachment not found' }, { status: 404 });
    return HttpServerResponse.uint8Array(bytes, {
      contentType: found.contentType,
      headers: { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  }),
);
