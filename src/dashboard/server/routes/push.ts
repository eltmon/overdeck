/**
 * Needs-you push routes (PAN-2354).
 *
 * - `GET /api/push/vapid-public-key` — the machine's VAPID public key, which
 *   the browser needs to subscribe. Creates the key on first use.
 * - `GET /api/push/status` — the Settings panel's data. Never carries secret
 *   material: no subscription keys or full endpoints (only the host), no ntfy
 *   token, and only a topic hint.
 * - `POST /api/push/subscriptions` — `{ subscription: { endpoint, keys }, label? }`;
 *   records which paired device subscribed so revoking it stops its push.
 * - `DELETE /api/push/subscriptions/:id`
 * - `POST /api/push/test` — send a test notification to every target.
 *
 * None of these are in ROUTE_SCOPES, so they need `admin`; paired phones hold
 * `admin`. Mutations also pass the usual Origin and CSRF checks. No response is
 * cacheable.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { addPushSubscription, removePushSubscription } from '../../../lib/push/subscription-store.js';
import { ensureVapidKeys } from '../../../lib/push/vapid-keys.js';
import { jsonResponse } from '../http-helpers.js';
import { getNeedsYouPushStatus, sendTestPush } from '../services/needs-you-push-service.js';
import {
  rejectUnauthorizedDashboardRequest,
  rejectUnsafeDashboardMutationRequest,
  resolveDashboardCredential,
} from './dashboard-auth.js';
import type { HeaderMap } from './origin-validation.js';

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

/** The paired device's id, or null for the root session and the internal token. */
function callerDeviceId(request: HttpServerRequest.HttpServerRequest): string | null {
  const credential = resolveDashboardCredential(request.headers as HeaderMap);
  return credential?.kind === 'device' ? credential.deviceId : null;
}

const vapidPublicKeyRoute = HttpRouter.add(
  'GET',
  '/api/push/vapid-public-key',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    const keys = yield* Effect.promise(() => ensureVapidKeys());
    return noStore(jsonResponse({ publicKey: keys.publicKey }));
  }),
);

const pushStatusRoute = HttpRouter.add(
  'GET',
  '/api/push/status',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return noStore(authError);
    return noStore(jsonResponse(yield* Effect.promise(() => getNeedsYouPushStatus(callerDeviceId(request)))));
  }),
);

const addSubscriptionRoute = HttpRouter.add(
  'POST',
  '/api/push/subscriptions',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);

    const body = parseJsonObject(yield* request.text);
    const subscription = body?.['subscription'];
    const sub = subscription && typeof subscription === 'object' ? subscription as Record<string, unknown> : null;
    const keys = sub?.['keys'] && typeof sub['keys'] === 'object' ? sub['keys'] as Record<string, unknown> : null;
    if (!sub || typeof sub['endpoint'] !== 'string' || !keys || typeof keys['p256dh'] !== 'string' || typeof keys['auth'] !== 'string') {
      return noStore(jsonResponse({ error: 'body must be { subscription: { endpoint, keys: { p256dh, auth } }, label? }' }, { status: 400 }));
    }

    const result = yield* Effect.promise(() => addPushSubscription({
      endpoint: sub['endpoint'] as string,
      keys: { p256dh: keys['p256dh'] as string, auth: keys['auth'] as string },
      label: typeof body?.['label'] === 'string' ? body['label'] : null,
      credentialId: callerDeviceId(request),
    }));
    if (!result.ok) return noStore(jsonResponse({ error: result.reason }, { status: 400 }));
    return noStore(jsonResponse({ id: result.record.id }, { status: 201 }));
  }),
);

const removeSubscriptionRoute = HttpRouter.add(
  'DELETE',
  '/api/push/subscriptions/:id',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const id = (yield* HttpRouter.params)['id'] ?? '';
    const removed = yield* Effect.promise(() => removePushSubscription(id));
    return noStore(removed ? jsonResponse({ removed: true }) : jsonResponse({ error: 'not-found' }, { status: 404 }));
  }),
);

const testPushRoute = HttpRouter.add(
  'POST',
  '/api/push/test',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return noStore(authError);
    const outcomes = yield* Effect.promise(() => sendTestPush());
    return noStore(jsonResponse({ outcomes }));
  }),
);

export const pushRouteLayer = Layer.mergeAll(
  vapidPublicKeyRoute,
  pushStatusRoute,
  addSubscriptionRoute,
  removeSubscriptionRoute,
  testPushRoute,
);
