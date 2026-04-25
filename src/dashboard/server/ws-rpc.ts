/**
 * WebSocket RPC handlers — implements PanRpcGroup using Effect (PAN-428 B5)
 *
 * Connects the PanRpcGroup contract to the server-side service layer.
 * Terminal RPC methods (subscribeTerminal, terminalOpen/Write/Resize/Close)
 * are implemented via TerminalService (dual-runtime PTY, B20).
 */

import { Effect, Layer, Queue, Stream } from 'effect';
import { HttpRouter } from 'effect/unstable/http';
import { RpcSerialization, RpcServer } from 'effect/unstable/rpc';
import { PanRpcGroup, PanRpcError, WS_METHODS } from '@panopticon/contracts';
import { EventStoreService } from './services/domain-services.js';
import { ReadModelService } from './read-model.js';
import { TerminalService } from './services/terminal-service.js';
import { getConversationByName } from '../../lib/database/conversations-db.js';
import { parseConversationMessages, watchConversation } from './services/conversation-service.js';
import { sessionFilePath } from '../../lib/paths.js';
import { listSessionNamesAsync } from '../../lib/tmux.js';
import { listProjects } from '../../lib/projects.js';
import type { AgentStatus, ConversationEvent, DomainEvent, SessionTreeDelta } from '@panopticon/contracts';
import type { StoredEvent } from './event-store.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function storedToDomainEvent(stored: StoredEvent): DomainEvent {
  return {
    type: stored.type,
    sequence: stored.sequence,
    timestamp: stored.timestamp,
    payload: stored.payload,
  } as DomainEvent;
}

// ─── Session Tree Subscription Helpers (PAN-821) ──────────────────────────────

/** Extract issue ID from a tmux session name. */
function extractIssueIdFromSession(sessionName: string): string | null {
  const agentMatch = sessionName.match(/^(agent|planning)-([a-z0-9-]+)$/);
  if (agentMatch) return agentMatch[2]!.toUpperCase();

  const reviewMatch = sessionName.match(/^review-(?:coordinator-)?([A-Z0-9-]+)-\d+/);
  if (reviewMatch) return reviewMatch[1]!;

  return null;
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
      const agentId = p['agentId'] as string;
      return { kind: 'session_added', issueId, sessionId: agentId, timestamp: event.timestamp };
    }
    case 'agent.stopped': {
      const agentId = p['agentId'] as string;
      return { kind: 'session_removed', issueId, sessionId: agentId, timestamp: event.timestamp };
    }
    case 'agent.status_changed': {
      const agentId = p['agentId'] as string;
      const status = p['status'] as string;
      return {
        kind: 'status_changed',
        issueId,
        sessionId: agentId,
        status: status as AgentStatus,
        timestamp: event.timestamp,
      };
    }
    case 'specialist.started': {
      const specialist = p['specialist'] as Record<string, unknown> | undefined;
      const name = specialist?.['name'] as string;
      const currentIssue = specialist?.['currentIssue'] as string | undefined;
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
      const name = p['name'] as string;
      return { kind: 'session_removed', issueId, sessionId: name, timestamp: event.timestamp };
    }
    case 'pipeline.review-started': {
      return {
        kind: 'session_added',
        issueId,
        sessionId: `review-coordinator-${issueId}`,
        timestamp: event.timestamp,
      };
    }
    case 'pipeline.review-completed': {
      return {
        kind: 'session_removed',
        issueId,
        sessionId: `review-coordinator-${issueId}`,
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

    return PanRpcGroup.of({
      // ── subscribeDomainEvents ────────────────────────────────────────────────
      [WS_METHODS.subscribeDomainEvents]: (_input) =>
        eventStore.streamEvents.pipe(
          Stream.map(storedToDomainEvent),
        ),

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
        readModel.getSnapshot.pipe(
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

    return HttpRouter.add('GET', '/ws/rpc', rpcWebSocketHttpEffect);
  }),
);
