/**
 * WebSocket RPC handlers — implements PanRpcGroup using Effect (PAN-428 B5)
 *
 * Connects the PanRpcGroup contract to the server-side service layer.
 * Terminal RPC methods (subscribeTerminal, terminalOpen/Write/Resize/Close)
 * are implemented via TerminalService (dual-runtime PTY, B20).
 */

import { Effect, Layer, Queue, Stream } from 'effect';
import { HttpRouter, HttpServerRequest } from 'effect/unstable/http';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { PanRpcGroup, PanRpcError, WS_METHODS } from '@panctl/contracts';
import { PanOpen } from './services/open.js';
import { EventStoreService } from './services/domain-services.js';
import { ReadModelService } from './read-model.js';
import { TerminalService } from './services/terminal-service.js';
import { getConversationByName } from '../../lib/database/conversations-db.js';
import { parseConversationMessages, watchConversation } from './services/conversation-service.js';
import { sessionFilePath } from '../../lib/paths.js';
import { listSessionNamesAsync } from '../../lib/tmux.js';
import { listProjects } from '../../lib/projects.js';
import type { AgentStatus, ConversationEvent, DomainEvent, EmbedProgressEvent, EnrichCompleteEvent, EnrichProgressEvent, ScanCompleteEvent, ScanProgressEvent, ScanStartedEvent, SessionTreeDelta } from '@panctl/contracts';
import type { StoredEvent } from './event-store.js';
import { parseRelativeTime } from '../../lib/conversations/search.js';
import type { SearchResult } from '../../lib/conversations/search.js';
import { CostThresholdError } from '../../lib/conversations/enrichment/index.js';
import { getConversationsConfigAsync } from '../../lib/config-yaml.js';
import type { ConversationFilter, DiscoveredSession } from '../../lib/database/discovered-sessions-db.js';
import { validateOrigin } from './routes/origin-validation.js';
import { rejectUnauthorizedDashboardRequest } from './routes/dashboard-auth.js';
import { jsonResponse } from './http-helpers.js';
import { runDashboardDbJob } from './services/dashboard-db-task.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function storedToDomainEvent(stored: StoredEvent): DomainEvent {
  return {
    type: stored.type,
    sequence: stored.sequence,
    timestamp: stored.timestamp,
    payload: stored.payload,
  } as DomainEvent;
}

function toDiscoveredSessionSnapshot(session: DiscoveredSession) {
  return {
    id: session.id,
    jsonlPath: session.jsonlPath,
    sessionId: session.sessionId ?? undefined,
    workspacePath: session.workspacePath ?? undefined,
    workspaceHash: session.workspaceHash ?? undefined,
    messageCount: session.messageCount,
    firstTs: session.firstTs ?? undefined,
    lastTs: session.lastTs ?? undefined,
    modelsUsed: session.modelsUsed,
    primaryModel: session.primaryModel ?? undefined,
    tokenInput: session.tokenInput,
    tokenOutput: session.tokenOutput,
    estimatedCost: session.estimatedCost,
    toolsUsed: session.toolsUsed,
    filesTouched: session.filesTouched,
    tags: session.tags,
    summary: session.summary ?? undefined,
    summaryDetailed: session.summaryDetailed ?? undefined,
    enrichmentLevel: session.enrichmentLevel,
    enrichmentModel: session.enrichmentModel ?? undefined,
    enrichedAt: session.enrichedAt ?? undefined,
    enrichmentFailed: session.enrichmentFailed,
    panopticonManaged: session.panopticonManaged,
    panIssueId: session.panIssueId ?? undefined,
    panAgentId: session.panAgentId ?? undefined,
    scannedAt: session.scannedAt,
  };
}

function normalizeConversationFilter(input: {
  workspacePath?: string;
  primaryModel?: string;
  managed?: boolean;
  unmanaged?: boolean;
  since?: string;
  before?: string;
  after?: string;
  minCost?: number;
  maxCost?: number;
  minMessages?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  issueId?: string;
  enrichmentLevel?: number;
  enriched?: boolean;
  notEnriched?: boolean;
  limit?: number;
  offset?: number;
}): ConversationFilter {
  return {
    workspacePath: input.workspacePath,
    primaryModel: input.primaryModel,
    managed: input.managed,
    unmanaged: input.unmanaged,
    since: input.since ? parseRelativeTime(input.since) : undefined,
    before: input.before ? parseRelativeTime(input.before) : undefined,
    after: input.after ? parseRelativeTime(input.after) : undefined,
    minCost: input.minCost,
    maxCost: input.maxCost,
    minMessages: input.minMessages,
    tags: input.tags,
    tools: input.tools,
    files: input.files,
    issueId: input.issueId,
    enrichmentLevel: input.enrichmentLevel,
    enriched: input.enriched,
    notEnriched: input.notEnriched,
    limit: input.limit,
    offset: input.offset,
  };
}

