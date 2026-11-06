/**
 * PAN-5093: `GET /api/disk-alert` — the current disk alert snapshot (level,
 * free bytes, space holders), served from the disk-alert service's state.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { getDiskAlertSnapshot } from '../services/disk-alert-service.js';
import { httpHandler } from './http-handler.js';

const getDiskAlertRoute = HttpRouter.add(
  'GET',
  '/api/disk-alert',
  httpHandler(Effect.sync(() => jsonResponse(getDiskAlertSnapshot()))),
);

export const diskAlertRouteLayer = Layer.mergeAll(getDiskAlertRoute);
