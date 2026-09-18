/**
 * POST /api/agents/:id/lifecycle (PAN-3849 W33)
 *
 * The PTY supervisor observes the harness process directly (it owns the PTY
 * master) and posts lifecycle events here: session-started, turn-started,
 * turn-ended, exited. The projection writes state.json and the agents row in
 * one transaction (applyAgentLifecycleEvent), so an agent's exit writes
 * `stopped` without any patrol inferring it from a missing tmux session
 * (FR-21) and agent.started is emitted when the process actually exists
 * (FR-24).
 *
 * Auth: the per-agent pty-token (x-overdeck-pty-token), the same credential
 * the delivery socket uses. Only the supervisor process holding the token
 * file may report lifecycle for its agent.
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

    const result = yield* Effect.sync(() => applyAgentLifecycleEvent(id, {
      event: event as AgentLifecycleEventName,
      at,
      ...(exitCode !== undefined ? { exitCode } : {}),
    }));
    if (!result.applied) {
      const status = result.reason === 'no-state' ? 404 : 409;
      return jsonResponse({ success: false, error: `lifecycle event not applied: ${result.reason}` }, { status });
    }
    return jsonResponse({ success: true, applied: true, status: result.status });
  })),
);
