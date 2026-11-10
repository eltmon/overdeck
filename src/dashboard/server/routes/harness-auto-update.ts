/**
 * PAN-5108: `GET /api/harness-auto-update` — the background harness CLI
 * updater's snapshot (enabled, last and next pass, failures), served from the
 * harness-auto-update service's state.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { getHarnessAutoUpdateSnapshot } from '../services/harness-auto-update-service.js';
import { httpHandler } from './http-handler.js';

const getHarnessAutoUpdateRoute = HttpRouter.add(
  'GET',
  '/api/harness-auto-update',
  httpHandler(Effect.sync(() => jsonResponse(getHarnessAutoUpdateSnapshot()))),
);

export const harnessAutoUpdateRouteLayer = Layer.mergeAll(getHarnessAutoUpdateRoute);
