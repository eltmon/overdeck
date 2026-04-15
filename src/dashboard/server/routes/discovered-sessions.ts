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
  getDiscoveredSessionById,
  getDiscoveredStats,
} from '../../../lib/database/discovered-sessions-db.js';
import { scan } from '../../../lib/conversations/scanner.js';
import { searchSessions } from '../../../lib/conversations/search.js';
import { enrichSessions, CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import { embedSessions } from '../../../lib/conversations/embeddings/index.js';
import { parseRelativeTime } from '../../../lib/conversations/search.js';

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

    const filter: Parameters<typeof findDiscoveredSessions>[0] = {
      limit: parseInt(params.get('limit') ?? '50', 10),
      offset: parseInt(params.get('offset') ?? '0', 10),
    };

    if (params.has('workspace')) filter.workspacePath = params.get('workspace')!;
    if (params.has('model')) filter.primaryModel = params.get('model')!;
    if (params.has('since')) filter.since = parseRelativeTime(params.get('since')!);
    if (params.has('managed')) filter.managed = params.get('managed') === 'true';
    if (params.has('enriched')) filter.enriched = true;
    if (params.has('not_enriched')) filter.notEnriched = true;

    const sessions = findDiscoveredSessions(filter);
    return jsonResponse({ sessions, count: sessions.length });
  })),
);

// ─── GET /api/discovered-sessions/search ─────────────────────────────────────

const searchRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/search',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const q = params.get('q') ?? undefined;
    const similarTo = params.has('similar_to') ? parseInt(params.get('similar_to')!, 10) : undefined;
    const limit = parseInt(params.get('limit') ?? '20', 10);

    const filter: Parameters<typeof searchSessions>[0]['filter'] = {};
    if (params.has('workspace')) filter!.workspacePath = params.get('workspace')!;
    if (params.has('since')) filter!.since = params.get('since')!;

    const result = searchSessions({ q, similarTo, filter, limit });
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
    };

    const mode = (body.mode ?? 'system') as 'system' | 'watched' | 'targeted';
    const result = yield* Effect.promise(() =>
      scan({
        mode,
        watchDirs: [],
        dryRun: body.dryRun,
        maxParallel: body.maxParallel,
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

    const tier = (body.tier ?? 1) as 1 | 2 | 3;

    try {
      const result = yield* Effect.promise(() =>
        enrichSessions({
          tier,
          sessionIds: body.sessionIds,
          maxParallel: body.maxParallel,
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

    const result = yield* Effect.promise(() =>
      embedSessions({
        sessionIds: body.sessionIds,
        provider: body.provider as 'openai' | 'voyage' | 'ollama' | undefined,
        model: body.model,
        maxParallel: body.maxParallel,
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
  postScanRoute,
  postEnrichRoute,
  postEmbedRoute,
);
