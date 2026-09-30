/**
 * Session Vault routes (PAN-4307 WI-6) — Effect HttpRouter.Layer.
 *
 * Thin wrappers over the vault-service functions of WI-4; no route here
 * imports `evict.ts` or the transcript deletion door directly (NFR-3).
 *
 *   GET  /api/vault/status                       — FR-8 snapshot
 *   GET  /api/vault/eviction-batch                — FR-9 pending-deletion batch
 *   POST /api/vault/eviction-batch/confirm        — body { fingerprint }
 *   POST /api/vault/eviction-batch/decline        — body { vaultId }
 *   POST /api/vault/eviction-batch/clear
 *   POST /api/vault/eviction-batch/reoffer        — body { vaultId }
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import {
  clearEvictionBatch,
  confirmEvictionBatch,
  declineEvictionEntry,
  getVaultServiceSnapshot,
  reofferEvictionEntry,
  reviewEvictionBatch,
} from '../services/vault-service.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

function stringField(body: unknown, field: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' && value !== '' ? value : null;
}

const getVaultStatusRoute = HttpRouter.add(
  'GET',
  '/api/vault/status',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    return yield* Effect.promise(async () => jsonResponse(await getVaultServiceSnapshot()));
  })),
);

const getVaultEvictionBatchRoute = HttpRouter.add(
  'GET',
  '/api/vault/eviction-batch',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    return yield* Effect.promise(async () => jsonResponse(await reviewEvictionBatch()));
  })),
);

const confirmVaultEvictionBatchRoute = HttpRouter.add(
  'POST',
  '/api/vault/eviction-batch/confirm',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const fingerprint = stringField(body, 'fingerprint');
    if (fingerprint === null) return jsonResponse({ error: 'fingerprint is required' }, { status: 400 });
    return yield* Effect.promise(async () => {
      const result = await confirmEvictionBatch(fingerprint);
      if ('unavailable' in result) return jsonResponse({ error: result.unavailable, code: 'vault-unavailable' }, { status: 409 });
      if (result.refused) return jsonResponse({ error: 'The pending-deletion batch changed since it was displayed.', code: 'batch-changed', fingerprint: result.fingerprint }, { status: 409 });
      const { deleted, skipped, bytesFreed, fingerprint: nextFingerprint } = result;
      return jsonResponse({ deleted, skipped, bytesFreed, fingerprint: nextFingerprint });
    });
  })),
);

const declineVaultEvictionEntryRoute = HttpRouter.add(
  'POST',
  '/api/vault/eviction-batch/decline',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const vaultId = stringField(body, 'vaultId');
    if (vaultId === null) return jsonResponse({ error: 'vaultId is required' }, { status: 400 });
    return yield* Effect.promise(async () => jsonResponse(await declineEvictionEntry(vaultId)));
  })),
);

const clearVaultEvictionBatchRoute = HttpRouter.add(
  'POST',
  '/api/vault/eviction-batch/clear',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    return yield* Effect.promise(async () => jsonResponse(await clearEvictionBatch()));
  })),
);

const reofferVaultEvictionEntryRoute = HttpRouter.add(
  'POST',
  '/api/vault/eviction-batch/reoffer',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;
    const vaultId = stringField(body, 'vaultId');
    if (vaultId === null) return jsonResponse({ error: 'vaultId is required' }, { status: 400 });
    return yield* Effect.promise(async () => jsonResponse(await reofferEvictionEntry(vaultId)));
  })),
);

export const vaultRouteLayer = Layer.mergeAll(
  getVaultStatusRoute,
  getVaultEvictionBatchRoute,
  confirmVaultEvictionBatchRoute,
  declineVaultEvictionEntryRoute,
  clearVaultEvictionBatchRoute,
  reofferVaultEvictionEntryRoute,
);
