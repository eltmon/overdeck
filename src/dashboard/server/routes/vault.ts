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
 *   GET  /api/vault/sessions/:vaultId/continue-preview  — PAN-4437 FR-1, writes nothing
 *   POST /api/vault/sessions/:vaultId/continue          — body { expectedOwnerToken, onDrift? }
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
import { continueHere, previewContinue } from '../services/vault-continue.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';

const MALFORMED_JSON = Symbol('malformed-json');

const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return MALFORMED_JSON;
  }
});

function stringField(body: unknown, field: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === 'string' && value !== '' ? value : null;
}

function stringArrayField(body: unknown, field: string): string[] {
  const value = (body as Record<string, unknown> | null)?.[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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
    if (body === MALFORMED_JSON) return jsonResponse({ error: 'request body is not valid JSON' }, { status: 400 });
    const fingerprint = stringField(body, 'fingerprint');
    if (fingerprint === null) return jsonResponse({ error: 'fingerprint is required' }, { status: 400 });
    const deletableVaultIds = stringArrayField(body, 'deletableVaultIds');
    return yield* Effect.promise(async () => {
      const result = await confirmEvictionBatch(fingerprint, deletableVaultIds);
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
    if (body === MALFORMED_JSON) return jsonResponse({ error: 'request body is not valid JSON' }, { status: 400 });
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
    if (body === MALFORMED_JSON) return jsonResponse({ error: 'request body is not valid JSON' }, { status: 400 });
    const vaultId = stringField(body, 'vaultId');
    if (vaultId === null) return jsonResponse({ error: 'vaultId is required' }, { status: 400 });
    return yield* Effect.promise(async () => jsonResponse(await reofferEvictionEntry(vaultId)));
  })),
);

const VAULT_ID_PATTERN = /^[0-9a-f-]+$/;
const OWNER_TOKEN_PATTERN = /^[0-9a-f]{16}$/;

const vaultIdParam = Effect.gen(function* () {
  const vaultId = (yield* HttpRouter.params)['vaultId'] ?? '';
  return VAULT_ID_PATTERN.test(vaultId) ? vaultId : null;
});

const getVaultContinuePreviewRoute = HttpRouter.add(
  'GET',
  '/api/vault/sessions/:vaultId/continue-preview',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(request);
    if (authError) return authError;
    const vaultId = yield* vaultIdParam;
    if (vaultId === null) return jsonResponse({ error: 'vaultId must be a vault record id' }, { status: 400 });
    return yield* Effect.promise(async () => {
      const outcome = await previewContinue(vaultId);
      return jsonResponse(outcome.body, { status: outcome.status });
    });
  })),
);

const postVaultContinueRoute = HttpRouter.add(
  'POST',
  '/api/vault/sessions/:vaultId/continue',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const vaultId = yield* vaultIdParam;
    if (vaultId === null) return jsonResponse({ error: 'vaultId must be a vault record id' }, { status: 400 });
    const body = yield* readJsonBody;
    if (body === MALFORMED_JSON) return jsonResponse({ error: 'request body is not valid JSON' }, { status: 400 });
    const expectedOwnerToken = stringField(body, 'expectedOwnerToken');
    if (expectedOwnerToken === null || !OWNER_TOKEN_PATTERN.test(expectedOwnerToken)) {
      return jsonResponse({ error: 'expectedOwnerToken is required (16 hex characters)' }, { status: 400 });
    }
    const onDrift = (body as Record<string, unknown> | null)?.['onDrift'];
    if (onDrift !== undefined && onDrift !== 'continue' && onDrift !== 'note') {
      return jsonResponse({ error: "onDrift must be 'continue' or 'note'" }, { status: 400 });
    }
    return yield* Effect.promise(async () => {
      const outcome = await continueHere(vaultId, { expectedOwnerToken, ...(onDrift ? { onDrift } : {}) });
      return jsonResponse(outcome.body, { status: outcome.status });
    });
  })),
);

export const vaultRouteLayer = Layer.mergeAll(
  getVaultStatusRoute,
  getVaultEvictionBatchRoute,
  confirmVaultEvictionBatchRoute,
  declineVaultEvictionEntryRoute,
  clearVaultEvictionBatchRoute,
  reofferVaultEvictionEntryRoute,
  getVaultContinuePreviewRoute,
  postVaultContinueRoute,
);
