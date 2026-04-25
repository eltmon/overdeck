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
import type { ConversationEvent, DomainEvent } from '@panopticon/contracts';
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
