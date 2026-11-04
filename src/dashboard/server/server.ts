import { jsonResponse } from "./http-helpers.js";
/**
 * Dashboard HTTP server — Effect-based with dual-runtime support (PAN-428 B5)
 *
 * Dual-runtime:
 *   - Bun (dev):  BunHttpServer + BunServices
 *   - Node (prod): NodeHttpServer + NodeServices
 *
 * Routes:
 *   GET  /api/health  → { status: "ok", repoRoot, mode, bootGates, … }
 *   GET  /ws/rpc      → WebSocket RPC (PanRpcGroup)
 *   GET  /ws/terminal  → Raw WebSocket terminal (bypasses Effect RPC)
 *   GET  *            → static files from OVERDECK_FRONTEND_DIR
 */

import { Effect, FileSystem, Layer, Option, Path } from 'effect';
import { FetchHttpClient, HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http';
import { ServerConfig } from './config.js';
import { markDashboardListening } from './dashboard-listening.js';
import { EventStoreServiceLive } from './services/domain-services.js';
import { ReadModelServiceLive } from './read-model.js';
import { AgentsResolverLive } from '../../lib/overdeck/agents.js';
import { CostResolverLive } from '../../lib/overdeck/cost.js';
import { DbLive, TmuxLive } from '../../lib/overdeck/infra.js';
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
import { setupLinkedWebSocket } from './ws-linked.js';
import { setupForwardWebSocket } from './ws-forward.js';
import { knowledgeViewerRouteLayer, setupKnowledgeViewerProxy } from './routes/knowledge-viewer.js';
import { setupVoiceWebSocket } from './ws-voice.js';
import { setupAutoPresoWebSocket } from './ws-autopreso.js';
import { installChannelListener } from './channel-listener.js';
import { plainHttpNavigationGuard } from './plain-http-guard.js';
import { recordPairingExchangeFailure, takePairingById } from './pairing-credentials.js';
import { currentApprovalService } from './services/directory-approval.js';
import { getOverdeckVersion } from './routes/misc/shared.js';
import { hostsMachineLinks } from '../../lib/boot-gates.js';
import { ensureMachineKey } from '../../lib/anywhere/machine-key.js';
import { findActiveChannelTokenByKey } from '../../lib/access-tokens.js';
import { websocketRpcRouteLayer } from './ws-rpc.js'
import { issuesRouteLayer } from './routes/issues.js'
import { testRemovalWaiverRouteLayer } from './routes/test-removal-waiver.js'
import { deftRouteLayer } from './routes/deft.js'
import { pipelineMembershipRouteLayer } from './routes/pipeline-membership.js'
import { parkedRouteLayer } from './routes/parked.js'
import { velocityRouteLayer } from './routes/velocity.js'
import { agentsRouteLayer } from './routes/agents.js'
import { agentDirectoryRouteLayer } from './routes/agent-directory.js'
import { workersRegisterRouteLayer } from './routes/workers-register.js'
import { workersRouteLayer } from './routes/workers.js'
import { selfJobsRouteLayer } from './routes/self-jobs.js'
import { selfLanesRouteLayer } from './routes/self-lanes.js'
import { selfWorkersRouteLayer } from './routes/self-workers.js'
import { selfWorkflowRouteLayer } from './routes/self-workflow.js'
import { selfRequestsRouteLayer } from './routes/self-requests.js'
import { selfMemoryRouteLayer } from './routes/self-memory.js'
import { agentRequestsRouteLayer } from './routes/agent-requests.js'
import { lanesRouteLayer } from './routes/lanes.js'
import { workspacesRouteLayer } from './routes/workspaces.js'
import { workspaceRegistryRouteLayer } from './routes/workspace-registry.js'
import { specialistsRouteLayer } from './routes/specialists.js'
import { costsRouteLayer } from './routes/costs.js'
import { cloisterRouteLayer } from './routes/cloister.js'
import { resourcesRouteLayer } from './routes/resources.js'
import { commandDeckRouteLayer } from './routes/command-deck.js'
import { remoteRouteLayer } from './routes/remote.js'
import { environmentRouteLayer } from './routes/environment.js'
import { pairingRouteLayer } from './routes/pairing.js'
import { anywhereRouteLayer } from './routes/anywhere.js'
import { machinesRouteLayer } from './routes/machines.js'
import { machinesSshRouteLayer } from './routes/machines-ssh.js'
import { machinesFlyRouteLayer, machinesFlyEnableRemoteRouteLayer } from './routes/machines-fly.js'
import { remoteWorkAgentsRouteLayer } from './routes/remote-work-agents.js'
import { versionsSelfRouteLayer } from './routes/versions-self.js'
import { machinesFleetRouteLayer } from './routes/machines-fleet.js'
import { machinesPeerRouteLayer } from './routes/machines-peer.js'
import { phonesRouteLayer } from './routes/phones.js'
import { connectorsRouteLayer } from './routes/connectors.js'
import { machinesWorkRouteLayer } from './routes/machines-work.js'
import { machinesWorkLanesRouteLayer } from './routes/machines-work-lanes.js'
import { fleetWorkRouteLayer } from './routes/fleet-work.js'
import { fleetProjectsRouteLayer } from './routes/fleet-projects.js'
import { machinesProjectsRouteLayer } from './routes/machines-projects.js'
import { fleetAwarenessRouteLayer } from './routes/fleet-awareness.js'
import { needsYouRouteLayer } from './routes/needs-you.js'
import { costsDigestRouteLayer } from './routes/costs-digest.js'
import { fleetUsageRouteLayer } from './routes/fleet-usage.js'
import { settingsResolvedRouteLayer } from './routes/settings-resolved.js'
import { fleetSettingsRouteLayer } from './routes/fleet-settings.js'
import { directoryRouteLayer } from './routes/directory.js'
import { directoryApprovalRouteLayer } from './routes/directory-approval.js'
import { pushRouteLayer } from './routes/push.js'
import { tailscaleRouteLayer } from './routes/tailscale.js'
import { accessTokensRouteLayer } from './routes/access-tokens.js'
import { mcpRouteLayer } from './routes/mcp.js'
import { mcpOAuthRouteLayer } from './routes/mcp-oauth.js'
import { mcpOAuthAdminRouteLayer } from './routes/mcp-oauth-admin.js'
import { remoteRequestGateLayer } from './remote-request-gate.js'
import { linkedConversationProxyLayer } from './linked-conversation-proxy.js';
import { settingsRouteLayer } from './routes/settings.js'
import { modelPresetsRouteLayer } from './routes/model-presets.js'
import { jevRouteLayer } from './routes/jev.js'
import { colorThemesRouteLayer } from './routes/color-themes.js'
import { vaultRouteLayer } from './routes/vault.js'
import { voiceRouteLayer } from './routes/voice.js';
import { autopresoRouteLayer } from './routes/autopreso.js';
import { metricsRouteLayer } from './routes/metrics.js'
import { miscRouteLayer } from './routes/misc.js';
import { paletteRouteLayer } from './routes/palette.js';
import { conversationsRouteLayer } from './routes/conversations.js';
import { conversationKickoffRouteLayer } from './routes/conversation-kickoff.js';
import { conversationPullRouteLayer } from './routes/conversation-pull.js';
import { conversationPreviewPortsRouteLayer } from './routes/conversation-preview-ports.js';
import { linkedOpenRouteLayer } from './routes/linked-open.js';
import { conversationBookmarksRouteLayer } from './routes/conversation-bookmarks.js';
import { conversationTriageRouteLayer } from './routes/conversation-triage.js';
import { conversationScheduledMessagesRouteLayer } from './routes/conversation-scheduled-messages.js';
import { conversationSchedulesRouteLayer } from './routes/conversation-schedules.js';
import { conversationsRetrospectiveRouteLayer } from './routes/conversations-retrospective.js';
import { conversationCompanionTerminalRouteLayer } from './routes/conversation-companion-terminal.js';
import { conversationPullRequestRoutes } from './routes/conversation-pull-requests.js';
import { conversationPermissionRoutes } from './routes/conversation-permission.js';
import { conversationAttachmentRoutes } from './routes/conversation-attachments.js';
import { eventsRouteLayer } from './routes/events.js';
import { projectsRouteLayer } from './routes/projects.js';
import { projectsMergeTrainRouteLayer } from './routes/projects-merge-train.js';
import { mergeTrainRouteLayer } from './routes/merge-train.js';
import { mergeTrainLanesRouteLayer } from './routes/merge-train-lanes.js';
import { flywheelRouteLayer } from './routes/flywheel.js';
import { contextRouteLayer } from './routes/context.js';
import { commandsRouteLayer } from './routes/commands.js';
import { adminRouteLayer } from './routes/admin.js';
import { prereqsRouteLayer } from './routes/prereqs.js';
import { cliproxyRouteLayer } from './routes/cliproxy.js';
import { githubQuotaRouteLayer } from './routes/github-quota.js';
import { ttsRouteLayer } from './routes/tts.js';
import { webhooksRouteLayer } from './routes/webhooks.js';
import { triggerHooksRouteLayer } from './routes/trigger-hooks.js';
import { triggersRouteLayer } from './routes/triggers.js';
import { sharesRouteLayer } from './routes/shares.js';
import { joinsRouteLayer } from './routes/joins.js';
import { hooksRouteLayer } from './routes/hooks.js';
import { diffsRouteLayer } from './routes/diffs.js';
import { diffCompareRouteLayer } from './routes/diff-compare.js';
import { codexAuthRouteLayer } from './routes/codex-auth.js';
import { claudeCodeRouteLayer } from './routes/claude-code.js';
import { linearMcpAuthRouteLayer } from './routes/linear-mcp-auth.js';
import { terminalsRouteLayer } from './routes/terminals.js';
import { discoveredSessionsRouteLayer } from './routes/discovered-sessions.js';
import { ordersRouteLayer } from './routes/orders.js';
import { artifactsRouteLayer } from './routes/artifacts.js';
import { backlogRouteLayer } from './routes/backlog.js';
import { featureRegistryRouteLayer } from './routes/feature-registry.js';
import { fsRouteLayer } from './routes/fs.js';
import { internalEventsRouteLayer } from './routes/internal-events.js';
import { restartGateRouteLayer } from './routes/restart-gate.js';
import { dashboardSessionPreflightRouteLayer, dashboardSessionRouteLayer } from './routes/dashboard-session.js';
import { emitActivityEntry, emitActivityTts } from '../../lib/activity-logger.js';
import { holdRequestsUntilServed, retryDashboardBind } from './server-bind.js';
import { buildDashboardHealthResponse } from './health-response.js';

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
    const bind = retryDashboardBind(NodeHttpServer.make(() => {
      const nodeServer = NodeHttp.createServer();
      holdRequestsUntilServed(nodeServer);
      setupTerminalWebSocket(nodeServer);
      setupLinkedWebSocket(nodeServer);
      setupForwardWebSocket(nodeServer);
      setupKnowledgeViewerProxy(nodeServer);
      setupVoiceWebSocket(nodeServer);
      setupAutoPresoWebSocket(nodeServer);
      // PAN-4645: secure machine channels on the dashboard port (the primary, or a
      // peer-mode dashboard that opted in; see hostsMachineLinks). An IK initiator is
      // pinned when an active machine, phone or connector token is bound to its key
      // (PAN-4835, PAN-4927); a pairing initiator must name a live `pan pair` credential.
      installChannelListener(nodeServer, {
        primary: hostsMachineLinks(),
        localKey: ensureMachineKey,
        isPinnedPeer: (remoteKeyHex) => findActiveChannelTokenByKey(remoteKeyHex) !== null,
        takePairing: (pairingId) => {
          const taken = takePairingById(pairingId);
          return taken === 'unknown' || taken === 'expired' ? 'unknown' : taken;
        },
        onPairingFailure: recordPairingExchangeFailure,
        serverVersion: getOverdeckVersion,
        // PAN-2356: an approval channel only for this machine's own live join request.
        takeApproval: (requestId) => currentApprovalService()?.takeApproval(requestId) ?? false,
        onApprovalChannel: (channel) => currentApprovalService()?.onIncomingChannel(channel),
      });
      return nodeServer;
    }, {
      host: config.host,
      port: config.port,
    }), (attempt, delayMs) => {
      console.warn(`[overdeck] HTTP bind failed with EADDRINUSE; retry ${attempt}/3 in ${delayMs}ms`);
    });
    return Layer.mergeAll(
      Layer.effect(HttpServer.HttpServer)(bind),
      NodeHttpServer.layerHttpServices,
    );
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
  Effect.promise(() => buildDashboardHealthResponse()).pipe(
    Effect.map((health) => jsonResponse(health.body, { status: health.httpStatus })),
  ),
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

    // An unregistered API path is a 404, never the SPA shell: a client that
    // calls .json() on index.html gets a parse error instead of a clean
    // "gone" (PAN-4429 deleted the TLDR routes).
    if (url.value.pathname === '/api' || url.value.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Not Found' }, { status: 404 });
    }

    // PAN-4645 D-4645-13: a remote browser on plain HTTP gets "Use HTTPS"
    // instead of the SPA shell (both `/` and the SPA fallback); assets are untouched.
    const useHttps = plainHttpNavigationGuard(request, url.value.pathname);
    if (useHttps) return useHttps;

    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    // Resolve static directory: OVERDECK_FRONTEND_DIR env var or default
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
      process.env['OVERDECK_FRONTEND_DIR'] ??
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
      // A request that names a concrete file (it carries an extension) is an
      // asset request, not a client-side route. Serving the SPA shell for it
      // hands the browser `index.html` under a `.js` URL, so a dynamic import
      // of a build-hashed chunk fails with "Failed to fetch dynamically
      // imported module" instead of a clean 404 — a tab left open across a
      // rebuild then never renders the route it lazy-loads. Only extensionless
      // navigation paths get the SPA fallback.
      if (pathService.extname(urlPath)) {
        return HttpServerResponse.text('Not Found', { status: 404 });
      }

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
  // PAN-3762: global middleware; requires a credential for non-local /api and /events requests.
  remoteRequestGateLayer,
  // PAN-4650 D-4650-4: /api/conversations/@<machine>/… forwards to the owner (admitted requests only).
  linkedConversationProxyLayer,
  healthRouteLayer,
  dashboardSessionPreflightRouteLayer,
  dashboardSessionRouteLayer,
  websocketRpcRouteLayer,
  issuesRouteLayer,
  testRemovalWaiverRouteLayer,
  deftRouteLayer,
  pipelineMembershipRouteLayer,
  parkedRouteLayer,
  velocityRouteLayer,
  agentsRouteLayer,
  agentDirectoryRouteLayer,
  workersRegisterRouteLayer,
  workersRouteLayer,
  selfJobsRouteLayer,
  selfWorkersRouteLayer,
  selfLanesRouteLayer,
  selfWorkflowRouteLayer,
  selfRequestsRouteLayer,
  selfMemoryRouteLayer,
  agentRequestsRouteLayer,
  lanesRouteLayer,
  workspacesRouteLayer,
  workspaceRegistryRouteLayer,
  specialistsRouteLayer,
  costsRouteLayer,
  cloisterRouteLayer,
  resourcesRouteLayer,
  commandDeckRouteLayer,
  remoteRouteLayer,
  settingsRouteLayer,
  modelPresetsRouteLayer,
  jevRouteLayer,
  colorThemesRouteLayer,
  vaultRouteLayer,
  voiceRouteLayer,
  autopresoRouteLayer,
  metricsRouteLayer,
  miscRouteLayer,
  paletteRouteLayer,
  conversationsRouteLayer,
  conversationKickoffRouteLayer,
  conversationPullRouteLayer,
  conversationPreviewPortsRouteLayer,
  linkedOpenRouteLayer,
  conversationBookmarksRouteLayer,
  conversationTriageRouteLayer,
  conversationScheduledMessagesRouteLayer,
  conversationSchedulesRouteLayer,
  conversationsRetrospectiveRouteLayer,
  conversationCompanionTerminalRouteLayer,
  conversationPullRequestRoutes,
  conversationPermissionRoutes,
  conversationAttachmentRoutes,
  eventsRouteLayer,
  projectsRouteLayer,
  projectsMergeTrainRouteLayer,
  mergeTrainRouteLayer,
  mergeTrainLanesRouteLayer,
  flywheelRouteLayer,
  contextRouteLayer,
  commandsRouteLayer,
  adminRouteLayer,
  prereqsRouteLayer,
  cliproxyRouteLayer,
  githubQuotaRouteLayer,
  ttsRouteLayer,
  webhooksRouteLayer,
  triggerHooksRouteLayer,
  triggersRouteLayer,
  sharesRouteLayer,
  joinsRouteLayer,
  hooksRouteLayer,
  diffsRouteLayer,
  diffCompareRouteLayer,
  codexAuthRouteLayer,
  claudeCodeRouteLayer,
  linearMcpAuthRouteLayer,
  terminalsRouteLayer,
  discoveredSessionsRouteLayer,
  ordersRouteLayer,
  artifactsRouteLayer,
  featureRegistryRouteLayer,
  fsRouteLayer,
  backlogRouteLayer,
  internalEventsRouteLayer,
  restartGateRouteLayer,
  knowledgeViewerRouteLayer,
  environmentRouteLayer,
  pairingRouteLayer,
  anywhereRouteLayer,
  machinesRouteLayer,
  machinesSshRouteLayer,
  machinesFlyRouteLayer,
  machinesFlyEnableRemoteRouteLayer,
  remoteWorkAgentsRouteLayer,
  versionsSelfRouteLayer,
  machinesFleetRouteLayer,
  machinesPeerRouteLayer,
  phonesRouteLayer,
  connectorsRouteLayer,
  machinesWorkRouteLayer,
  machinesWorkLanesRouteLayer,
  fleetWorkRouteLayer,
  fleetProjectsRouteLayer,
  machinesProjectsRouteLayer,
  fleetAwarenessRouteLayer,
  needsYouRouteLayer,
  costsDigestRouteLayer,
  fleetUsageRouteLayer,
  settingsResolvedRouteLayer,
  fleetSettingsRouteLayer,
  directoryRouteLayer,
  directoryApprovalRouteLayer,
  pushRouteLayer,
  tailscaleRouteLayer,
  accessTokensRouteLayer,
  mcpRouteLayer,
  mcpOAuthRouteLayer,
  mcpOAuthAdminRouteLayer,
  staticRouteLayer,
);

