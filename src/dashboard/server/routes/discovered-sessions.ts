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

import { Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';

import { EventStoreService } from '../services/domain-services.js';
import { jsonResponse } from '../http-helpers.js';
import { httpHandler } from './http-handler.js';
import type {
  ScanStartedEvent,
  ScanProgressEvent,
  ScanCompleteEvent,
  EnrichProgressEvent,
  EnrichCompleteEvent,
  EmbedProgressEvent,
} from '@panctl/contracts';
import type { ConversationFilter, DiscoveredSession } from '../../../lib/database/discovered-sessions-db.js';
import type { SearchResult } from '../../../lib/conversations/search.js';
import { CostThresholdError } from '../../../lib/conversations/enrichment/index.js';
import { parseRelativeTime } from '../../../lib/conversations/search.js';
import { getConversationsConfig, updateConversationsConfig } from '../../../lib/config-yaml.js';
import { embed } from '../../../lib/conversations/embeddings/providers.js';
import { validateOrigin } from './origin-validation.js';
import { rejectUnauthorizedDashboardRequest } from './dashboard-auth.js';
import { runDashboardDbJob } from '../services/dashboard-db-task.js';

function getRequestHeader(
  request: HttpServerRequest.HttpServerRequest,
  name: string,
): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function rejectUntrustedOrigin(
  request: HttpServerRequest.HttpServerRequest,
  options: { requireOriginHeader?: boolean } = {},
): HttpServerResponse.HttpServerResponse | null {
  if (options.requireOriginHeader && !getRequestHeader(request, 'origin') && !getRequestHeader(request, 'referer')) {
    return jsonResponse({ error: 'Missing origin' }, { status: 403 });
  }

  const originCheck = validateOrigin(request);
  if (!originCheck.ok) {
    return jsonResponse({ error: originCheck.error }, { status: 403 });
  }
  return null;
}

const EnrichByIdBodySchema = Schema.Struct({
  tier: Schema.optional(Schema.Number),
  confirmed: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
});

const ScanBodySchema = Schema.Struct({
  mode: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
  maxParallel: Schema.optional(Schema.Number),
  dirs: Schema.optional(Schema.Array(Schema.String)),
});

const EnrichBodySchema = Schema.Struct({
  tier: Schema.optional(Schema.Number),
  sessionIds: Schema.optional(Schema.Array(Schema.Number)),
  maxParallel: Schema.optional(Schema.Number),
  confirmed: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
});

const EmbedBodySchema = Schema.Struct({
  sessionIds: Schema.optional(Schema.Array(Schema.Number)),
  provider: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  maxParallel: Schema.optional(Schema.Number),
});

const ConversationsConfigBodySchema = Schema.Struct({
  embeddings: Schema.optional(Schema.Boolean),
  embeddingProvider: Schema.optional(Schema.String),
  embeddingModel: Schema.optional(Schema.String),
  embeddingAutoOnDeep: Schema.optional(Schema.Boolean),
});

const TestConnectionBodySchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  apiKey: Schema.optional(Schema.String),
  ollamaBaseUrl: Schema.optional(Schema.String),
});

