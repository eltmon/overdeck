/**
 * Claude Code hooks ingestion route
 *
 * POST /api/hooks/permission-event
 *   Receives PermissionRequest, PostToolUse, and Stop hook payloads from
 *   Claude Code sessions and emits conversation.permission_changed events
 *   so the dashboard can show a "waiting for permission" indicator in real-time.
 *
 * The hook payload always includes `session_id` (Claude session UUID) and
 * `hook_event_name`. We look up the conversation by claude_session_id and
 * emit an in-memory-only event via emitOnly().
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { getEventStore } from '../event-store.js';
import { getConversationByClaudeSessionId } from '../../../lib/database/conversations-db.js';
import { isSubagentHookPayload } from '../../../lib/memory/subagent-filter.js';

const CLEAR_ON = new Set([
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'PermissionDenied',
])

export function memoryTurnHookResponse(body: unknown): typeof HttpServerResponse.Type | null {
  if (!isSubagentHookPayload(body)) return null;
  return HttpServerResponse.text('', { status: 204 });
}

const postMemoryTurnRoute = HttpRouter.add(
  'POST',
  '/api/memory/turn',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const subagentResponse = memoryTurnHookResponse(body);
    if (subagentResponse) return subagentResponse;

    return jsonResponse({ ok: true }, { status: 202 });
  })),
);

const postPermissionEventRoute = HttpRouter.add(
  'POST',
  '/api/hooks/permission-event',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const rawBody = yield* request.text;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, { status: 400 });
    }

    const sessionId = typeof body.session_id === 'string' ? body.session_id : null;
    const hookEvent = typeof body.hook_event_name === 'string' ? body.hook_event_name : null;
    const toolName = typeof body.tool_name === 'string' ? body.tool_name : undefined;

    if (!sessionId || !hookEvent) {
      return jsonResponse({ ok: true });
    }

    const conv = getConversationByClaudeSessionId(sessionId);
    if (!conv) {
      return jsonResponse({ ok: true });
    }

    const waiting = hookEvent === 'PermissionRequest';
    const clearing = CLEAR_ON.has(hookEvent);

    if (!waiting && !clearing) {
      return jsonResponse({ ok: true });
    }

    console.log(`[hooks] ${hookEvent} session=${sessionId} conv=${conv.name} waiting=${waiting}${toolName ? ` tool=${toolName}` : ''}`);

    getEventStore().emitOnly({
      type: 'conversation.permission_changed',
      timestamp: new Date().toISOString(),
      payload: { conversationName: conv.name, waiting, toolName },
    });

    return jsonResponse({ ok: true, conversationName: conv.name, waiting });
  })),
);

export const hooksRouteLayer = Layer.mergeAll(
  postMemoryTurnRoute,
  postPermissionEventRoute,
);
