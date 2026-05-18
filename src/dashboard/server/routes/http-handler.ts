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

import { Cause, Effect, Option } from 'effect';
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

// Burst-control for the opaque-defect log: log the first OPAQUE_FULL_BURST
// occurrences in full, then once per OPAQUE_BURST_INTERVAL_MS, emit a summary
// with the count of suppressed events. This stops a runaway null-defect source
// from filling the log + saturating the event loop with formatting work, while
// preserving full detail for the first few occurrences so diagnosis is possible.
const OPAQUE_FULL_BURST = 5;
const OPAQUE_BURST_INTERVAL_MS = 30_000;
let opaqueLogged = 0;
let opaqueSuppressed = 0;
let opaqueLastSummaryAt = 0;

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
  // Capture the registration call site (where the route called httpHandler(...))
  // so when a fiber emits a typed Fail with no stack — e.g. Effect.fail(null) —
  // we can still tell which route module the handler belongs to.
  const registeredAt = (new Error('httpHandler registered')).stack ?? '<no stack>';
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
        if (Cause.hasInterruptsOnly(cause)) {
          return jsonResponse({ error: 'Request cancelled' }, { status: 499 });
        }
        const error = Cause.squash(cause);
        const message = error instanceof Error ? error.message : 'Internal server error';
        const reqOption = yield* Effect.serviceOption(HttpServerRequest);
        const route = Option.match(reqOption, {
          onNone: () => 'unknown',
          onSome: (req) => `${req.method} ${req.url}`,
        });
        // When the squashed defect is null/undefined or a non-Error value the pretty
        // printer produces `Error: Unknown error: null` with no stack, which leaves
        // the source impossible to locate. Capture extra context for those cases:
        // the JSON shape of the cause (failures + defects), the typeof, and a stack
        // sampled from this catch site so we can at least see what caller chained
        // into httpHandler.
        const isOpaque = !(error instanceof Error);
        if (isOpaque) {
          if (opaqueLogged < OPAQUE_FULL_BURST) {
            opaqueLogged += 1;
            let causeJson: string;
            try {
              causeJson = JSON.stringify(cause, (_k, v) => (typeof v === 'function' ? '[fn]' : v), 2);
            } catch {
              causeJson = '<cause not serializable>';
            }
            console.error(
              `[httpHandler] Opaque non-Error defect on ${route} (#${opaqueLogged}): typeof=${typeof error} value=${String(error)}\n` +
              `cause=${causeJson}\n` +
              `registeredAt=${registeredAt}`,
            );
          } else {
            opaqueSuppressed += 1;
            const now = Date.now();
            if (now - opaqueLastSummaryAt >= OPAQUE_BURST_INTERVAL_MS) {
              opaqueLastSummaryAt = now;
              console.error(
                `[httpHandler] Opaque non-Error defect on ${route} — ${opaqueSuppressed} more suppressed since last summary ` +
                `(set DEBUG_OPAQUE_DEFECTS=1 to see all). value=${String(error)}`,
              );
              opaqueSuppressed = 0;
            }
          }
        } else {
          console.error(`[httpHandler] Unhandled error on ${route}:\n${Cause.pretty(cause)}`);
        }
        return jsonResponse({ error: message }, { status: 500 });
      }),
    )
  ) as Effect.Effect<typeof HttpServerResponse.Type, never, R>;
}