const StatsResponseSchema = Schema.Struct({
  total: Schema.Number,
  enriched: Schema.Number,
  embedded: Schema.Number,
  managedCount: Schema.Number,
  embeddingModels: Schema.optional(Schema.Array(Schema.Struct({ model: Schema.String, embedded: Schema.Number }))),
});
const DiscoveredSessionResponseSchema = Schema.Struct({
  id: Schema.Number,
  jsonlPath: Schema.String,
  sessionId: Schema.NullOr(Schema.String),
  workspacePath: Schema.NullOr(Schema.String),
  workspaceHash: Schema.NullOr(Schema.String),
  messageCount: Schema.Number,
  firstTs: Schema.NullOr(Schema.String),
  lastTs: Schema.NullOr(Schema.String),
  modelsUsed: Schema.Array(Schema.String),
  primaryModel: Schema.NullOr(Schema.String),
  tokenInput: Schema.Number,
  tokenOutput: Schema.Number,
  estimatedCost: Schema.Number,
  toolsUsed: Schema.Array(Schema.String),
  filesTouched: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  summary: Schema.NullOr(Schema.String),
  summaryDetailed: Schema.NullOr(Schema.String),
  enrichmentLevel: Schema.Number,
  enrichmentModel: Schema.NullOr(Schema.String),
  enrichedAt: Schema.NullOr(Schema.String),
  enrichmentFailed: Schema.Boolean,
  panopticonManaged: Schema.Boolean,
  panIssueId: Schema.NullOr(Schema.String),
  panAgentId: Schema.NullOr(Schema.String),
  fileSize: Schema.NullOr(Schema.Number),
  fileMtime: Schema.NullOr(Schema.String),
  scannedAt: Schema.String,
});
const ListResponseSchema = Schema.Struct({ sessions: Schema.Array(DiscoveredSessionResponseSchema), count: Schema.Number, total: Schema.Number });
const SearchResponseSchema = Schema.Struct({
  sessions: Schema.Array(DiscoveredSessionResponseSchema),
  total: Schema.Number,
  mode: Schema.String,
  durationMs: Schema.Number,
  error: Schema.optional(Schema.String),
});
const CostResponseSchema = Schema.Struct({
  sessionCount: Schema.Number,
  totalCost: Schema.Number,
  totalTokensIn: Schema.Number,
  totalTokensOut: Schema.Number,
});
const ScanResponseSchema = Schema.Struct({ inserted: Schema.Number, updated: Schema.Number, skipped: Schema.Number, errors: Schema.Number, durationMs: Schema.Number });
const EnrichResponseSchema = Schema.Struct({
  enriched: Schema.Number,
  errors: Schema.Number,
  estimatedCost: Schema.Number,
  actualCost: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
});
const EmbedResponseSchema = Schema.Struct({ embedded: Schema.Number, skipped: Schema.Number, errors: Schema.Number });
const ConfigResponseSchema = Schema.Struct({
  embeddings: Schema.Boolean,
  embeddingProvider: Schema.String,
  embeddingModel: Schema.String,
  embeddingAutoOnDeep: Schema.Boolean,
});
const OkResponseSchema = Schema.Struct({ ok: Schema.Boolean });
const TestConnectionResponseSchema = Schema.Struct({ ok: Schema.Boolean, latencyMs: Schema.optional(Schema.Number), error: Schema.optional(Schema.String) });

function validatedJsonResponse<A>(schema: Schema.Codec<A>, data: unknown): ReturnType<typeof jsonResponse> {
  Schema.decodeUnknownSync(schema)(data);
  return jsonResponse(data);
}

function parseRequestBody<A>(schema: Schema.Codec<A>, raw: unknown): { ok: true; body: A } | { ok: false; response: HttpServerResponse.HttpServerResponse } {
  try {
    return { ok: true, body: Schema.decodeUnknownSync(schema)(raw) as A };
  } catch (err) {
    return {
      ok: false,
      response: jsonResponse({ error: 'Invalid request body', details: err instanceof Error ? err.message : String(err) }, { status: 400 }),
    };
  }
}

// ─── GET /api/discovered-sessions/stats ───────────────────────────────────────

const getStatsRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/stats',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    return validatedJsonResponse(StatsResponseSchema, yield* Effect.promise(() => runDashboardDbJob('getDiscoveredStats')));
  })),
);

// ─── GET /api/discovered-sessions ────────────────────────────────────────────

const listRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const rawLimit = parseInt(params.get('limit') ?? '50', 10);
    const rawOffset = parseInt(params.get('offset') ?? '0', 10);
    if (!Number.isFinite(rawLimit) || rawLimit < 0) {
      return jsonResponse({ error: 'Invalid limit' }, { status: 400 });
    }
    if (!Number.isFinite(rawOffset) || rawOffset < 0) {
      return jsonResponse({ error: 'Invalid offset' }, { status: 400 });
    }

    const filter: ConversationFilter = {
      limit: Math.min(rawLimit, 500),
      offset: rawOffset,
    };

    if (params.has('workspace')) filter.workspacePath = params.get('workspace')!;
    if (params.has('model')) filter.primaryModel = params.get('model')!;
    if (params.has('since')) filter.since = parseRelativeTime(params.get('since')!);
    if (params.has('managed')) filter.managed = params.get('managed') === 'true';
    if (params.has('enriched')) filter.enriched = true;
    if (params.has('not_enriched')) filter.notEnriched = true;
    if (params.has('enrichment_level')) {
      const v = parseInt(params.get('enrichment_level')!, 10);
      if (Number.isFinite(v) && v >= 0) filter.enrichmentLevel = v;
    }
    if (params.has('min_cost')) filter.minCost = parseFloat(params.get('min_cost')!);
    if (params.has('max_cost')) filter.maxCost = parseFloat(params.get('max_cost')!);

    const { sessions, total } = yield* Effect.promise(() =>
      runDashboardDbJob<{ sessions: DiscoveredSession[]; total: number }>('listDiscoveredSessions', filter),
    );
    return validatedJsonResponse(ListResponseSchema, { sessions, count: sessions.length, total });
  })),
);

// ─── Shared filter parser ─────────────────────────────────────────────────────

/**
 * Parse all ConversationFilter fields from URLSearchParams.
 * Exported for unit testing.
 */
export function parseSearchParams(
  params: URLSearchParams,
): ConversationFilter {
  const filter: ConversationFilter = {};
  if (params.has('workspace')) filter.workspacePath = params.get('workspace')!;
  if (params.has('model')) filter.primaryModel = params.get('model')!;
  if (params.has('since')) filter.since = parseRelativeTime(params.get('since')!);
  if (params.has('before')) filter.before = parseRelativeTime(params.get('before')!);
  if (params.has('after')) filter.after = parseRelativeTime(params.get('after')!);
  if (params.has('managed')) filter.managed = params.get('managed') === 'true';
  if (params.has('unmanaged')) filter.unmanaged = params.get('unmanaged') === 'true';
  if (params.has('enriched')) filter.enriched = true;
  if (params.has('not_enriched')) filter.notEnriched = true;
  if (params.has('enrichment_level')) {
    const v = parseInt(params.get('enrichment_level')!, 10);
    if (Number.isFinite(v) && v >= 0) filter.enrichmentLevel = v;
  }
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
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const q = params.get('q') ?? undefined;
    const semantic = params.get('semantic') === 'true';
    if (semantic) {
      const originError = rejectUntrustedOrigin(req, { requireOriginHeader: true });
      if (originError) return originError;
    }
    const rawSimilarTo = params.has('similar_to') ? parseInt(params.get('similar_to')!, 10) : undefined;
    const similarTo = rawSimilarTo !== undefined && Number.isFinite(rawSimilarTo) ? rawSimilarTo : undefined;
    const rawLimit = parseInt(params.get('limit') ?? '20', 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 20;
    const rawOffset = parseInt(params.get('offset') ?? '0', 10);
    const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const filter = parseSearchParams(params);
    const config = yield* getConversationsConfig();
    return yield* Effect.promise(async () => {
      try {
        const operation = semantic ? 'searchSessionsSemantic' : 'searchSessions';
        const result = await runDashboardDbJob<SearchResult>(operation, {
          q: semantic ? undefined : q,
          semanticQuery: semantic ? q : undefined,
          similarTo,
          filter,
          limit,
          offset,
          config,
        });
        return validatedJsonResponse(SearchResponseSchema, result);
      } catch (err) {
        if (semantic) {
          return validatedJsonResponse(SearchResponseSchema, {
            sessions: [],
            total: 0,
            mode: 'semantic',
            durationMs: 0,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    });
  })),
);

// ─── GET /api/discovered-sessions/cost ───────────────────────────────────────

const getCostRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/cost',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const params = new URL(req.url, 'http://localhost').searchParams;

    const filter = parseSearchParams(params);

    return validatedJsonResponse(CostResponseSchema, yield* Effect.promise(() => runDashboardDbJob('aggregateDiscoveredSessionCost', filter)));
  })),
);

