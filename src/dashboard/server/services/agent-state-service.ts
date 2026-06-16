/**
 * AgentStateService — canonical in-memory runtime state for all agents (PAN-800)
 *
 * Source of truth: SubscriptionRef<Record<AgentId, AgentRuntimeSnapshot>> derived
 * from folding agent.* runtime events out of the append-only event store.
 *
 *   writers                             canonical state                readers
 *   -------                             ---------------                -------
 *   hooks → POST /api/agents/:id/heartbeat
 *   specialists → emit()                EventStore.appendAsync         .get(id) / .changes
 *                                           ↓ subscribe                 → route handlers
 *                                        SubscriptionRef                 deacon, UI
 *
 * Invariants:
 * - The Record inside the ref is only ever mutated via the shared reducer
 *   (packages/contracts/src/event-reducers.ts). Never set directly.
 * - `emit()` MUST route through `appendAsync`, never `emitOnly`. emitOnly
 *   assigns sequence=-1 which would regress `updatedAtSequence` and break the
 *   Math.max(state.sequence, event.sequence) invariant in the shared reducer.
 * - `readFileSync` is forbidden — bootstrap uses `fs.promises.readFile` for
 *   the one-time runtime.json migration fallback.
 */

import { Effect, Layer, Context, Stream, SubscriptionRef } from 'effect';
import {
  applyEvent as applyReducerEvent,
  INITIAL_READ_MODEL_STATE,
} from '@panctl/contracts';
import type {
  AgentRuntimeSnapshot,
  DomainEvent,
} from '@panctl/contracts';
import { initEventStore } from '../event-store.js';
import { getDatabase } from '../../../lib/database/index.js';
import type { StoredEvent } from '../event-store.js';
import { setAgentRuntimeMirror, getRuntimeSnapshot as getMirrorSnapshot, markAgentStateServiceInProcess } from '../../../lib/agent-runtime-mirror.js';

// ─── Event filtering ──────────────────────────────────────────────────────────

/**
 * Event types that affect AgentRuntimeSnapshot. Keep in sync with
 * `packages/contracts/src/event-reducers.ts` — every case that writes
 * `agentRuntimeById` must appear here.
 */
const RUNTIME_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent.activity_changed',
  'agent.thinking_started',
  'agent.thinking_stopped',
  'agent.waiting_started',
  'agent.waiting_cleared',
  'agent.message_received',
  'agent.model_set',
  'agent.current_issue_set',
  'agent.resolution_changed',
  'agent.context_saturation_changed',
  'agent.state_restored',
  // Lifecycle event: pan kill bypasses the Stop hook, so the reducer folds
  // agent.stopped into the runtime snapshot to prevent "idle forever" ghosts.
  'agent.stopped',
]);

function isRuntimeEvent(e: { type: string }): boolean {
  return RUNTIME_EVENT_TYPES.has(e.type);
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface AgentStateServiceShape {
  /** Latest snapshot for a single agent, or undefined if unknown. */
  readonly get: (id: string) => Effect.Effect<AgentRuntimeSnapshot | undefined>;
  /** Full map of agent → snapshot. */
  readonly getAll: Effect.Effect<Record<string, AgentRuntimeSnapshot>>;
  /** Stream of every new snapshot map. Emits whenever any agent updates. */
  readonly changes: Stream.Stream<Record<string, AgentRuntimeSnapshot>>;
  /**
   * Emit a runtime event. Routes through EventStore.appendAsync — the event
   * becomes durable before the returned Effect completes. Never blocks the
   * event loop; hooks that POST through this path stay non-blocking.
   */
  readonly emit: (
    event: Omit<DomainEvent, 'sequence'>,
  ) => Effect.Effect<void>;
}

export class AgentStateService extends Context.Service<
  AgentStateService,
  AgentStateServiceShape
>()('panopticon/dashboard/AgentStateService') {}

// ─── Live implementation ──────────────────────────────────────────────────────

// Re-export the cross-process-safe mirror accessor.
export const getRuntimeSnapshot = getMirrorSnapshot;

export const AgentStateServiceLive = Layer.effect(
  AgentStateService,
  Effect.gen(function* () {
    // Flag lib-side adapters to prefer the in-process mirror over HTTP.
    // Without this, agent-enrichment / ReadModel bootstrap would fetch() our
    // own HTTP server before it finished listening — a circular deadlock.
    yield* markAgentStateServiceInProcess();
    const store = yield* Effect.promise(() => initEventStore());
    const ref = yield* SubscriptionRef.make<Record<string, AgentRuntimeSnapshot>>({});

    // ── Bootstrap from sources (PAN-1920) ───────────────────────────────────
    // Reconstruct runtime snapshots from state.json + tmux in a background fork
    // so the dashboard port binds fast. The merge keeps any live events that
    // arrived during the fork (they have a higher sequence than reconstruction).
    const seedFromSources = Effect.gen(function* () {
      const { reconstructCache } = yield* Effect.promise(() =>
        import('../../../lib/reconstruct/reconstruct-cache.js'),
      );
      const result = yield* Effect.promise(() => reconstructCache(getDatabase()));
      const seeded = result.agentRuntimeById;
      if (Object.keys(seeded).length > 0) {
        yield* SubscriptionRef.update(ref, (current) =>
          mergeRuntimeBySequence(current, seeded),
        );
        yield* setAgentRuntimeMirror(yield* SubscriptionRef.get(ref));
        console.log(
          `[AgentStateService] Bootstrapped ${Object.keys(seeded).length} runtime snapshot(s) from sources`,
        );
      }
    });
    yield* Effect.forkDetach(seedFromSources);

    // ── Subscribe forward ────────────────────────────────────────────────────
    // No unsubscribe — the service lives for the whole dashboard process.
    store.subscribe((ev) => {
      if (!isRuntimeEvent(ev)) return;
      Effect.runFork(applyEventToRef(ref, ev));
    });

    return {
      get: (id) =>
        SubscriptionRef.get(ref).pipe(Effect.map((m) => m[id])),
      getAll: SubscriptionRef.get(ref),
      changes: SubscriptionRef.changes(ref),
      emit: (event) =>
        Effect.promise(() =>
          store.appendAsync(event as Omit<DomainEvent, 'sequence'>),
        ).pipe(Effect.asVoid),
    };
  }),
);

// ─── Internals ────────────────────────────────────────────────────────────────

function mergeRuntimeBySequence(
  current: Record<string, AgentRuntimeSnapshot>,
  reconstructed: Record<string, AgentRuntimeSnapshot>,
): Record<string, AgentRuntimeSnapshot> {
  const merged: Record<string, AgentRuntimeSnapshot> = { ...reconstructed };
  for (const [id, snap] of Object.entries(current)) {
    const recon = reconstructed[id];
    if (!recon) {
      merged[id] = snap;
      continue;
    }
    const currentSeq = snap.updatedAtSequence ?? -1;
    const reconSeq = recon.updatedAtSequence ?? 0;
    if (currentSeq >= reconSeq) {
      merged[id] = snap;
    }
  }
  return merged;
}

function applyEventToRef(
  ref: SubscriptionRef.SubscriptionRef<Record<string, AgentRuntimeSnapshot>>,
  ev: StoredEvent,
): Effect.Effect<void> {
  return SubscriptionRef.update(ref, (current) => {
    const fakeState = {
      ...INITIAL_READ_MODEL_STATE,
      agentRuntimeById: current,
    };
    const nextState = applyReducerEvent(fakeState, ev as unknown as DomainEvent);
    const next = nextState.agentRuntimeById;

    Effect.runSync(setAgentRuntimeMirror(next));
    return next;
  });
}
