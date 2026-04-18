/**
 * Discovered Sessions route module — Effect HttpRouter.Layer (PAN-457)
 *
 * Endpoints for the conversation discovery/indexing feature:
 *
 *   POST /api/discovered-sessions/scan       — trigger a scan
 *   GET  /api/discovered-sessions            — list with filters
 *   GET  /api/discovered-sessions/:id        — get single session
 *   GET  /api/discovered-sessions/search     — FTS + filter search
 *   GET  /api/discovered-sessions/cost       — cost summary
 *   POST /api/discovered-sessions/:id/enrich — enrich single session
 *   POST /api/discovered-sessions/enrich     — bulk enrich
 *   POST /api/discovered-sessions/embed      — bulk embed
 *   GET  /api/discovered-sessions/stats      — discovery stats
 *
 * Zero sync FS calls — all lib functions use fs/promises or better-sqlite3 (sync only in CLI context).
 */

import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';

import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import {
  findDiscoveredSessions,
  countDiscoveredSessions,
  getDiscoveredSessionById,
  getDiscoveredStats,
} from '../../../lib/database/discovered-sessions-db.js';
import { scan } from '../../../lib/conversations/scanner.js';
import { searchSessions } from '../../../lib/conversations/search.js';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import { parseRelativeTime } from '../../../lib/conversations/search.js';
import { getConversationsConfig } from '../../../lib/config.js';

// ─── GET /api/discovered-sessions/stats ───────────────────────────────────────

const getStatsRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/stats',
  httpHandler(Effect.try({
    try: () => jsonResponse(getDiscoveredStats()),
  })),
);

// ─── GET /api/discovered-sessions ────────────────────────────────────────────

const listRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const rawLimit = parseInt(params.get('limit') ?? '50', 10);
    const rawOffset = parseInt(params.get('offset') ?? '0', 10);
    if (!Number.isFinite(rawLimit) || rawLimit < 0) {
      return jsonResponse({ error: 'Invalid limit' }, { status: 400 });
    }
    if (!Number.isFinite(rawOffset) || rawOffset < 0) {
      return jsonResponse({ error: 'Invalid offset' }, { status: 400 });
    }

    const filter: Parameters<typeof findDiscoveredSessions>[0] = {
      limit: Math.min(rawLimit, 500),
      offset: rawOffset,
    };

    if (params.has('workspace')) filter.workspacePath = params.get('workspace')!;
    if (params.has('model')) filter.primaryModel = params.get('model')!;
    if (params.has('since')) filter.since = parseRelativeTime(params.get('since')!);
    if (params.has('managed')) filter.managed = params.get('managed') === 'true';
    if (params.has('enriched')) filter.enriched = true;
    if (params.has('not_enriched')) filter.notEnriched = true;

    const sessions = findDiscoveredSessions(filter);
    const total = countDiscoveredSessions({ ...filter, limit: undefined, offset: undefined });
    return jsonResponse({ sessions, count: sessions.length, total });
  })),
);

// ─── Shared filter parser ─────────────────────────────────────────────────────

/**
 * Parse all ConversationFilter fields from URLSearchParams.
 * Exported for unit testing.
 */