// ─── GET /api/discovered-sessions/:id ────────────────────────────────────────

const getByIdRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/:id',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const params = yield* HttpRouter.params;
    const id = parseInt(params.id ?? '', 10);

    if (isNaN(id)) {
      return jsonResponse({ error: 'Invalid session ID' }, { status: 400 });
    }

    const session = yield* Effect.promise(() => runDashboardDbJob('getDiscoveredSessionById', id));
    if (!session) {
      return jsonResponse({ error: `Session ${id} not found` }, { status: 404 });
    }

    return validatedJsonResponse(DiscoveredSessionResponseSchema, session);
  })),
);

// ─── POST /api/discovered-sessions/:id/enrich ────────────────────────────────

const postEnrichByIdRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/:id/enrich',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const params = yield* HttpRouter.params;
    const id = parseInt(params.id ?? '', 10);

    if (isNaN(id)) {
      return jsonResponse({ error: 'Invalid session ID' }, { status: 400 });
    }

    const session = yield* Effect.promise(() => runDashboardDbJob('getDiscoveredSessionById', id));
    if (!session) {
      return jsonResponse({ error: `Session ${id} not found` }, { status: 404 });
    }

    const parsedBody = parseRequestBody(EnrichByIdBodySchema, yield* req.json);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;
    const rawTier = body.tier ?? 1;
    if (rawTier !== 1 && rawTier !== 2 && rawTier !== 3) {
      return jsonResponse({ error: 'Invalid tier: must be 1, 2, or 3' }, { status: 400 });
    }
    const tier = rawTier as 1 | 2 | 3;

    try {
      const config = yield* getConversationsConfig();
      const eventStore = yield* EventStoreService;
      const result = yield* Effect.promise(() =>
        runDashboardDbJob<{ enriched: number; errors: number; estimatedCost: number; actualCost: number | null; durationMs: number }>('enrichSessions', {
          tier,
          sessionIds: [id],
          config,
          force: body.confirmed === true || body.force === true,
        }, async (rawProgress) => {
          const progress = rawProgress as {
            session?: { sessionId: number; tier: number; model: string; cost?: number; success: boolean; error?: string };
          };
          if (!progress.session) return;
          const { session: progressSession } = progress;
          const progressEvent: Omit<EnrichProgressEvent, 'sequence'> = {
            type: 'enrich.progress',
            timestamp: new Date().toISOString(),
            payload: {
              sessionId: progressSession.sessionId,
              level: progressSession.tier,
              model: progressSession.model,
              cost: progressSession.cost ?? 0,
              success: progressSession.success,
              error: progressSession.error,
            },
          };
          await Effect.runPromise(eventStore.appendAsync(progressEvent as EnrichProgressEvent));
        }),
      );
      return validatedJsonResponse(EnrichResponseSchema, result);
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
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const parsedBody = parseRequestBody(ScanBodySchema, yield* req.json);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

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

    const config = yield* getConversationsConfig();
    const watchDirs = config.watchDirs;
    const eventStore = yield* EventStoreService;
    let lastProgressEmit = 0;

    // Emit ScanStartedEvent
    const startedEvent: Omit<ScanStartedEvent, 'sequence'> = {
      type: 'scan.started',
      timestamp: new Date().toISOString(),
      payload: { mode, dirs: body.dirs ?? [] },
    };
    yield* Effect.promise(() => Effect.runPromise(eventStore.appendAsync(startedEvent as ScanStartedEvent)));

    const result = yield* Effect.promise(() =>
      runDashboardDbJob<{ inserted: number; updated: number; skipped: number; errors: number; durationMs: number }>('scanConversations', {
        mode,
        watchDirs,
        dirs: body.dirs,
        dryRun: body.dryRun,
        maxParallel,
      }, async (rawProgress) => {
        const progress = rawProgress as {
          dirsProcessed: number;
          dirsTotal: number;
          sessionsFound: number;
          elapsedMs: number;
        };
        const now = Date.now();
        const complete = progress.dirsProcessed >= progress.dirsTotal;
        if (!complete && now - lastProgressEmit < 500) return;
        lastProgressEmit = now;
        const progressEvent: Omit<ScanProgressEvent, 'sequence'> = {
          type: 'scan.progress',
          timestamp: new Date().toISOString(),
          payload: {
            dirsProcessed: progress.dirsProcessed,
            dirsTotal: progress.dirsTotal,
            sessionsFound: progress.sessionsFound,
            elapsedMs: progress.elapsedMs,
          },
        };
        await Effect.runPromise(eventStore.appendAsync(progressEvent as ScanProgressEvent));
      }),
    );

    // Emit ScanCompleteEvent
    const completeEvent: Omit<ScanCompleteEvent, 'sequence'> = {
      type: 'scan.complete',
      timestamp: new Date().toISOString(),
      payload: {
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        durationMs: result.durationMs,
      },
    };
    yield* Effect.promise(() => Effect.runPromise(eventStore.appendAsync(completeEvent as ScanCompleteEvent)));

    return validatedJsonResponse(ScanResponseSchema, result);
  })),
);

