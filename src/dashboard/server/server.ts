import { jsonResponse } from "./http-helpers.js";
/**
 * Dashboard HTTP server — Effect-based with dual-runtime support (PAN-428 B5)
 *
 * Dual-runtime:
 *   - Bun (dev):  BunHttpServer + BunServices
 *   - Node (prod): NodeHttpServer + NodeServices
 *
 * Routes:
 *   GET  /api/health  → { status: "ok" }
 *   GET  /ws/rpc      → WebSocket RPC (PanRpcGroup)
 *   GET  /ws/terminal  → Raw WebSocket terminal (bypasses Effect RPC)
 *   GET  *            → static files from PANOPTICON_FRONTEND_DIR
 */

import { Effect, FileSystem, Layer, Option, Path } from 'effect';
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { ServerConfig } from './config.js';
import { EventStoreServiceLive } from './services/domain-services.js';
import { ReadModelServiceLive } from './read-model.js';
import { AgentStateServiceLive } from './services/agent-state-service.js';
import { TerminalServiceLive } from './services/terminal-service.js';
import { LinearClientOptionalLive } from './services/linear-client.js';
import { GitHubClientOptionalLive } from './services/github-client.js';
import { RallyClientOptionalLive } from './services/rally-client.js';
import { IssueLifecycleLive } from './services/issue-lifecycle.js';
import { AgentSpawnerLive } from './services/agent-spawner.js';
import { WorkspaceServiceLive } from './services/workspace-service.js';
import { OpenRouterServiceLive } from './services/openrouter-service.js';
import { PanOpenLive } from './services/open.js';
import { setupTerminalWebSocket } from './ws-terminal.js';
import { setupVoiceWebSocket } from './ws-voice.js';
import { setupAutoPresoWebSocket } from './ws-autopreso.js';
import { websocketRpcRouteLayer } from './ws-rpc.js'
import { issuesRouteLayer } from './routes/issues.js'
import { agentsRouteLayer } from './routes/agents.js'
import { workspacesRouteLayer } from './routes/workspaces.js'
import { specialistsRouteLayer } from './routes/specialists.js'
import { costsRouteLayer } from './routes/costs.js'
import { cloisterRouteLayer } from './routes/cloister.js'
import { resourcesRouteLayer } from './routes/resources.js'
import { commandDeckRouteLayer } from './routes/command-deck.js'
import { remoteRouteLayer } from './routes/remote.js'
import { settingsRouteLayer } from './routes/settings.js'
import { voiceRouteLayer } from './routes/voice.js';
import { autopresoRouteLayer } from './routes/autopreso.js';
import { metricsRouteLayer } from './routes/metrics.js'
import { miscRouteLayer } from './routes/misc.js';
import { paletteRouteLayer } from './routes/palette.js';
import { conversationsRouteLayer } from './routes/conversations.js';
import { eventsRouteLayer } from './routes/events.js';
import { showRouteLayer } from './routes/show.js';
import { projectsRouteLayer } from './routes/projects.js';
import { adminRouteLayer } from './routes/admin.js';
import { prereqsRouteLayer } from './routes/prereqs.js';
import { cliproxyRouteLayer } from './routes/cliproxy.js';
import { ttsRouteLayer } from './routes/tts.js';
import { webhooksRouteLayer } from './routes/webhooks.js';
import { hooksRouteLayer } from './routes/hooks.js';
import { diffsRouteLayer } from './routes/diffs.js';
import { codexAuthRouteLayer } from './routes/codex-auth.js';
import { swarmRouteLayer } from './routes/swarm.js';
import { discoveredSessionsRouteLayer } from './routes/discovered-sessions.js';
import { flywheelRouteLayer } from './routes/flywheel.js';
import { dashboardCsrfToken, dashboardSessionCookieHeader, rejectUnauthorizedDashboardRequest, rejectUnauthorizedDashboardSessionMintRequest } from './routes/dashboard-auth.js';
import { validateOrigin } from './routes/origin-validation.js';
import { emitActivityEntrySync, emitActivityTtsSync } from '../../lib/activity-logger.js';

// ─── Dual-runtime layers ──────────────────────────────────────────────────────

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    // Always use Node's http.createServer() so we can attach the raw WebSocket
    // terminal handler via the 'upgrade' event BEFORE Effect registers its own
    // upgrade listeners. Bun fully implements Node's http module, so this works
    // in both runtimes. BunHttpServer.layer was used previously but it uses
    // Bun.serve() which doesn't expose a raw upgrade event — that broke /ws/terminal.
    const [NodeHttpServer, NodeHttp] = yield* Effect.all([
      Effect.promise(() => import('@effect/platform-node/NodeHttpServer')),
      Effect.promise(() => import('node:http')),
    ]);
    const nodeServer = NodeHttp.createServer();
    setupTerminalWebSocket(nodeServer);
    setupVoiceWebSocket(nodeServer);
    setupAutoPresoWebSocket(nodeServer);
    return NodeHttpServer.layer(() => nodeServer, {
      host: config.host,
      port: config.port,
    });
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    // Always use Node services — consistent with NodeHttpServer above.
    const { layer } = yield* Effect.promise(() => import('@effect/platform-node/NodeServices'));
    return layer;
  }),
);