// ─── Session Tree Subscription Helpers (PAN-821) ──────────────────────────────

/** Extract issue ID from a tmux session name. */
export function extractIssueIdFromSession(sessionName: string): string | null {
  const issuePattern = '((?:[a-z]+-\\d+|(?:f|us|de|ta|tc)\\d+))';
  const agentMatch = sessionName.match(new RegExp(`^(agent|planning)-${issuePattern}(?:-\\d+)?$`, 'i'));
  if (agentMatch) return agentMatch[2]!.toUpperCase();

  const reviewRoleMatch = sessionName.match(new RegExp(`^agent-${issuePattern}-review(?:-[a-z]+)?$`, 'i'));
  if (reviewRoleMatch) return reviewRoleMatch[1]!.toUpperCase();

  const reviewMatch = sessionName.match(new RegExp(`^review-(?:coordinator-)?${issuePattern}-\\d+(?:-[a-z]+)?$`, 'i'));
  if (reviewMatch) return reviewMatch[1]!.toUpperCase();

  return null;
}

function reviewRoleSessionName(issueId: string): string {
  return `agent-${issueId.toLowerCase()}-review`;
}

/** Compute issue ID prefixes that belong to a project. */
function getProjectIssuePrefixes(projectKey: string): string[] {
  const projects = listProjects();
  const project = projects.find(p =>
    p.key === projectKey || (p.config as { name?: string }).name === projectKey
  );
  if (!project) return [];

  const prefixes: string[] = [];
  if (project.config.issue_prefix) {
    prefixes.push(project.config.issue_prefix.toUpperCase());
  }
  if (project.config.issue_prefixes) {
    for (const p of project.config.issue_prefixes) {
      prefixes.push(p.toUpperCase());
    }
  }
  if (prefixes.length === 0) {
    prefixes.push(project.key.toUpperCase().replace(/-/g, ''));
  }
  return prefixes;
}

/** Check if an issue ID belongs to a project by prefix match. */
function issueBelongsToProject(issueId: string, prefixes: string[]): boolean {
  const prefix = issueId.split('-')[0];
  return prefix ? prefixes.includes(prefix.toUpperCase()) : false;
}

/** Map a domain event to a session tree delta. Returns null if not relevant. */
function mapEventToDelta(event: StoredEvent): SessionTreeDelta | null {
  const p = event.payload as Record<string, unknown>;
  const issueId = p['issueId'] as string | undefined;
  if (!issueId) return null;

  switch (event.type) {
    case 'agent.started': {
      const agentId = p['agentId'] as string | undefined;
      if (!agentId) return null;
      return { kind: 'session_added', issueId, sessionId: agentId, timestamp: event.timestamp };
    }
    case 'agent.stopped': {
      const agentId = p['agentId'] as string | undefined;
      if (!agentId) return null;
      return { kind: 'session_removed', issueId, sessionId: agentId, timestamp: event.timestamp };
    }
    case 'agent.status_changed': {
      const agentId = p['agentId'] as string | undefined;
      const status = p['status'] as string | undefined;
      if (!agentId || !status) return null;
      const presence: SessionNodePresence = status === 'stopped' || status === 'error'
        ? 'ended'
        : status === 'running'
          ? 'active'
          : 'idle';
      return {
        kind: 'status_changed',
        issueId,
        sessionId: agentId,
        status: status as AgentStatus,
        presence,
        timestamp: event.timestamp,
      };
    }
    case 'specialist.started': {
      const name = p['name'] as string | undefined;
      const currentIssue = p['currentIssue'] as string | undefined;
      if (!name) return null;
      return {
        kind: 'session_added',
        issueId: currentIssue || issueId,
        sessionId: name,
        timestamp: event.timestamp,
      };
    }
    case 'specialist.completed':
    case 'specialist.failed': {
      const name = p['name'] as string | undefined;
      if (!name) return null;
      return { kind: 'session_removed', issueId, sessionId: name, timestamp: event.timestamp };
    }
    case 'pipeline.review-started': {
      return {
        kind: 'session_added',
        issueId,
        sessionId: reviewRoleSessionName(issueId),
        timestamp: event.timestamp,
      };
    }
    case 'pipeline.review-completed': {
      return {
        kind: 'session_removed',
        issueId,
        sessionId: reviewRoleSessionName(issueId),
        timestamp: event.timestamp,
      };
    }
    case 'planning.started': {
      const sessionName = p['sessionName'] as string;
      return { kind: 'session_added', issueId, sessionId: sessionName, timestamp: event.timestamp };
    }
    default:
      return null;
  }
}

