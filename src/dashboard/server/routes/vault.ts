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
 *   POST /api/vault/setup  — PAN-4446 FR-4, body { url, passphrase: { mode } }; returns the recovery phrase once
 *   POST /api/vault/join   — PAN-4446 FR-5, body { url, secret: { kind, value } }; also unlocks this machine
 *   POST /api/vault/sync   — PAN-4446 FR-6, one queued sync; 409 when the vault service is not running
 *   POST /api/vault/sessions/by-conversation/:name/settle — PAN-4455 FR-8, settle one conversation now (Hand off now)
 *
 * Setup, join and sync answer only the root session or a paired device (D-8),
 * and every response from them is `Cache-Control: no-store` (D-11): the setup
 * response carries the recovery phrase and any generated passphrase.
 */
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import type { JoinSecret } from '../../../lib/vault/join-core.js';
import type { SetupPassphrase } from '../../../lib/vault/setup-core.js';

import {
  clearEvictionBatch,
  confirmEvictionBatch,
  declineEvictionEntry,
  getVaultServiceSnapshot,
  joinVaultFromDashboard,
  reofferEvictionEntry,
  reviewEvictionBatch,
  setupVaultFromDashboard,
  syncVaultNow,
} from '../services/vault-service.js';
import { continueHere, previewContinue } from '../services/vault-continue.js';
import { handOffConversation } from '../services/vault-handoff.js';
import { jsonResponse } from '../http-helpers.js';
import { rejectUnauthorizedDashboardRequest, rejectUnsafeDashboardMutationRequest, resolveDashboardCredential } from './dashboard-auth.js';
import { httpHandler } from './http-handler.js';
import type { HeaderMap } from './origin-validation.js';

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

function noStore(response: HttpServerResponse.HttpServerResponse): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store');
}

/** D-8: the operator's browser or a paired device; never the internal token or a scoped token. */
function rejectNonOperatorCredential(request: HttpServerRequest.HttpServerRequest): HttpServerResponse.HttpServerResponse | null {
  const kind = resolveDashboardCredential(request.headers as HeaderMap)?.kind;
  if (kind === 'root-session' || kind === 'device') return null;
  return jsonResponse({ error: 'Only the dashboard in a browser or a paired device can set up, join or sync the Session Vault.' }, { status: 403 });
}

const MAX_BACKEND_URL_LENGTH = 2048;
// eslint-disable-next-line no-control-regex -- D-12 rejects control characters in a backend URL
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** D-12: a git remote or `dir:` backend; `-` is refused so it can never read as an option. */
function backendUrlField(body: unknown): string | null {
  const url = stringField(body, 'url');
  if (url === null || url.length > MAX_BACKEND_URL_LENGTH || CONTROL_CHARACTERS.test(url) || url.startsWith('-')) return null;
  return url;
}

function passphraseField(body: unknown): SetupPassphrase | null {
  const value = (body as Record<string, unknown> | null)?.['passphrase'];
  const mode = (value as Record<string, unknown> | null)?.['mode'];
  if (mode === 'generate' || mode === 'none') return { mode };
  if (mode !== 'custom') return null;
  const custom = stringField(value, 'value');
  return custom === null ? null : { mode: 'custom', value: custom };
}

function secretField(body: unknown): JoinSecret | null {
  const value = (body as Record<string, unknown> | null)?.['secret'];
  const kind = (value as Record<string, unknown> | null)?.['kind'];
  const secret = stringField(value, 'value');
  if ((kind !== 'passphrase' && kind !== 'phrase') || secret === null) return null;
  return { kind, value: secret };
}

/**
 * Shared shell of the setup, join and sync routes: the mutation checks, the
 * D-8 credential check and `no-store` on every response. A throw becomes
 * 500 with its message only (D-14); results are never logged (H-5).
 */
function operatorVaultMutation(
  handle: (body: unknown, params: Readonly<Record<string, string | undefined>>) => Promise<HttpServerResponse.HttpServerResponse>,
) {
  return httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request) ?? rejectNonOperatorCredential(request);
    if (authError) return noStore(authError);
    const body = yield* readJsonBody;
    if (body === MALFORMED_JSON) return noStore(jsonResponse({ error: 'request body is not valid JSON' }, { status: 400 }));
    const params = yield* HttpRouter.params;
    return yield* Effect.promise(async () => {
      try {
        return noStore(await handle(body, params));
      } catch (error) {
        return noStore(jsonResponse({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }));
      }
    });
  }));
}

const postVaultSetupRoute = HttpRouter.add(
  'POST',
  '/api/vault/setup',
  operatorVaultMutation(async (body) => {
    const url = backendUrlField(body);
    if (url === null) return jsonResponse({ error: 'url must be a git remote or dir: path (at most 2048 characters, no control characters, not starting with -)' }, { status: 400 });
    const passphrase = passphraseField(body);
    if (passphrase === null) return jsonResponse({ error: "passphrase must be { mode: 'generate' }, { mode: 'custom', value }, or { mode: 'none' }" }, { status: 400 });
    const result = await setupVaultFromDashboard({ url, passphrase });
    return jsonResponse(result, { status: result.status === 'error' ? 422 : 200 });
  }),
);

const postVaultJoinRoute = HttpRouter.add(
  'POST',
  '/api/vault/join',
  operatorVaultMutation(async (body) => {
    const url = backendUrlField(body);
    if (url === null) return jsonResponse({ error: 'url must be a git remote or dir: path (at most 2048 characters, no control characters, not starting with -)' }, { status: 400 });
    const secret = secretField(body);
    if (secret === null) return jsonResponse({ error: "secret must be { kind: 'passphrase' | 'phrase', value }" }, { status: 400 });
    const result = await joinVaultFromDashboard({ url, secret });
    return jsonResponse(result, { status: result.status === 'error' ? 422 : 200 });
  }),
);

const postVaultSyncRoute = HttpRouter.add(
  'POST',
  '/api/vault/sync',
  operatorVaultMutation(async () => {
    const result = await syncVaultNow();
    if (result.status === 'not-running') {
      return jsonResponse({ error: 'Background sync runs only in the primary dashboard.', code: 'sync-not-running' }, { status: 409 });
    }
    return jsonResponse(result.snapshot);
  }),
);

/** The router (find-my-way-ts `maxParamLength`) never matches a longer path parameter. */
const MAX_CONVERSATION_NAME_LENGTH = 100;

const postVaultHandOffRoute = HttpRouter.add(
  'POST',
  '/api/vault/sessions/by-conversation/:name/settle',
  operatorVaultMutation(async (_body, params) => {
    const name = params['name'] ?? '';
    if (name === '' || name.length > MAX_CONVERSATION_NAME_LENGTH) {
      return jsonResponse({ error: `name must be a conversation name of at most ${MAX_CONVERSATION_NAME_LENGTH} characters` }, { status: 400 });
    }
    const outcome = await handOffConversation(name);
    return jsonResponse(outcome.body, { status: outcome.status });
  }),
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
  postVaultSetupRoute,
  postVaultJoinRoute,
  postVaultSyncRoute,
  postVaultHandOffRoute,
);
