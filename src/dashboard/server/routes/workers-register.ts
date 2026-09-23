/**
 * `POST /api/workers/register` (PAN-3920 W19, FR-16) — the HTTP door for
 * recording an externally spawned agent in the Agents Directory.
 *
 * Auth: the internal-token header (`validateAgentRuntimeEventAuth`), as every
 * agent runtime write. Body: the same fields as `pan worker register`
 * (`source`, `externalId`, `harness`, and optional `model`, `cwd`, `issue`,
 * `parent`, `label`, `pid`, `transcript`, `sessionId`). The route and the CLI
 * share one core (`lib/agents/external-register.ts`). 200 `{ id, created }`;
 * a repeat registration returns the existing id and writes nothing.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  parseExternalRegisterFields,
  performExternalRegistration,
  type ExternalRegisterFields,
  type ParsedRegisterFields,
} from '../../../lib/agents/external-register.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { validateAgentRuntimeEventAuth } from './agents/shared.js';

/** Validate a parsed JSON body; exported for tests (the Effect route is not unit-testable). */
export function parseRegisterBody(body: unknown): ParsedRegisterFields {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  return parseExternalRegisterFields(body as ExternalRegisterFields);
}

const postWorkersRegisterRoute = HttpRouter.add(
  'POST',
  '/api/workers/register',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* Effect.promise(() => validateAgentRuntimeEventAuth(request));
    if (!auth.ok) return auth.response;

    const text = yield* request.text;
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return jsonResponse({ error: 'body must be JSON' }, { status: 400 });
    }
    const parsed = parseRegisterBody(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, { status: 400 });

    return yield* Effect.promise(async () => {
      try {
        return jsonResponse(await performExternalRegistration(parsed.value));
      } catch (error: unknown) {
        console.error('[workers-register] failed:', error instanceof Error ? error.message : String(error));
        return jsonResponse({ error: 'Internal server error' }, { status: 500 });
      }
    });
  })),
);

export const workersRegisterRouteLayer = Layer.mergeAll(postWorkersRegisterRoute);
