/**
 * PAN-5108: `GET /api/harness-auto-update` serves the background updater's
 * snapshot, and the route is scoped `read:state` for paired phones.
 */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it } from 'vitest';

import { harnessAutoUpdateRouteLayer } from '../routes/harness-auto-update.js';
import { ROUTE_SCOPES, requiredScopeFor } from '../route-scopes.js';

async function getHarnessAutoUpdate() {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/harness-auto-update'));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(harnessAutoUpdateRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: JSON.parse(text) };
}

describe('GET /api/harness-auto-update (PAN-5108)', () => {
  it('returns 200 with the empty snapshot when the service has not started', async () => {
    const res = await getHarnessAutoUpdate();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ enabled: null, running: false, lastRunAt: null, nextRunAt: null, failures: [] });
  });

  it('is scoped read:state, so a paired phone with read:state is accepted', () => {
    expect(requiredScopeFor('GET', '/api/harness-auto-update')).toBe('read:state');
    expect(ROUTE_SCOPES).toContainEqual({ method: 'GET', path: '/api/harness-auto-update', scope: 'read:state' });
  });
});
