/**
 * httpHandler — typed error-to-HTTP mapping wrapper (PAN-470)
 *
 * Wraps an Effect route body and catches all typed TaggedErrors,
 * mapping them to appropriate HTTP status codes. Unknown/unhandled
 * errors fall through as 500 Internal Server Error.
 *
 * Usage:
 *   HttpRouter.add('GET', '/api/foo', httpHandler(Effect.gen(function* () {
 *     const result = yield* someService.doThing();
 *     return jsonResponse(result);
 *   })))
 */

import { Cause, Effect } from 'effect';
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import {
  AgentAlreadyRunning,
  AgentStartError,
  BeadsNotInitialized,
  IssueNotFound,
  PlanEmpty,
  RateLimited,
  TrackerApiError,
  TrackerNotConfigured,
  WorkspaceCreateError,
  WorkspaceNotFound,
} from '../services/typed-errors.js';

/**
 * Wraps a route effect with typed error-to-HTTP status mapping.
 *
 * Error → Status mapping:
 *   IssueNotFound, WorkspaceNotFound      → 404 Not Found
 *   TrackerNotConfigured                  → 503 Service Unavailable
 *   RateLimited                           → 429 Too Many Requests
 *   AgentAlreadyRunning                   → 409 Conflict
 *   BeadsNotInitialized, PlanEmpty        → 422 Unprocessable Entity
 *   TrackerApiError                       → 502 Bad Gateway
 *   WorkspaceCreateError, AgentStartError → 500 Internal Server Error
 *   Unknown errors                        → 500 Internal Server Error
 */
export function httpHandler<R, E>(
  effect: Effect.Effect<typeof HttpServerResponse.Type, E, R>
): Effect.Effect<typeof HttpServerResponse.Type, never, R> {
  return (effect as Effect.Effect<typeof HttpServerResponse.Type, unknown, R>).pipe(
    Effect.catchTag('IssueNotFound', (err: IssueNotFound) =>
      Effect.succeed(jsonResponse({ error: `Issue not found: ${err.id}` }, { status: 404 }))
    ),
    Effect.catchTag('WorkspaceNotFound', (err: WorkspaceNotFound) =>
      Effect.succeed(jsonResponse({ error: `Workspace not found: ${err.id}` }, { status: 404 }))
    ),
    Effect.catchTag('TrackerNotConfigured', (err: TrackerNotConfigured) =>
      Effect.succeed(jsonResponse({ error: `Tracker not configured: ${err.tracker}` }, { status: 503 }))
    ),
    Effect.catchTag('RateLimited', (err: RateLimited) =>
      Effect.succeed(
        jsonResponse({ error: 'Rate limited', retryAfter: err.retryAfter }, { status: 429 })
      )
    ),
    Effect.catchTag('AgentAlreadyRunning', (err: AgentAlreadyRunning) =>
      Effect.succeed(jsonResponse({ error: `Agent already running for issue: ${err.id}` }, { status: 409 }))
    ),
    Effect.catchTag('BeadsNotInitialized', (err: BeadsNotInitialized) =>
      Effect.succeed(
        jsonResponse({ error: `Beads not initialized for workspace: ${err.workspace}` }, { status: 422 })
      )
    ),
    Effect.catchTag('PlanEmpty', (err: PlanEmpty) =>
      Effect.succeed(jsonResponse({ error: `Plan is empty for issue: ${err.id}` }, { status: 422 }))
    ),
    Effect.catchTag('TrackerApiError', (err: TrackerApiError) =>
      Effect.succeed(
        jsonResponse({ error: `Tracker API error (${err.tracker}): ${err.message}` }, { status: 502 })
      )
    ),
    Effect.catchTag('WorkspaceCreateError', (err: WorkspaceCreateError) =>
      Effect.succeed(
        jsonResponse({ error: `Workspace creation failed for ${err.id}: ${err.message}` }, { status: 500 })
      )
    ),
    Effect.catchTag('AgentStartError', (err: AgentStartError) =>
      Effect.succeed(
        jsonResponse({ error: `Agent start failed for ${err.id}: ${err.message}` }, { status: 500 })
      )
    ),
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        // Interrupt-only causes mean the consumer (browser tab, abort signal) cancelled
        // the request. That isn't a server error — silence it instead of spamming logs.
        if (Cause.isInterruptedOnly(cause)) {
          return jsonResponse({ error: 'Request cancelled' }, { status: 499 });
        }
        const error = Cause.squash(cause);
        const message = error instanceof Error ? error.message : 'Internal server error';
        let route = 'unknown';
        try {
          const req = yield* HttpServerRequest.HttpServerRequest;
          route = `${req.method} ${req.url}`;
        } catch {
          // request service may not be available in all contexts
        }
        console.error(`[httpHandler] Unhandled error on ${route}:\n${Cause.pretty(cause)}`);
        return jsonResponse({ error: message }, { status: 500 });
      }),
    )
  ) as Effect.Effect<typeof HttpServerResponse.Type, never, R>;
}
