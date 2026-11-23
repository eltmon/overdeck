/**
 * Conversation-search full-reindex routes — split out of settings.ts (PAN-5609
 * WI-4) so this module can be loaded in isolation by tests: settings.ts pulls
 * in many heavy, side-effect-laden libs that make it hard to load under vitest.
 *
 *   GET  /api/settings/conversation-search/reindex-estimate
 *   POST /api/settings/conversation-search/reindex
 *   GET  /api/settings/conversation-search/reindex-progress
 */

import { randomBytes } from 'node:crypto';

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import { rejectUnsafeDashboardMutationRequest } from './dashboard-auth.js';
import { getConversationSearchConfig } from '../../../lib/config-yaml.js';
import { recordConversationSearchFailure, recordConversationSearchSuccess } from '../../../lib/conversation-search/health.js';
import { estimateFullReindexConversationSearchCost, fullReindexConversationSearch } from '../../../lib/conversation-search/indexer.js';
import { stopConversationSearchWatcher, syncConversationSearchWatcher } from '../services/conversation-search-watcher.js';
import { conversationSearchActivity, toLegacyReindexProgress } from '../services/conversation-search-activity.js';

// ─── Local helpers ────────────────────────────────────────────────────────────

const REINDEX_CONFIRM_THRESHOLD_USD = 1;
const REINDEX_CONFIRM_TTL_MS = 10 * 60 * 1000;
const reindexConfirmationNonces = new Map<string, { estimatedUsd: number; expiresAt: number }>();
let activeConversationSearchReindex: Promise<unknown> | null = null;

function createReindexConfirmationNonce(estimatedUsd: number): string {
  const nonce = randomBytes(24).toString('base64url');
  const now = Date.now();
  for (const [key, entry] of reindexConfirmationNonces) {
    if (entry.expiresAt <= now) reindexConfirmationNonces.delete(key);
  }
  reindexConfirmationNonces.set(nonce, { estimatedUsd, expiresAt: now + REINDEX_CONFIRM_TTL_MS });
  return nonce;
}

function consumeReindexConfirmationNonce(nonce: unknown, estimatedUsd: number): boolean {
  if (typeof nonce !== 'string') return false;
  const entry = reindexConfirmationNonces.get(nonce);
  reindexConfirmationNonces.delete(nonce);
  return !!entry && entry.expiresAt > Date.now() && Math.abs(entry.estimatedUsd - estimatedUsd) < 0.000001;
}

// Read the request body as unknown JSON
const readJsonBody = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const text = yield* request.text;
  try {
    return text ? (JSON.parse(text) as unknown) : {};
  } catch {
    return {};
  }
});

const getConversationSearchReindexEstimateRoute = HttpRouter.add(
  'GET',
  '/api/settings/conversation-search/reindex-estimate',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return yield* Effect.try({
      try: async () => {
        // Optional ?model= lets the UI price a *prospective* model switch before saving it.
        const modelOverride = new URL(request.url, 'http://localhost').searchParams.get('model')?.trim();
        const baseConfig = getConversationSearchConfig();
        const config = modelOverride ? { ...baseConfig, model: modelOverride } : baseConfig;
        const estimate = await estimateFullReindexConversationSearchCost({ config });
        const confirmationNonce = estimate.estimatedUsd > REINDEX_CONFIRM_THRESHOLD_USD
          ? createReindexConfirmationNonce(estimate.estimatedUsd)
          : undefined;
        return jsonResponse({ ...estimate, confirmationNonce });
      },
      catch: (err) => {
        const message = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
        console.error(`[conversation-search] reindex estimate failed: ${message}`);
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      },
    });
  })),
);

const postConversationSearchReindexRoute = HttpRouter.add(
  'POST',
  '/api/settings/conversation-search/reindex',
  httpHandler(Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnsafeDashboardMutationRequest(request);
    if (authError) return authError;
    const body = yield* readJsonBody;

    return yield* Effect.promise(async () => {
      if (activeConversationSearchReindex) {
        return jsonResponse({ error: 'Conversation search reindex already in progress' }, { status: 409 });
      }

      const job = (async () => {
        const estimate = await estimateFullReindexConversationSearchCost();
        if (estimate.disabled) return jsonResponse(estimate);
        if (estimate.estimatedUsd > REINDEX_CONFIRM_THRESHOLD_USD) {
          const nonce = (body as { confirmationNonce?: unknown }).confirmationNonce;
          if (!consumeReindexConfirmationNonce(nonce, estimate.estimatedUsd)) {
            return jsonResponse({
              error: 'Reindex confirmation required',
              requiresConfirmation: true,
              estimate,
            }, { status: 409 });
          }
        }

        await stopConversationSearchWatcher();
        const batch = conversationSearchActivity.beginBatch('full-reindex');
        try {
          const result = await fullReindexConversationSearch({ onProgress: (p) => batch.progress(p) });
          // PAN-3771: feed reindex outcomes into the banner health state.
          const firstError = result.errors[0];
          if (firstError) {
            recordConversationSearchFailure(firstError.message);
            batch.recordError(firstError.message);
          } else if (!result.disabled) {
            recordConversationSearchSuccess();
          }
          return jsonResponse(result);
        } catch (error) {
          batch.recordError(error);
          recordConversationSearchFailure(error);
          throw error;
        } finally {
          batch.end();
          await syncConversationSearchWatcher();
        }
      })();
      activeConversationSearchReindex = job;
      try {
        return await job;
      } finally {
        if (activeConversationSearchReindex === job) activeConversationSearchReindex = null;
      }
    });
  })),
);

// Read-only progress for the live reindex bar. Public (same rationale as the status route).
const getConversationSearchReindexProgressRoute = HttpRouter.add(
  'GET',
  '/api/settings/conversation-search/reindex-progress',
  httpHandler(Effect.gen(function* () {
    return jsonResponse(toLegacyReindexProgress(conversationSearchActivity.getSnapshot()));
  })),
);

export const conversationSearchReindexRouteLayer = Layer.mergeAll(
  getConversationSearchReindexEstimateRoute,
  postConversationSearchReindexRoute,
  getConversationSearchReindexProgressRoute,
);