export function parseSearchParams(
  params: URLSearchParams,
): Parameters<typeof findDiscoveredSessions>[0] {
  const filter: Parameters<typeof findDiscoveredSessions>[0] = {};
  if (params.has('workspace')) filter.workspacePath = params.get('workspace')!;
  if (params.has('model')) filter.primaryModel = params.get('model')!;
  if (params.has('since')) filter.since = parseRelativeTime(params.get('since')!);
  if (params.has('before')) filter.before = parseRelativeTime(params.get('before')!);
  if (params.has('after')) filter.after = parseRelativeTime(params.get('after')!);
  if (params.has('managed')) filter.managed = params.get('managed') === 'true';
  if (params.has('unmanaged')) filter.unmanaged = params.get('unmanaged') === 'true';
  if (params.has('enriched')) filter.enriched = true;
  if (params.has('not_enriched')) filter.notEnriched = true;
  if (params.has('issue_id')) filter.issueId = params.get('issue_id')!;
  if (params.has('tags')) {
    const raw = params.get('tags')!;
    filter.tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (params.has('tools')) {
    const raw = params.get('tools')!;
    filter.tools = raw.split(',').map((t) => t.trim()).filter(Boolean);
  }
  if (params.has('min_cost')) {
    const v = parseFloat(params.get('min_cost')!);
    if (Number.isFinite(v)) filter.minCost = v;
  }
  if (params.has('max_cost')) {
    const v = parseFloat(params.get('max_cost')!);
    if (Number.isFinite(v)) filter.maxCost = v;
  }
  if (params.has('min_messages')) {
    const v = parseInt(params.get('min_messages')!, 10);
    if (Number.isFinite(v) && v >= 0) filter.minMessages = v;
  }
  return filter;
}

// ─── GET /api/discovered-sessions/search ─────────────────────────────────────

const searchRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/search',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const q = params.get('q') ?? undefined;
    const rawSimilarTo = params.has('similar_to') ? parseInt(params.get('similar_to')!, 10) : undefined;
    const similarTo = rawSimilarTo !== undefined && Number.isFinite(rawSimilarTo) ? rawSimilarTo : undefined;
    const rawLimit = parseInt(params.get('limit') ?? '20', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 20;
    const rawOffset = parseInt(params.get('offset') ?? '0', 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const filter = parseSearchParams(params);
    const result = searchSessions({ q, similarTo, filter, limit, offset });
    return jsonResponse(result);
  })),
);

// ─── GET /api/discovered-sessions/cost ───────────────────────────────────────

const getCostRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/cost',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const filter: Parameters<typeof findDiscoveredSessions>[0] = {};
    if (params.has('since')) filter.since = parseRelativeTime(params.get('since')!);
    if (params.has('workspace')) filter.workspacePath = params.get('workspace')!;

    const sessions = findDiscoveredSessions(filter);
    const total = sessions.reduce((sum, s) => sum + s.estimatedCost, 0);
    const totalTokensIn = sessions.reduce((sum, s) => sum + s.tokenInput, 0);
    const totalTokensOut = sessions.reduce((sum, s) => sum + s.tokenOutput, 0);

    return jsonResponse({
      sessionCount: sessions.length,
      totalCost: total,
      totalTokensIn,
      totalTokensOut,
    });
  })),
);

// ─── GET /api/discovered-sessions/:id ────────────────────────────────────────

const getByIdRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/:id',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const params = req.params as { id?: string };
    const id = parseInt(params.id ?? '', 10);

    if (isNaN(id)) {
      return jsonResponse({ error: 'Invalid session ID' }, { status: 400 });
    }

    const session = getDiscoveredSessionById(id);
    if (!session) {
      return jsonResponse({ error: `Session ${id} not found` }, { status: 404 });
    }

    return jsonResponse(session);
  })),
);

// ─── POST /api/discovered-sessions/:id/enrich ────────────────────────────────

const postEnrichByIdRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/:id/enrich',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const params = req.params as { id?: string };
    const id = parseInt(params.id ?? '', 10);

    if (isNaN(id)) {
      return jsonResponse({ error: 'Invalid session ID' }, { status: 400 });
    }

    const session = getDiscoveredSessionById(id);
    if (!session) {
      return jsonResponse({ error: `Session ${id} not found` }, { status: 404 });
    }

    const body = (yield* req.json) as { tier?: number };
    const rawTier = body.tier ?? 1;
    if (rawTier !== 1 && rawTier !== 2 && rawTier !== 3) {
      return jsonResponse({ error: 'Invalid tier: must be 1, 2, or 3' }, { status: 400 });
    }
    const tier = rawTier as 1 | 2 | 3;

    try {
      const result = yield* Effect.promise(() =>
        enrichSessions({ tier, sessionIds: [id] }),
      );
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof CostThresholdError) {
        return jsonResponse(
          {
            error: 'Cost threshold exceeded',
            estimatedCost: err.estimatedCost,
            threshold: err.threshold,
            sessionCount: err.sessionCount,
          },
          { status: 402 },
        );
      }
      throw err;
    }
  })),
);

