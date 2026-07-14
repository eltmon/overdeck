import { Effect, Option } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { bodyToEvent, decodeDomainEvent } from '../../services/agent-event-utils.js';
import { jsonResponse } from '../../http-helpers.js';
import { httpHandler } from '../http-handler.js';
import {
  readJsonBody,
  validateAgentRuntimeEventAuth,
} from './shared.js';

// ─── Route: GET /api/agents/:id/health-history ───────────────────────────────

export const getAgentHealthHistoryRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/health-history',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    const request = yield* HttpServerRequest.HttpServerRequest;
    const urlOpt = HttpServerRequest.toURL(request);
    const hours = Option.isSome(urlOpt) ? (urlOpt.value.searchParams.get('hours') ?? '24') : '24';

    const { getHealthHistory } = yield* Effect.promise(() => import('../../../../lib/overdeck/health-events.js'));
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - parseInt(hours) * 60 * 60 * 1000);
    const events = getHealthHistory(id, startTime.toISOString(), endTime.toISOString());
    return jsonResponse({
      agentId: id,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      events,
    });
  })),
);

// ─── Route: POST /api/agents/:id/heartbeat (PAN-800 ingestion) ──────────────
//
// Typed event ingestion for agent runtime state. Hooks POST a Schema-validated
// body describing a single runtime transition; the handler translates to an
// agent.* DomainEvent and hands it to AgentStateService.emit (which durably
// appendAsyncs via EventStore).
//
// Body shape (discriminated by `kind`):
//   {kind: "activity",          activity, tool?}
//   {kind: "thinking_start",    lastToolAt}
//   {kind: "thinking_stop",     resolvedBy}
//   {kind: "waiting_start",     reason, message?}
//   {kind: "waiting_clear",     clearedBy}
//   {kind: "message_received",  direction, source}
//   {kind: "model_set",         model, claudeSessionId?}
//   {kind: "resolution_set",    resolution, resolutionCount}
//   {kind: "current_issue_set", currentIssue?}
//   {kind: "context_saturation_changed", contextSaturatedAt?}

function emitAgentRuntimeEvent(id: string, body: Record<string, unknown>, timestamp: string) {
  return Effect.gen(function* () {
    let raw: Record<string, unknown> | null;
    try {
      raw = bodyToEvent(id, body, timestamp);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid heartbeat payload';
      return { ok: false as const, response: jsonResponse({ success: false, error: message }, { status: 400 }) };
    }
    if (!raw) {
      return { ok: true as const, emitted: false };
    }

    const candidate = { ...raw, sequence: 0 };
    const decoded = decodeDomainEvent(candidate);
    if (decoded._tag === 'Failure') {
      return {
        ok: false as const,
        response: jsonResponse(
          { success: false, error: 'invalid event', detail: String(decoded.failure) },
          { status: 400 },
        ),
      };
    }

    const { AgentStateService } = yield* Effect.promise(
      () => import('../../services/agent-state-service.js'),
    );
    const agentState = yield* AgentStateService;
    yield* agentState.emit(decoded.success as never);
    return { ok: true as const, emitted: true };
  });
}

export const postAgentHeartbeatRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/heartbeat',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    }
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const timestamp = (body['timestamp'] as string) ?? new Date().toISOString();
    const result = yield* emitAgentRuntimeEvent(id, body, timestamp);
    if (!result.ok) return result.response;
    return jsonResponse({ success: true, emitted: result.emitted });
  })),
);

export const postAgentWorkCompleteRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/work-complete',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    const result = yield* emitAgentRuntimeEvent(id, { kind: 'resolution_set', resolution: 'done', resolutionCount: 1 }, new Date().toISOString());
    if (!result.ok) return result.response;
    return jsonResponse({ success: true, emitted: result.emitted });
  })),
);

export const postAgentStuckRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/stuck',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    const result = yield* emitAgentRuntimeEvent(id, { kind: 'resolution_set', resolution: 'stuck', resolutionCount: 1 }, new Date().toISOString());
    if (!result.ok) return result.response;
    return jsonResponse({ success: true, emitted: result.emitted });
  })),
);

function hasNegatedCompletionOutput(output: string): boolean {
  return /\b(not|never|no|cannot|can't|blocked|waiting|needs input|not yet|isn't|aren't)\b.{0,48}\b(implementation complete|all tasks closed|ready for review|work complete)\b/i.test(output);
}

export const postAgentClassifyCompletionRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/classify-completion',
  httpHandler(Effect.gen(function* () {
    const body = (yield* readJsonBody) as Record<string, unknown>;
    const output = typeof body['output'] === 'string' ? body['output'] : '';
    const verdict = /blocked|needs input|waiting for|not ready for review/i.test(output) || hasNegatedCompletionOutput(output)
      ? 'STOPPED_FOR_INPUT'
      : /Implementation complete|all tasks closed|ready for review|work complete/i.test(output)
        ? 'FORGOT_COMPLETION'
        : 'UNCLEAR';
    return jsonResponse({ success: true, verdict });
  })),
);

// ─── Route: GET /api/agents/:id/runtime (PAN-800) ────────────────────────────
// Exposes AgentRuntimeSnapshot to out-of-process readers (CLI, tests).

export const getAgentRuntimeRoute = HttpRouter.add(
  'GET',
  '/api/agents/:id/runtime',
  httpHandler(Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    }
    const { AgentStateService } = yield* Effect.promise(
      () => import('../../services/agent-state-service.js'),
    );
    const agentState = yield* AgentStateService;
    const snapshot = yield* agentState.get(id);
    if (!snapshot) {
      return jsonResponse({ success: false, error: 'not found' }, { status: 404 });
    }
    return jsonResponse({ success: true, snapshot });
  })),
);