// ─── Health route ─────────────────────────────────────────────────────────────

const healthRouteLayer = HttpRouter.add(
  'GET',
  '/api/health',
  jsonResponse({ status: 'ok' }),
);

function requestHeader(request: HttpServerRequest.HttpServerRequest, name: string): string | undefined {
  const value = (request.headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? value[0] : value;
}

function allowDashboardSessionCors(
  response: HttpServerResponse.HttpServerResponse,
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse {
  const origin = requestHeader(request, 'origin');
  if (!origin) return response;
  return HttpServerResponse.setHeader(
    HttpServerResponse.setHeader(
      HttpServerResponse.setHeader(
        HttpServerResponse.setHeader(response, 'Access-Control-Allow-Origin', origin),
        'Access-Control-Allow-Credentials',
        'true',
      ),
      'Access-Control-Allow-Headers',
      'x-panopticon-internal-token, x-panopticon-csrf-token, authorization, content-type',
    ),
    'Vary',
    'Origin',
  );
}

function isHttpsRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const forwardedProto = requestHeader(request, 'x-forwarded-proto');
  if (forwardedProto?.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  return HttpServerRequest.toURL(request).pipe(Option.match({
    onNone: () => false,
    onSome: (url) => url.protocol === 'https:',
  }));
}

const dashboardSessionPreflightRouteLayer = HttpRouter.add(
  'OPTIONS',
  '/api/dashboard/session',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    return allowDashboardSessionCors(
      HttpServerResponse.setHeader(jsonResponse({ ok: true }), 'Access-Control-Allow-Methods', 'POST, OPTIONS'),
      request,
    );
  }),
);

const dashboardSessionRouteLayer = HttpRouter.add(
  'POST',
  '/api/dashboard/session',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const originCheck = validateOrigin(request);
    if (!originCheck.ok) {
      return jsonResponse({ error: originCheck.error }, { status: 403 });
    }
    const mintAuthError = rejectUnauthorizedDashboardSessionMintRequest(request);
    const sessionAuthError = rejectUnauthorizedDashboardRequest(request);
    if (mintAuthError && sessionAuthError) return mintAuthError;

    let response = jsonResponse({ ok: true, csrfToken: dashboardCsrfToken() });
    if (!mintAuthError) {
      response = HttpServerResponse.setHeader(
        response,
        'Set-Cookie',
        dashboardSessionCookieHeader({ secure: isHttpsRequest(request) }),
      );
    }

    return allowDashboardSessionCors(
      HttpServerResponse.setHeader(response, 'Cache-Control', 'no-store'),
      request,
    );
  }),
);

// ─── Static file route ────────────────────────────────────────────────────────

const staticRouteLayer = HttpRouter.add(
  'GET',
  '*',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text('Bad Request', { status: 400 });
    }

    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    // Resolve static directory: PANOPTICON_FRONTEND_DIR env var or default
    // When running from source (Bun): import.meta.dir = src/dashboard/server → ../../.. = project root
    // When running from bundle (Node): import.meta.url = dist/dashboard/server.js → ../.. = project root
    // Fallback: CWD (works if started from project root)
    const selfUrl = new URL(import.meta.url);
    const selfPath = selfUrl.protocol === 'file:' ? pathService.dirname(selfUrl.pathname) : process.cwd();
    // Detect if we're in dist/ (bundled) or src/ (source)
    const inDist = selfPath.includes('/dist/');
    const projectRoot = inDist
      ? pathService.resolve(selfPath, '..', '..')  // dist/dashboard/ → project root
      : pathService.resolve(selfPath, '..', '..', '..'); // src/dashboard/server/ → project root
    const staticDir =
      process.env['PANOPTICON_FRONTEND_DIR'] ??
      pathService.resolve(projectRoot, 'dist', 'dashboard', 'public');

    const staticRoot = pathService.resolve(staticDir);
    const urlPath = url.value.pathname === '/' ? '/index.html' : url.value.pathname;
    const rawRelative = urlPath.replace(/^[/\\]+/, '');
    const normalized = pathService.normalize(rawRelative).replace(/^[/\\]+/, '');

    if (normalized.length === 0 || normalized.startsWith('..') || normalized.includes('\0')) {
      return HttpServerResponse.text('Invalid path', { status: 400 });
    }

    const sep = pathService.sep;
    const isWithinRoot = (p: string) =>
      p === staticRoot ||
      p.startsWith(staticRoot.endsWith(sep) ? staticRoot : `${staticRoot}${sep}`);

    let filePath = pathService.resolve(staticRoot, normalized);
    if (!isWithinRoot(filePath)) {
      return HttpServerResponse.text('Invalid path', { status: 400 });
    }

    // If no extension, try appending /index.html (SPA routing)
    if (!pathService.extname(filePath)) {
      const candidate = pathService.resolve(filePath, 'index.html');
      if (isWithinRoot(candidate)) filePath = candidate;
    }

    const fileInfo = yield* fileSystem
      .stat(filePath)
      .pipe(Effect.catch(() => Effect.succeed(null)));

    if (!fileInfo || fileInfo.type !== 'File') {
      // SPA fallback: serve index.html for client-side routes
      const indexPath = pathService.resolve(staticRoot, 'index.html');
      const indexInfo = yield* fileSystem
        .stat(indexPath)
        .pipe(Effect.catch(() => Effect.succeed(null)));
      if (!indexInfo || indexInfo.type !== 'File') {
        return HttpServerResponse.text('Not Found', { status: 404 });
      }
      // index.html must never be cached: it references hashed JS bundles that
      // change on every build. If the browser caches an old index.html, it will
      // load stale JS bundles and the user sees outdated UI.
      return yield* HttpServerResponse.file(indexPath).pipe(
        Effect.map((res) => HttpServerResponse.setHeader(res, 'Cache-Control', 'no-cache, no-store, must-revalidate')),
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text('Internal Server Error', { status: 500 })),
        ),
      );
    }

    const res = yield* HttpServerResponse.file(filePath).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text('Internal Server Error', { status: 500 })),
      ),
    );

    // index.html must never be cached: it references hashed JS bundles that
    // change on every build. If the browser caches an old index.html, it will
    // load stale JS bundles and the user sees outdated UI.
    if (filePath.endsWith('index.html')) {
      return HttpServerResponse.setHeader(res, 'Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    return res;
  }),
);

