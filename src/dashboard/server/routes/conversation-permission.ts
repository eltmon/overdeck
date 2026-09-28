/**
 * PAN-4278 — POST /api/conversations/:id/permission answers a Claude Code
 * terminal permission prompt (main thread or subagent) from the dashboard
 * dialog. The handler verifies the on-screen prompt still carries the dialog's
 * signature before sending arrows + Enter.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { handleConversationPermissionAnswer } from '../../../lib/overdeck/conversation-permission.js';
import { jsonResponse } from '../http-helpers.js';
import { validateOrigin } from './origin-validation.js';

export const conversationPermissionRoutes = HttpRouter.add(
  'POST',
  '/api/conversations/:id/permission',
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
    const result = yield* Effect.promise(() => handleConversationPermissionAnswer(params['id'] ?? '', body));
    return jsonResponse(result.body, { status: result.status ?? 200 });
  }),
);
