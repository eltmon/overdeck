/** PAN-5100: `GET /api/telemetry/client-config` serves the machine's telemetry setting for the phone app. */
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { describe, expect, it, vi } from 'vitest';
import type { TelemetryClientConfig } from '@overdeck/contracts';

const ON_CONFIG: TelemetryClientConfig = {
  effectiveEnabled: true,
  installId: '123e4567-e89b-42d3-a456-426614174000',
  installKind: 'user',
  posthogKey: 'phc_test',
  posthogHost: 'https://us.i.posthog.com',
};

const telemetryClientConfigMock = vi.hoisted(() => vi.fn<() => TelemetryClientConfig>());

vi.mock('../../../../lib/settings-api-telemetry.js', () => ({
  telemetryClientConfig: telemetryClientConfigMock,
}));

import { telemetryClientConfigRouteLayer } from '../telemetry-client-config.js';
import { requiredScopeFor } from '../../route-scopes.js';

async function getClientConfig() {
  const request = HttpServerRequest.fromWeb(new Request('http://localhost/api/telemetry/client-config'));
  const response = await Effect.runPromise(Effect.scoped(Effect.flatMap(
    HttpRouter.toHttpEffect(telemetryClientConfigRouteLayer),
    (app) => Effect.provideService(app, HttpServerRequest.HttpServerRequest, request),
  )));
  const payload = (response as { body: { body?: Uint8Array } }).body;
  const text = payload?.body ? new TextDecoder().decode(payload.body) : '';
  return { status: (response as { status?: number }).status ?? 200, json: JSON.parse(text) };
}

describe('GET /api/telemetry/client-config (PAN-5100)', () => {
  it('answers 200 with the config telemetryClientConfig() returns when on', async () => {
    telemetryClientConfigMock.mockReturnValue(ON_CONFIG);

    const res = await getClientConfig();

    expect(res.status).toBe(200);
    expect(res.json).toEqual(ON_CONFIG);
  });

  it('answers { effectiveEnabled: false } when telemetry is off', async () => {
    telemetryClientConfigMock.mockReturnValue({ effectiveEnabled: false });

    const res = await getClientConfig();

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ effectiveEnabled: false });
  });

  it('is scoped read:state, so a paired phone with read:state is accepted', () => {
    expect(requiredScopeFor('GET', '/api/telemetry/client-config')).toBe('read:state');
  });
});