// ─── Route composition ────────────────────────────────────────────────────────

export const makeRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  dashboardSessionPreflightRouteLayer,
  dashboardSessionRouteLayer,
  websocketRpcRouteLayer,
  issuesRouteLayer,
  agentsRouteLayer,
  workspacesRouteLayer,
  specialistsRouteLayer,
  costsRouteLayer,
  cloisterRouteLayer,
  resourcesRouteLayer,
  commandDeckRouteLayer,
  remoteRouteLayer,
  settingsRouteLayer,
  voiceRouteLayer,
  autopresoRouteLayer,
  metricsRouteLayer,
  miscRouteLayer,
  paletteRouteLayer,
  conversationsRouteLayer,
  eventsRouteLayer,
  showRouteLayer,
  projectsRouteLayer,
  adminRouteLayer,
  prereqsRouteLayer,
  cliproxyRouteLayer,
  ttsRouteLayer,
  webhooksRouteLayer,
  hooksRouteLayer,
  diffsRouteLayer,
  codexAuthRouteLayer,
  swarmRouteLayer,
  discoveredSessionsRouteLayer,
  flywheelRouteLayer,
  staticRouteLayer,
);

// ─── Domain service layers (PAN-433: ReadModel replaces SnapshotService) ─────
// ReadModelServiceLive bootstraps during construction (reads lib modules, JSON-cleans).
// EventStoreServiceLive depends on ReadModelService (wires event subscription → read model).

// ─── Tracker + lifecycle services (PAN-449) ───────────────────────────────────
// Optional layers: server starts even if tracker keys are not configured.
// Route handlers that need a tracker service get TrackerNotConfigured if it's absent.

const TrackerClientsLive = Layer.mergeAll(
  LinearClientOptionalLive,
  GitHubClientOptionalLive,
  RallyClientOptionalLive,
);

const IssueLifecycleServiceLive = IssueLifecycleLive.pipe(
  Layer.provide(TrackerClientsLive),
);

const DomainServicesLive = Layer.mergeAll(
  ReadModelServiceLive,
  AgentStateServiceLive,
  EventStoreServiceLive.pipe(Layer.provide(ReadModelServiceLive)),
  TerminalServiceLive,
  TrackerClientsLive,
  IssueLifecycleServiceLive,
  AgentSpawnerLive,
  WorkspaceServiceLive,
  OpenRouterServiceLive,
  PanOpenLive,
);

// ─── Full server layer ────────────────────────────────────────────────────────

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        yield* Effect.sync(() => {
          console.log(`[panopticon] Dashboard listening on http://${config.host}:${config.port}`);
          const mode = process.env['PANOPTICON_MODE'] === 'production' ? 'production mode' : 'development mode';
          emitActivityEntrySync({
            source: 'dashboard',
            level: 'success',
            message: `Dashboard started in ${mode}`,
          });
          emitActivityTtsSync({
            utterance: `Dashboard started in ${mode}`,
            priority: 2,
            source: 'dashboard',
            eventType: 'dashboard.started',
          });
        });
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer, { disableLogger: true }),
      httpListeningLayer,
    );

    return serverApplicationLayer.pipe(
      Layer.provideMerge(DomainServicesLive),
      Layer.provideMerge(HttpServerLive),
      Layer.provideMerge(FetchHttpClient.layer),
      Layer.provideMerge(PlatformServicesLive),
    );
  }),
);

/**
 * Run the dashboard server. Requires ServerConfig to be provided by the caller.
 */
export const runServer = Layer.launch(makeServerLayer) as Effect.Effect<
  never,
  unknown,
  ServerConfig
>;