// ─── Domain service layers (PAN-433: ReadModel replaces SnapshotService) ─────
// ReadModelServiceLive bootstraps during construction (reads lib modules, JSON-cleans).
// EventStoreServiceLive depends on ReadModelService (wires event subscription → read model).

// ── Overdeck resolver layers ────────────────────────────────────────────────
//
// Pattern (PAN-1938): each resolver/writer layer is wired here and added to
// DomainServicesLive. Route handlers use `yield* XxxResolver` to read from
// overdeck.db instead of calling legacy DB functions directly.
//
// Wiring order: route group converted → add its Live layer here → add to DomainServicesLive.
// CostWriter deferred until CostArchiveLive is implemented.
const OverdeckAgentsResolverLive = AgentsResolverLive.pipe(
  Layer.provide(Layer.mergeAll(DbLive, TmuxLive)),
);

const OverdeckCostResolverLive = CostResolverLive.pipe(
  Layer.provide(DbLive),
);

const ReadModelWithOverdeckLive = ReadModelServiceLive.pipe(
  Layer.provide(OverdeckAgentsResolverLive),
);

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
  ReadModelWithOverdeckLive,
  AgentStateServiceLive,
  EventStoreServiceLive.pipe(Layer.provide(ReadModelWithOverdeckLive)),
  TerminalServiceLive,
  TrackerClientsLive,
  IssueLifecycleServiceLive,
  AgentSpawnerLive,
  WorkspaceServiceLive,
  OpenRouterServiceLive,
  PanOpenLive,
  OverdeckCostResolverLive,
);

// ─── Full server layer ────────────────────────────────────────────────────────

export const makeServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;

    const httpListeningLayer = Layer.effectDiscard(
      Effect.gen(function* () {
        yield* HttpServer.HttpServer;
        yield* Effect.sync(() => {
          markDashboardListening();
          console.log(`[boot-timing] HTTP server listening at +${Math.round(performance.now())}ms (since process start)`);
          console.log(`[overdeck] Dashboard listening on http://${config.host}:${config.port}`);
          const mode = process.env['OVERDECK_MODE'] === 'production' ? 'production mode' : 'development mode';
          emitActivityEntry({
            source: 'dashboard',
            level: 'success',
            message: `Dashboard started in ${mode}`,
          });
          emitActivityTts({
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
