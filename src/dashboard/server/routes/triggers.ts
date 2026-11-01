/**
 * Trigger management routes — Effect HttpRouter.Layer (PAN-4648 W-6).
 *
 * GET    /api/triggers                     → { triggers, funnel: { port, baseUrl, command } }
 * POST   /api/triggers                     → 201 { trigger, hookPath, url, urlSecretShownOnce, generatedSigningSecret }
 * DELETE /api/triggers/:id                 → { removed: true } | 404
 * PUT    /api/triggers/:id/signing-secret  → { trigger } | 400 | 404
 *
 * These stay behind the remote request gate at the default `admin` scope. The
 * create response is the only place the URL secret (and a generated GitHub
 * signing secret) ever appears; every response is `Cache-Control: no-store`
 * and the list carries public records only. The store itself is
 * `src/lib/triggers/store.ts`; target checks and Funnel text are
 * `src/lib/triggers/setup.ts`, shared with `pan triggers`.
 */
import { Effect, Layer, Result } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { resolveTriggerTarget, triggerFunnelBaseUrl, triggerFunnelCommand, TRIGGER_FUNNEL_PORT } from '../../../lib/triggers/setup.js';
import { createTrigger, listPublicTriggers, removeTrigger, setTriggerSigningSecret, type TriggerVerifyKind } from '../../../lib/triggers/store.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getTrustedOrigins } from './origin-validation.js';

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const readBody = (request: HttpServerRequest.HttpServerRequest) =>
  request.text.pipe(Effect.map(parseJsonObject), Effect.orElseSucceed(() => null));

/** Run a store call; a rejection becomes its message (validation errors are 400s). */
const tryStore = <A>(run: () => Promise<A>) =>
  Effect.result(Effect.tryPromise({ try: run, catch: (error) => (error instanceof Error ? error.message : String(error)) }));

const listTriggersRoute = HttpRouter.add(
  'GET',
  '/api/triggers',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const triggers = yield* tryStore(() => listPublicTriggers());
    if (Result.isFailure(triggers)) return noStore(jsonResponse({ error: triggers.failure }, { status: 500 }));
    return noStore(jsonResponse({
      triggers: triggers.success,
      funnel: { port: TRIGGER_FUNNEL_PORT, baseUrl: triggerFunnelBaseUrl(getTrustedOrigins()), command: triggerFunnelCommand() },
    }));
  }),
);

const createTriggerRoute = HttpRouter.add(
  'POST',
  '/api/triggers',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const body = yield* readBody(request);
    if (!body) return noStore(jsonResponse({ error: 'invalid JSON body' }, { status: 400 }));

    const resolved = resolveTriggerTarget(body.target);
    if (!resolved.ok) return noStore(jsonResponse({ error: resolved.error }, { status: 400 }));
    const created = yield* tryStore(() => createTrigger({
      name: body.name as string,
      target: resolved.target,
      template: (body.template ?? null) as string | null,
      verify: (body.verify ?? 'none') as TriggerVerifyKind,
      signingSecret: (body.signingSecret ?? null) as string | null,
    }));
    if (Result.isFailure(created)) return noStore(jsonResponse({ error: created.failure }, { status: 400 }));

    const { trigger, hookPath, generatedSigningSecret } = created.success;
    const baseUrl = triggerFunnelBaseUrl(getTrustedOrigins());
    console.log(`[triggers] created ${trigger.id}`);
    return noStore(jsonResponse(
      { trigger, hookPath, url: baseUrl ? `${baseUrl}${hookPath}` : null, urlSecretShownOnce: true, generatedSigningSecret },
      { status: 201 },
    ));
  }),
);

const removeTriggerRoute = HttpRouter.add(
  'DELETE',
  '/api/triggers/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const removed = yield* tryStore(() => removeTrigger(id));
    if (Result.isFailure(removed)) return noStore(jsonResponse({ error: removed.failure }, { status: 500 }));
    if (!removed.success) return noStore(jsonResponse({ error: `no trigger with id ${id}` }, { status: 404 }));
    console.log(`[triggers] removed ${id}`);
    return noStore(jsonResponse({ removed: true }));
  }),
);

const setSigningSecretRoute = HttpRouter.add(
  'PUT',
  '/api/triggers/:id/signing-secret',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const body = yield* readBody(request);
    if (!body || typeof body.secret !== 'string') return noStore(jsonResponse({ error: 'body must be { "secret": string }' }, { status: 400 }));
    const secret = body.secret;
    const updated = yield* tryStore(() => setTriggerSigningSecret(id, secret));
    if (Result.isFailure(updated)) return noStore(jsonResponse({ error: updated.failure }, { status: 400 }));
    if (!updated.success) return noStore(jsonResponse({ error: `no trigger with id ${id}` }, { status: 404 }));
    console.log(`[triggers] set signing secret for ${id}`);
    return noStore(jsonResponse({ trigger: updated.success }));
  }),
);

export const triggersRouteLayer = Layer.mergeAll(listTriggersRoute, createTriggerRoute, removeTriggerRoute, setSigningSecretRoute);
