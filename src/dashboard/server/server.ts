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
 *   GET  *            → static files from PANOPTICON_FRONTEND_DIR
 */

import { Effect, FileSystem, Layer, Option, Path } from 'effect';
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { ServerConfig } from './config.js';
import { EventStoreServiceLive, SnapshotServiceLive } from './services/domain-services.js';
import { websocketRpcRouteLayer } from './ws-rpc.js';

// ─── Runtime detection ────────────────────────────────────────────────────────

declare const Bun: unknown;

function isBunRuntime(): boolean {
  return typeof Bun !== 'undefined';
}

// ─── Dual-runtime layers ──────────────────────────────────────────────────────

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    if (isBunRuntime()) {
      const BunHttpServer = yield* Effect.promise(
        () => import('@effect/platform-bun/BunHttpServer'),
      );
      return BunHttpServer.layer({ port: config.port, hostname: config.host });
    } else {
      const [NodeHttpServer, NodeHttp] = yield* Effect.all([
        Effect.promise(() => import('@effect/platform-node/NodeHttpServer')),
        Effect.promise(() => import('node:http')),
      ]);
      return NodeHttpServer.layer(NodeHttp.createServer, {
        host: config.host,
        port: config.port,
      });
    }
  }),
);

const PlatformServicesLive = Layer.unwrap(
  Effect.gen(function* () {
    if (isBunRuntime()) {
      const { layer } = yield* Effect.promise(() => import('@effect/platform-bun/BunServices'));
      return layer;
    } else {
      const { layer } = yield* Effect.promise(() => import('@effect/platform-node/NodeServices'));
      return layer;
    }
  }),
);

// ─── Health route ─────────────────────────────────────────────────────────────

const healthRouteLayer = HttpRouter.add(
  'GET',
  '/api/health',
  HttpServerResponse.json({ status: 'ok' }),
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
    // Default: <panopticonHome>/../../dist/dashboard/frontend (relative to ~/.panopticon)
    const staticDir =
      process.env['PANOPTICON_FRONTEND_DIR'] ??
      pathService.resolve(config.panopticonHome, '..', '..', 'dist', 'dashboard', 'frontend');

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
      return yield* HttpServerResponse.file(indexPath).pipe(
        Effect.catch(() =>
          Effect.succeed(HttpServerResponse.text('Internal Server Error', { status: 500 })),
        ),
      );
    }

    return yield* HttpServerResponse.file(filePath).pipe(
      Effect.catch(() =>
        Effect.succeed(HttpServerResponse.text('Internal Server Error', { status: 500 })),
      ),
    );
  }),
);

// ─── Route composition ────────────────────────────────────────────────────────

export const makeRoutesLayer = Layer.mergeAll(
  healthRouteLayer,
  websocketRpcRouteLayer,
  staticRouteLayer,
);

// ─── Domain service layers ────────────────────────────────────────────────────

const DomainServicesLive = Layer.mergeAll(
  EventStoreServiceLive,
  SnapshotServiceLive.pipe(Layer.provide(EventStoreServiceLive)),
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
        });
      }),
    );

    const serverApplicationLayer = Layer.mergeAll(
      HttpRouter.serve(makeRoutesLayer),
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
