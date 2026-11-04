/**
 * Trigger management routes — Effect HttpRouter.Layer (PAN-4648 W-6).
 *
 * GET    /api/triggers                     → { triggers, funnel: { port, baseUrl, command } }
 * POST   /api/triggers                     → 201 { trigger, hookPath, url, urlSecretShownOnce, generatedSigningSecret, inboxUrl }
 * DELETE /api/triggers/:id                 → { removed: true } | 404
 *
 * PAN-2356: `inbox: true` also asks the overdeck.ai directory for an inbox that holds events while
 * this machine is offline. Its URL is returned once as `inboxUrl`. A free plan, a signed-out
 * machine or no answer within 10 s removes the new trigger and answers 409 with the reason.
 * Removing a trigger deletes its inbox.
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
import {
  createTrigger,
  listPublicTriggers,
  listTriggers,
  removeTrigger,
  setTriggerInbox,
  setTriggerSigningSecret,
  type TriggerVerifyKind,
} from '../../../lib/triggers/store.js';
import { jsonResponse } from '../http-helpers.js';
import { currentDirectoryClient } from '../services/directory-client.js';
import { type InboxDirectoryPort, requestInbox } from '../services/directory-inbox.js';
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

/**
 * The create door's logic, taking the parsed body and the directory so tests need no Effect
 * request mock. Returns the status and JSON body.
 */
export async function createTriggerFromBody(
  body: Record<string, unknown>,
  directory: InboxDirectoryPort | null,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const resolved = resolveTriggerTarget(body.target);
  if (!resolved.ok) return { status: 400, json: { error: resolved.error } };
  if (body.inbox !== undefined && typeof body.inbox !== 'boolean') return { status: 400, json: { error: 'inbox must be a boolean' } };
  let created: Awaited<ReturnType<typeof createTrigger>>;
  try {
    created = await createTrigger({
      name: body.name as string,
      target: resolved.target,
      template: (body.template ?? null) as string | null,
      verify: (body.verify ?? 'none') as TriggerVerifyKind,
      signingSecret: (body.signingSecret ?? null) as string | null,
    });
  } catch (error) {
    return { status: 400, json: { error: (error as Error).message } };
  }
  let { trigger } = created;
  const { hookPath, generatedSigningSecret } = created;
  let inboxUrl: string | null = null;
  if (body.inbox === true) {
    try {
      const inbox = await requestInbox(directory);
      trigger = (await setTriggerInbox(trigger.id, { id: inbox.inboxId, createdAt: new Date().toISOString() })) ?? trigger;
      inboxUrl = inbox.url;
    } catch (error) {
      await removeTrigger(trigger.id).catch(() => false);
      return { status: 409, json: { error: (error as Error).message } };
    }
  }
  const baseUrl = triggerFunnelBaseUrl(getTrustedOrigins());
  console.log(`[triggers] created ${trigger.id}${inboxUrl ? ' with inbox' : ''}`);
  return {
    status: 201,
    json: { trigger, hookPath, url: baseUrl ? `${baseUrl}${hookPath}` : null, urlSecretShownOnce: true, generatedSigningSecret, inboxUrl },
  };
}

const createTriggerRoute = HttpRouter.add(
  'POST',
  '/api/triggers',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const body = yield* readBody(request);
    if (!body) return noStore(jsonResponse({ error: 'invalid JSON body' }, { status: 400 }));
    const answer = yield* Effect.promise(() => createTriggerFromBody(body, currentDirectoryClient()));
    return noStore(jsonResponse(answer.json, { status: answer.status }));
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
    const existing = yield* tryStore(() => listTriggers());
    const inboxId = Result.isSuccess(existing) ? existing.success.find((record) => record.id === id)?.inbox?.id : undefined;
    const removed = yield* tryStore(() => removeTrigger(id));
    if (Result.isFailure(removed)) return noStore(jsonResponse({ error: removed.failure }, { status: 500 }));
    if (!removed.success) return noStore(jsonResponse({ error: `no trigger with id ${id}` }, { status: 404 }));
    // The directory deletes the inbox and every event it held; offline, the inbox expires unused.
    if (inboxId) currentDirectoryClient()?.send({ type: 'inbox-delete', inboxId });
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