/**
 * Shared singleton poller for tmux presence changes.
 * One interval polls tmux and fans out to all subscribers,
 * avoiding O(subscribers) subprocess QPS.
 */
const sharedPresencePoller: {
  refCount: number;
  interval: NodeJS.Timeout | null;
  knownSessions: Set<string>;
  subscribers: Set<(d: SessionTreeDelta) => void>;
} = {
  refCount: 0,
  interval: null,
  knownSessions: new Set(),
  subscribers: new Set(),
};

function startSharedPresencePoller(): void {
  if (sharedPresencePoller.interval) return;

  const tick = async () => {
    try {
      const sessions = await listSessionNamesAsync();
      const current = new Set(sessions.filter(s => s.trim()));

      for (const s of sharedPresencePoller.knownSessions) {
        if (!current.has(s)) {
          const issueId = extractIssueIdFromSession(s);
          if (issueId) {
            const delta: SessionTreeDelta = {
              kind: 'presence_changed',
              issueId,
              sessionId: s,
              presence: 'ended',
              timestamp: new Date().toISOString(),
            };
            for (const sub of sharedPresencePoller.subscribers) {
              try { sub(delta); } catch { /* ignore subscriber errors */ }
            }
          }
        }
      }

      sharedPresencePoller.knownSessions = current;
    } catch { /* tmux may not be available, ignore */ }
  };

  sharedPresencePoller.interval = setInterval(tick, 2000);
  tick();
}

function stopSharedPresencePoller(): void {
  if (sharedPresencePoller.interval) {
    clearInterval(sharedPresencePoller.interval);
    sharedPresencePoller.interval = null;
  }
  sharedPresencePoller.knownSessions.clear();
}

/**
 * Create a stream that subscribes to the shared presence poller.
 * Tracks tmux session existence and emits presence_changed deltas when
 * sessions disappear (→ ended).
 *
 * NOTE: The poller only emits on session *disappearance* (ended), not on
 * session *appearance*. New sessions are discovered via the event stream
 * (session_added deltas) or the next periodic snapshot refetch. This is
 * intentional — the event stream handles arrivals, and the poller handles
 * cleanup of stale presence state.
 */
function createPresencePollStream(): Stream.Stream<SessionTreeDelta, never, never> {
  return Stream.callback<SessionTreeDelta>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        sharedPresencePoller.refCount++;
        if (sharedPresencePoller.refCount === 1) {
          startSharedPresencePoller();
        }

        const subscriber = (d: SessionTreeDelta) => {
          Queue.offerUnsafe(queue, d);
        };
        sharedPresencePoller.subscribers.add(subscriber);
        return subscriber;
      }),
      (subscriber) =>
        Effect.sync(() => {
          sharedPresencePoller.subscribers.delete(subscriber);
          sharedPresencePoller.refCount--;
          if (sharedPresencePoller.refCount === 0) {
            stopSharedPresencePoller();
          }
        }),
    ),
  );
}

// ─── RPC handler layer ────────────────────────────────────────────────────────