// ─── POST /api/discovered-sessions/scan ──────────────────────────────────────

const postScanRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/scan',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const body = (yield* req.json) as {
      mode?: string;
      dryRun?: boolean;
      maxParallel?: number;
      dirs?: string[];
    };

    const VALID_MODES = new Set(['system', 'watched', 'targeted']);
    const rawMode = body.mode ?? 'system';
    if (!VALID_MODES.has(rawMode)) {
      return jsonResponse({ error: `Invalid mode: must be one of system, watched, targeted` }, { status: 400 });
    }
    const mode = rawMode as 'system' | 'watched' | 'targeted';

    if (mode === 'targeted' && (!Array.isArray(body.dirs) || body.dirs.length === 0)) {
      return jsonResponse({ error: 'targeted mode requires a non-empty dirs array' }, { status: 400 });
    }

    const maxParallel = body.maxParallel !== undefined ? Math.min(Math.max(1, body.maxParallel), 16) : undefined;

    const watchDirs = getConversationsConfig().watchDirs;
    const result = yield* Effect.promise(() =>
      scan({
        mode,
        watchDirs,
        dirs: body.dirs,
        dryRun: body.dryRun,
        maxParallel,
      }),
    );

    return jsonResponse(result);
  })),
);

// ─── POST /api/discovered-sessions/enrich ────────────────────────────────────

const postEnrichRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/enrich',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const body = (yield* req.json) as {
      tier?: number;
      sessionIds?: number[];
      maxParallel?: number;
    };

    const rawTier = body.tier ?? 1;
    if (rawTier !== 1 && rawTier !== 2 && rawTier !== 3) {
      return jsonResponse({ error: 'Invalid tier: must be 1, 2, or 3' }, { status: 400 });
    }
    const tier = rawTier as 1 | 2 | 3;
    const enrichMaxParallel = body.maxParallel !== undefined ? Math.min(Math.max(1, body.maxParallel), 16) : undefined;
    const enrichSessionIds = body.sessionIds ? body.sessionIds.slice(0, 500) : undefined;

    try {
      const result = yield* Effect.promise(() =>
        enrichSessions({
          tier,
          sessionIds: enrichSessionIds,
          maxParallel: enrichMaxParallel,
        }),
      );
      return jsonResponse(result);
    } catch (err) {
      if (err instanceof CostThresholdError) {
        return jsonResponse(
          {
            error: 'Cost threshold exceeded',
            estimatedCost: err.estimatedCost,
            threshold: err.threshold,
            sessionCount: err.sessionCount,
          },
          { status: 402 },
        );
      }
      throw err;
    }
  })),
);

// ─── POST /api/discovered-sessions/embed ─────────────────────────────────────

const postEmbedRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/embed',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const body = (yield* req.json) as {
      sessionIds?: number[];
      provider?: string;
      model?: string;
      maxParallel?: number;
    };

    const VALID_PROVIDERS = new Set(['openai', 'voyage', 'ollama']);
    if (body.provider !== undefined && !VALID_PROVIDERS.has(body.provider)) {
      return jsonResponse({ error: `Invalid provider: must be one of openai, voyage, ollama` }, { status: 400 });
    }
    const embedMaxParallel = body.maxParallel !== undefined ? Math.min(Math.max(1, body.maxParallel), 16) : undefined;
    const embedSessionIds = body.sessionIds ? body.sessionIds.slice(0, 500) : undefined;

    const result = yield* Effect.promise(() =>
      embedSessions({
        sessionIds: embedSessionIds,
        provider: body.provider as 'openai' | 'voyage' | 'ollama' | undefined,
        model: body.model,
        maxParallel: embedMaxParallel,
      }),
    );

    return jsonResponse(result);
  })),
);

// ─── Layer composition ────────────────────────────────────────────────────────

export const discoveredSessionsRouteLayer = Layer.mergeAll(
  getStatsRoute,
  listRoute,
  searchRoute,
  getCostRoute,
  getByIdRoute,
  postEnrichByIdRoute,
  postScanRoute,
  postEnrichRoute,
  postEmbedRoute,
);
