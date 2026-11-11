/**
 * PAN-5100: `GET /api/telemetry/client-config` — the machine's telemetry
 * setting for the phone app (read:state).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { telemetryClientConfig } from '../../../lib/settings-api-telemetry.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';

const clientConfigRoute = HttpRouter.add(
  'GET',
  '/api/telemetry/client-config',
  httpHandler(Effect.sync(() => jsonResponse(telemetryClientConfig()))),
);

export const telemetryClientConfigRouteLayer = Layer.mergeAll(clientConfigRoute);
