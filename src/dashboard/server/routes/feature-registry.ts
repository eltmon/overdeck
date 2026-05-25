import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import type { FeatureRegistryEntry, FeatureRegistryListFilter } from '@panctl/contracts';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { listFeatureRegistryForDashboard } from '../services/feature-registry-service.js';

export interface FeatureRegistryListPayload {
  entries: FeatureRegistryEntry[];
}

export interface FeatureRegistryListOptions {
  listEntries?: (filter?: FeatureRegistryListFilter) => Promise<FeatureRegistryEntry[]>;
}

export async function getFeatureRegistryListPayload(
  options: FeatureRegistryListOptions = {},
): Promise<FeatureRegistryListPayload> {
  const listEntries = options.listEntries ?? listFeatureRegistryForDashboard;
  return { entries: await listEntries({ limit: 100 }) };
}

const listFeatureRegistryRoute = HttpRouter.add(
  'GET',
  '/api/registry/features',
  httpHandler(Effect.gen(function* () {
    const payload = yield* Effect.promise(() => getFeatureRegistryListPayload());
    return jsonResponse(payload);
  })),
);

export const featureRegistryRouteLayer = Layer.provideMerge(
  listFeatureRegistryRoute,
  Layer.empty,
);