// ─── POST /api/discovered-sessions/enrich ────────────────────────────────────

const postEnrichRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/enrich',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const parsedBody = parseRequestBody(EnrichBodySchema, yield* req.json);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const rawTier = body.tier ?? 1;
    if (rawTier !== 1 && rawTier !== 2 && rawTier !== 3) {
      return jsonResponse({ error: 'Invalid tier: must be 1, 2, or 3' }, { status: 400 });
    }
    const tier = rawTier as 1 | 2 | 3;
    const config = yield* getConversationsConfig();
    const enrichMaxParallel = body.maxParallel !== undefined ? Math.min(Math.max(1, body.maxParallel), 16) : config.enrichment.maxParallel;
    const enrichSessionIds = body.sessionIds ? body.sessionIds.slice(0, 500) : undefined;
    const eventStore = yield* EventStoreService;

    try {
      const result = yield* Effect.promise(() =>
        runDashboardDbJob<{ enriched: number; errors: number; estimatedCost: number; actualCost: number | null; durationMs: number }>('enrichSessions', {
          tier,
          sessionIds: enrichSessionIds,
          maxParallel: enrichMaxParallel,
          config,
          force: body.confirmed === true || body.force === true,
        }, async (rawProgress) => {
          const progress = rawProgress as {
            session?: { sessionId: number; tier: number; model: string; cost?: number; success: boolean; error?: string };
          };
          if (!progress.session) return;
          const { session } = progress;
          const progressEvent: Omit<EnrichProgressEvent, 'sequence'> = {
            type: 'enrich.progress',
            timestamp: new Date().toISOString(),
            payload: {
              sessionId: session.sessionId,
              level: session.tier,
              model: session.model,
              cost: session.cost ?? 0,
              success: session.success,
              error: session.error,
            },
          };
          await Effect.runPromise(eventStore.appendAsync(progressEvent as EnrichProgressEvent));
        }),
      );

      // Emit EnrichCompleteEvent
      const completeEvent: Omit<EnrichCompleteEvent, 'sequence'> = {
        type: 'enrich.complete',
        timestamp: new Date().toISOString(),
        payload: {
          processed: result.enriched + result.errors,
          totalCost: result.actualCost ?? result.estimatedCost,
          failures: result.errors,
          durationMs: result.durationMs,
        },
      };
      yield* Effect.promise(() => Effect.runPromise(eventStore.appendAsync(completeEvent as EnrichCompleteEvent)));

      return validatedJsonResponse(EnrichResponseSchema, result);
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
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const parsedBody = parseRequestBody(EmbedBodySchema, yield* req.json);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const VALID_PROVIDERS = new Set(['openai', 'voyage', 'ollama']);
    if (body.provider !== undefined && !VALID_PROVIDERS.has(body.provider)) {
      return jsonResponse({ error: `Invalid provider: must be one of openai, voyage, ollama` }, { status: 400 });
    }
    const config = yield* getConversationsConfig();
    const embedMaxParallel = body.maxParallel !== undefined ? Math.min(Math.max(1, body.maxParallel), 16) : config.enrichment.maxParallel;
    const embedSessionIds = body.sessionIds ? body.sessionIds.slice(0, 500) : undefined;
    const eventStore = yield* EventStoreService;

    const result = yield* Effect.promise(() =>
      runDashboardDbJob('embedSessions', {
        sessionIds: embedSessionIds,
        provider: body.provider as 'openai' | 'voyage' | 'ollama' | undefined,
        model: body.model,
        maxParallel: embedMaxParallel,
        config,
      }, async (rawProgress) => {
        const progress = rawProgress as {
          session?: { sessionId: number; model: string; success: boolean; error?: string };
        };
        if (!progress.session) return;
        const progressEvent: Omit<EmbedProgressEvent, 'sequence'> = {
          type: 'embed.progress',
          timestamp: new Date().toISOString(),
          payload: progress.session,
        };
        await Effect.runPromise(eventStore.appendAsync(progressEvent as EmbedProgressEvent));
      }),
    );

    return validatedJsonResponse(EmbedResponseSchema, result);
  })),
);

