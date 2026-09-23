/**
 * POST /api/agents/:id/lifecycle (PAN-3849 W33, PAN-3962)
 *
 * The PTY supervisor observes the harness process directly (it owns the PTY
 * master) and posts lifecycle events here: session-started, turn-started,
 * turn-ended, exited. `:id` is the supervised terminal session id — an agent
 * id or a conversation's `conv-<name>` tmux session; this one route serves
 * both (applyAgentLifecycleEvent picks the target).
 *
 * For an agent, each event appends an event: its exit emits `agent.stopped`
 * without any patrol inferring it from a missing tmux session, and
 * `agent.started` is emitted when the process actually exists. Nothing is
 * mirrored — liveness is read from the terminal backend (PAN-3917 FR-12).
 *
 * For a conversation (no agent state, but a conversations row whose
 * tmux_session is `:id`), session-started marks the row active, exited marks
 * it ended, and turn/exit edges append `agent.activity_changed` keyed by the
 * session id.
 *
 * Auth: the per-session pty-token (x-overdeck-pty-token), the same credential
 * the delivery socket uses. Only the supervisor process holding the token
 * file may report lifecycle for its session.
 */
import { timingSafeEqual } from 'node:crypto';

import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { PTY_TOKEN_HEADER, readPtyToken } from '../../../../lib/pty-token.js';
import { jsonResponse } from '../../http-helpers.js';
import {
  applyAgentLifecycleEvent,
  type AgentLifecycleEventName,
} from '../../services/agent-projection.js';
import { httpHandler } from '../http-handler.js';
import { readJsonBody } from './shared.js';

const LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  'session-started',
  'turn-started',
  'turn-ended',
  'exited',
]);

function constantTimeTokenMatch(provided: string | string[] | undefined, expected: string): boolean {
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value) return false;
  const providedBuffer = Buffer.from(value, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export const postAgentLifecycleRoute = HttpRouter.add(
  'POST',
  '/api/agents/:id/lifecycle',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const params = yield* HttpRouter.params;
    const id = params['id'] ?? '';
    if (!id.trim()) {
      return jsonResponse({ success: false, error: 'missing agent id' }, { status: 400 });
    }

    const expected = yield* Effect.promise(() => readPtyToken(id));
    if (!expected || !constantTimeTokenMatch(request.headers[PTY_TOKEN_HEADER], expected)) {
      return jsonResponse({ success: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = (yield* readJsonBody) as Record<string, unknown>;
    const event = body['event'];
    if (typeof event !== 'string' || !LIFECYCLE_EVENTS.has(event)) {
      return jsonResponse({ success: false, error: `invalid lifecycle event: ${String(event)}` }, { status: 400 });
    }
    const at = typeof body['at'] === 'string' && !Number.isNaN(Date.parse(body['at']))
      ? body['at']
      : new Date().toISOString();
    const exitCode = typeof body['exitCode'] === 'number' ? body['exitCode'] : undefined;

    const result = yield* Effect.promise(() => applyAgentLifecycleEvent(id, {
      event: event as AgentLifecycleEventName,
      at,
      ...(exitCode !== undefined ? { exitCode } : {}),
    }));
    if (!result.applied) {
      // A retried POST carrying an already-applied event is a success for the
      // supervisor: the event it wanted recorded is recorded.
      if (result.reason === 'duplicate') {
        return jsonResponse({ success: true, applied: false, reason: 'duplicate' });
      }
      // A conversation's old harness exiting inside a respawn window is
      // expected and final — nothing to retry, nothing to record.
      if (result.reason === 'respawn-pending') {
        return jsonResponse({ success: true, applied: false, reason: 'respawn-pending' });
      }
      const status = result.reason === 'no-state' ? 404 : 409;
      return jsonResponse({ success: false, error: `lifecycle event not applied: ${result.reason}` }, { status });
    }
    return jsonResponse({ success: true, applied: true, status: result.status });
  })),
);