const PanRpcLayer = PanRpcGroup.toLayer(
  Effect.gen(function* () {
    const eventStore = yield* EventStoreService;
    const readModel = yield* ReadModelService;
    const terminalService = yield* TerminalService;
    const panOpen = yield* PanOpen;

    return PanRpcGroup.of({
      // ── subscribeDomainEvents ────────────────────────────────────────────────
      [WS_METHODS.subscribeDomainEvents]: (_input) => {
        console.log('[ws-rpc] subscribeDomainEvents invoked');
        return eventStore.streamEvents.pipe(
          Stream.map(storedToDomainEvent),
        );
      },

      // ── subscribeTerminal — live PTY stream (B20) ────────────────────────────
      [WS_METHODS.subscribeTerminal]: (input) =>
        terminalService.streamSession(input.sessionName, input.cols, input.rows),

      // ── subscribeAgentOutput — live agent stdout lines ───────────────────────
      // Filtered view of the domain event stream for a specific agent
      [WS_METHODS.subscribeAgentOutput]: (input) =>
        eventStore.streamEvents.pipe(
          Stream.filter(
            (e) => e.type === 'agent.output_received' &&
              (e.payload as Record<string, unknown>)['agentId'] === input.agentId,
          ),
          Stream.flatMap((e) => {
            const payload = e.payload as { agentId: string; lines: string[] };
            return Stream.fromIterable(
              payload.lines.map((line) => ({ agentId: payload.agentId, line })),
            );
          }),
        ),

      // ── getSnapshot — returns clean read model data (PAN-433) ─────────────────
      [WS_METHODS.getSnapshot]: (_input) =>
        Effect.gen(function* () {
          const t0 = Date.now();
          console.log('[ws-rpc] getSnapshot invoked');
          const snapshot = yield* readModel.getSnapshot;
          const issuesLen = Array.isArray(snapshot.issues) ? snapshot.issues.length : 'none';
          const agentsLen = Array.isArray(snapshot.agents) ? snapshot.agents.length : 'none';
          console.log(`[ws-rpc] getSnapshot resolved in ${Date.now() - t0}ms — agents=${agentsLen} issues=${issuesLen} seq=${snapshot.sequence}`);
          return snapshot;
        }).pipe(
          Effect.mapError(
            (cause) =>
              new PanRpcError({
                message: `Failed to build dashboard snapshot: ${String(cause)}`,
                code: 'SNAPSHOT_FAILED',
              }),
          ),
        ),

      // ── replayEvents ─────────────────────────────────────────────────────────
      [WS_METHODS.replayEvents]: (input) =>
        eventStore.readFrom(input.fromSequence).pipe(
          Effect.map((stored) => stored.map(storedToDomainEvent)),
          Effect.mapError(
            (cause) =>
              new PanRpcError({
                message: `Failed to replay events: ${String(cause)}`,
                code: 'REPLAY_FAILED',
              }),
          ),
        ),

      // ── terminalOpen — live PTY (B20) ───────────────────────────────────────
      [WS_METHODS.terminalOpen]: (input) =>
        terminalService.open(input.sessionName, input.cols, input.rows),

      // ── terminalWrite — live PTY (B20) ──────────────────────────────────────
      [WS_METHODS.terminalWrite]: (input) =>
        terminalService.write(input.sessionName, input.data),

      // ── terminalResize — live PTY (B20) ─────────────────────────────────────
      [WS_METHODS.terminalResize]: (input) =>
        terminalService.resize(input.sessionName, input.cols, input.rows),

      // ── terminalClose — live PTY (B20) ──────────────────────────────────────
      [WS_METHODS.terminalClose]: (input) =>
        terminalService.close(input.sessionName),

      // ── subscribeConversationMessages — live JSONL stream (PAN-451) ──────────
      [WS_METHODS.subscribeConversationMessages]: (input) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const conv = getConversationByName(input.conversationName);

            const sessionFile = conv?.claudeSessionId
              ? sessionFilePath(conv.cwd, conv.claudeSessionId)
              : conv?.sessionFile ?? null;

            if (!sessionFile) {
              // Session file not yet discovered — emit a single discovering event
              return Stream.make<ConversationEvent>({ kind: 'discovering' });
            }

            return Stream.callback<ConversationEvent, PanRpcError>((queue) =>
              Effect.acquireRelease(
                Effect.promise(async () => {
                  // Emit current state immediately on subscribe
                  const initial = await parseConversationMessages(sessionFile, 0);
                  Queue.offerUnsafe(queue, {
                    kind: 'messages' as const,
                    messages: initial.messages,
                    workLog: initial.workLog,
                    streaming: initial.streaming,
                    proposedPlan: initial.proposedPlan,
                    compactBoundaries: initial.compactBoundaries.length > 0 ? initial.compactBoundaries : undefined,
                  });

                  // Watch for new content and stream incremental updates
                  let byteOffset = initial.byteOffset;
                  const handle = watchConversation(sessionFile, (result) => {
                    byteOffset = result.byteOffset;
                    Queue.offerUnsafe(queue, {
                      kind: 'messages' as const,
                      messages: result.messages,
                      workLog: result.workLog,
                      streaming: result.streaming,
                      proposedPlan: result.proposedPlan,
                      compactBoundaries: result.compactBoundaries.length > 0 ? result.compactBoundaries : undefined,
                    });
                  });

                  return handle;
                }),
                (handle) =>
                  Effect.sync(() => {
                    handle.stop();
                  }),
              ),
            );
          }),
        ),

      // ── subscribeProjectSessionTree — live session tree deltas (PAN-821) ─────
      [WS_METHODS.subscribeProjectSessionTree]: (input) =>
        Effect.gen(function* () {
          const prefixes = getProjectIssuePrefixes(input.projectKey);

          const eventDeltas = eventStore.streamEvents.pipe(
            Stream.map(mapEventToDelta),
            Stream.filter((d): d is SessionTreeDelta => d !== null),
            Stream.filter(d => issueBelongsToProject(d.issueId, prefixes)),
          );

          const pollDeltas = createPresencePollStream().pipe(
            Stream.filter(d => issueBelongsToProject(d.issueId, prefixes)),
          );

          return Stream.merge(eventDeltas, pollDeltas);
        }).pipe(Stream.unwrap),

      // ── shellOpenInEditor — open workspace in editor (PAN-966) ──────────────
      [WS_METHODS.shellOpenInEditor]: (input) =>
        panOpen.openInEditor(input),

      // ── getAvailableEditors — list detected editors (PAN-966) ───────────────
      [WS_METHODS.getAvailableEditors]: () =>
        panOpen.getAvailableEditors().pipe(
          Effect.map((editors) => ({ editors })),
        ),

      [WS_METHODS.scanConversations]: (input) =>
        Effect.promise(async () => {
          const config = await getConversationsConfigAsync();
          await Effect.runPromise(eventStore.appendAsync({
            type: 'scan.started',
            timestamp: new Date().toISOString(),
            payload: { mode: input.mode, dirs: input.dirs ?? [] },
          } as ScanStartedEvent));
          let lastProgressEmit = 0;
          const result = await runDashboardDbJob<{
            inserted: number;
            updated: number;
            skipped: number;
            errors: number;
            durationMs: number;
          }>('scanConversations', {
            mode: input.mode,
            dirs: input.dirs,
            dryRun: input.dryRun,
            watchDirs: config.watchDirs,
            maxParallel: config.scanMaxParallel,
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
            await Effect.runPromise(eventStore.appendAsync({
              type: 'scan.progress',
              timestamp: new Date().toISOString(),
              payload: progress,
            } as ScanProgressEvent));
          });
          await Effect.runPromise(eventStore.appendAsync({
            type: 'scan.complete',
            timestamp: new Date().toISOString(),
            payload: {
              inserted: result.inserted,
              updated: result.updated,
              skipped: result.skipped,
              errors: result.errors,
              durationMs: result.durationMs,
            },
          } as ScanCompleteEvent));
          return result;
        }),

      [WS_METHODS.searchConversations]: (input) =>
        Effect.promise(async () => {
          const config = await getConversationsConfigAsync();
          const filter = normalizeConversationFilter(input);
          try {
            const result = await runDashboardDbJob<SearchResult>('searchSessions', {
              q: input.semantic === true ? undefined : input.query,
              semanticQuery: input.semantic === true ? input.query : undefined,
              similarTo: input.similarTo,
              filter,
              limit: input.limit,
              offset: input.offset,
              config,
            });
            return {
              ...result,
              sessions: result.sessions.map(toDiscoveredSessionSnapshot),
            };
          } catch (err) {
            if (input.semantic === true) {
              return {
                sessions: [],
                total: 0,
                mode: 'semantic',
                durationMs: 0,
                error: err instanceof Error ? err.message : String(err),
              };
            }
            throw err;
          }
        }),

      [WS_METHODS.listDiscoveredSessions]: (input) =>
        Effect.promise(async () => {
          const filter = normalizeConversationFilter(input);
          const { sessions, total } = await runDashboardDbJob<{ sessions: DiscoveredSession[]; total: number }>('listDiscoveredSessions', filter);
          return { sessions: sessions.map(toDiscoveredSessionSnapshot), count: sessions.length, total };
        }),

      [WS_METHODS.getDiscoveredSession]: (input) =>
        Effect.promise(async () => {
          const session = await runDashboardDbJob<DiscoveredSession | null>('getDiscoveredSessionById', input.id);
          if (!session) {
            throw new PanRpcError({ message: `Session ${input.id} not found`, code: 'NOT_FOUND' });
          }
          return toDiscoveredSessionSnapshot(session);
        }).pipe(
          Effect.mapError((cause) => cause instanceof PanRpcError
            ? cause
            : new PanRpcError({ message: String(cause), code: 'GET_DISCOVERED_SESSION_FAILED' })),
        ),

      [WS_METHODS.enrichSessions]: (input) =>
        Effect.promise(async () => {
          const config = await getConversationsConfigAsync();
          try {
            const result = await runDashboardDbJob<{
              enriched: number;
              errors: number;
              estimatedCost: number;
              actualCost: number | null;
              durationMs: number;
            }>('enrichSessions', {
              tier: input.level,
              sessionIds: input.ids,
              filter: input.filter,
              limit: input.limit,
              maxParallel: config.enrichment.maxParallel,
              modelOverride: input.model,
              promptSuffix: input.customPrompt,
              skipAlreadyEnriched: input.upgrade !== true,
              force: input.confirmed === true || input.force === true,
              config,
            }, async (rawProgress) => {
              const progress = rawProgress as {
                session?: { sessionId: number; tier: number; model: string; cost?: number; success: boolean; error?: string };
              };
              if (!progress.session) return;
              const { session } = progress;
              await Effect.runPromise(eventStore.appendAsync({
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
              } as EnrichProgressEvent));
            });
            const processed = result.enriched + result.errors;
            await Effect.runPromise(eventStore.appendAsync({
              type: 'enrich.complete',
              timestamp: new Date().toISOString(),
              payload: { processed, totalCost: result.actualCost ?? result.estimatedCost, failures: result.errors, durationMs: result.durationMs },
            } as EnrichCompleteEvent));
            return { processed, totalCost: result.actualCost ?? result.estimatedCost, failures: result.errors };
          } catch (err) {
            if (err instanceof CostThresholdError) {
              throw new PanRpcError({
                message: err.message,
                code: `COST_THRESHOLD:${err.estimatedCost}:${err.threshold}:${err.sessionCount}`,
              });
            }
            throw err;
          }
        }),

      [WS_METHODS.embedSessions]: (input) =>
        Effect.promise(async () => {
          const config = await getConversationsConfigAsync();
          const result = await runDashboardDbJob<{ embedded: number; skipped: number; errors: number }>('embedSessions', {
            sessionIds: input.ids,
            regenerate: input.regenerate,
            config,
          }, async (rawProgress) => {
            const progress = rawProgress as {
              session?: { sessionId: number; model: string; success: boolean; error?: string };
            };
            if (!progress.session) return;
            await Effect.runPromise(eventStore.appendAsync({
              type: 'embed.progress',
              timestamp: new Date().toISOString(),
              payload: progress.session,
            } as EmbedProgressEvent));
          });
          return { total: result.embedded + result.skipped + result.errors, embedded: result.embedded, model: config.embeddingModel };
        }),

      [WS_METHODS.getConversationCost]: (input) =>
        Effect.promise(async () => runDashboardDbJob('aggregateDiscoveredSessionCost', normalizeConversationFilter(input))),

      [WS_METHODS.getConversationStats]: () =>
        Effect.promise(async () => runDashboardDbJob('getDiscoveredStats')),
    });
  }),
);

// ─── WebSocket route layer ────────────────────────────────────────────────────

/**
 * Layer that registers GET /ws/rpc as the WebSocket RPC endpoint.
 * The transport layer (WsRpcLayer + RpcSerialization.layerJson) is
 * provided inline so only ServerConfig leaks into the outer composition.
 */
export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(PanRpcGroup).pipe(
      Effect.provide(
        Layer.mergeAll(
          PanRpcLayer,
          RpcSerialization.layerJson,
        ),
      ),
    );

    return HttpRouter.add('GET', '/ws/rpc', Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const originCheck = validateOrigin(request);
      if (!originCheck.ok) {
        return jsonResponse({ error: originCheck.error }, { status: 403 });
      }
      const authError = rejectUnauthorizedDashboardRequest(request);
      if (authError) return authError;
      return yield* rpcWebSocketHttpEffect;
    }));
  }),
);