// ─── GET /api/discovered-sessions/config ─────────────────────────────────────

const getConvConfigRoute = HttpRouter.add(
  'GET',
  '/api/discovered-sessions/config',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const config = yield* getConversationsConfig();
    return validatedJsonResponse(ConfigResponseSchema, {
      embeddings: config.embeddings,
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      embeddingAutoOnDeep: config.embeddingAutoOnDeep,
    });
  })),
);

// ─── PUT /api/discovered-sessions/config ─────────────────────────────────────

const putConvConfigRoute = HttpRouter.add(
  'PUT',
  '/api/discovered-sessions/config',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const parsedBody = parseRequestBody(ConversationsConfigBodySchema, yield* req.json);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    yield* updateConversationsConfig({
      embeddings: body.embeddings,
      embedding_provider: body.embeddingProvider as 'openai' | 'voyage' | 'ollama' | undefined,
      embedding_model: body.embeddingModel,
      embedding_auto_on_deep: body.embeddingAutoOnDeep,
    });

    return validatedJsonResponse(OkResponseSchema, { ok: true });
  })),
);

// ─── POST /api/discovered-sessions/test-connection ───────────────────────────

const postTestConnectionRoute = HttpRouter.add(
  'POST',
  '/api/discovered-sessions/test-connection',
  httpHandler(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const authError = rejectUnauthorizedDashboardRequest(req);
    if (authError) return authError;
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;
    const parsedBody = parseRequestBody(TestConnectionBodySchema, yield* req.json);
    if (!parsedBody.ok) return parsedBody.response;
    const body = parsedBody.body;

    const VALID_PROVIDERS = new Set(['openai', 'voyage', 'ollama']);
    if (!VALID_PROVIDERS.has(body.provider)) {
      return jsonResponse({ error: 'Invalid provider' }, { status: 400 });
    }

    const result = yield* Effect.promise(async () => {
      const startTs = Date.now();
      try {
        // embed() returns Effect — must runPromise to actually execute it
        await Effect.runPromise(embed(body.provider as 'openai' | 'voyage' | 'ollama', {
          text: 'connection test',
          model: body.model,
          apiKey: body.apiKey,
          baseUrl: body.ollamaBaseUrl,
        }));
        return { ok: true, latencyMs: Date.now() - startTs };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - startTs };
      }
    });

    return validatedJsonResponse(TestConnectionResponseSchema, result);
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
  getConvConfigRoute,
  putConvConfigRoute,
  postTestConnectionRoute,
);
