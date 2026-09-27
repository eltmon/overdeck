/**
 * PAN-4264: `GET /api/github-quota` — the GitHub quota snapshot, identical to
 * the read model's `githubQuota` (both come from the publisher).
 */
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { refreshGitHubQuotaSnapshot } from '../services/github-quota.js';

const getGitHubQuotaRoute = HttpRouter.add(
  'GET',
  '/api/github-quota',
  httpHandler(
    Effect.gen(function* () {
      const snapshot = yield* Effect.promise(() => refreshGitHubQuotaSnapshot());
      return jsonResponse(snapshot);
    }),
  ),
);

export const githubQuotaRouteLayer = Layer.mergeAll(getGitHubQuotaRoute);
