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
import { ExternalPathError } from '../../../lib/agents/external-registry.js';
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
    return yield* Effect.promise(async () => {
      const result = await registerFromBody(body);
      return jsonResponse(result.body, { status: result.status });
    });
  })),
);

export type RegisterResult =
  | { status: 200; body: { id: string; created: boolean } }
  | { status: 400 | 500; body: { error: string } };

/**
 * Validate and perform one registration. A bad field, or a transcript path
 * that is not a regular file under the transcript roots, answers 400.
 */
export async function registerFromBody(
  body: unknown,
  perform: typeof performExternalRegistration = performExternalRegistration,
): Promise<RegisterResult> {
  const parsed = parseRegisterBody(body);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  try {
    return { status: 200, body: await perform(parsed.value) };
  } catch (error: unknown) {
    if (error instanceof ExternalPathError) return { status: 400, body: { error: error.message } };
    console.error('[workers-register] failed:', error instanceof Error ? error.message : String(error));
    return { status: 500, body: { error: 'Internal server error' } };
  }
}

export const workersRegisterRouteLayer = Layer.mergeAll(postWorkersRegisterRoute);
