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
 * - `readFileSync` is forbidden — bootstrap uses projection_cache and
 *   `fs.promises.readFile` for the one-time runtime.json migration fallback.
 */

import { Effect, Layer, ServiceMap, Stream, SubscriptionRef } from 'effect';
import {
  applyEvent as applyReducerEvent,
  INITIAL_READ_MODEL_STATE,
} from '@panopticon/contracts';
import type {
  AgentRuntimeSnapshot,
  DomainEvent,
} from '@panopticon/contracts';
import { initEventStore, getSharedDb } from '../event-store.js';
import type { StoredEvent } from '../event-store.js';
import { setAgentRuntimeMirror, getRuntimeSnapshotSync as getMirrorSnapshot, markAgentStateServiceInProcess } from '../../../lib/agent-runtime-mirror.js';

// ─── Event filtering ──────────────────────────────────────────────────────────

const AGENT_RUNTIME_KEY_PREFIX = 'agent-runtime:';

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

export class AgentStateService extends ServiceMap.Service<
  AgentStateService,
  AgentStateServiceShape
>()('panopticon/dashboard/AgentStateService') {}

// ─── Live implementation ──────────────────────────────────────────────────────

// Re-export the cross-process-safe mirror accessor.
export const getRuntimeSnapshotSync = getMirrorSnapshot;

export const AgentStateServiceLive = Layer.effect(
  AgentStateService,
  Effect.gen(function* () {
    // Flag lib-side adapters to prefer the in-process mirror over HTTP.
    // Without this, agent-enrichment / ReadModel bootstrap would fetch() our
    // own HTTP server before it finished listening — a circular deadlock.
    markAgentStateServiceInProcess();
    const store = yield* Effect.promise(() => initEventStore());
    const ref = yield* SubscriptionRef.make<Record<string, AgentRuntimeSnapshot>>({});

    // Prepare projection_cache statements. Same table as the dashboard snapshot
    // cache (key 'dashboard'), different key prefix: `agent-runtime:<agentId>`.
    // Keyed by agentId so stopped agents persist past the 7-day event log
    // compaction — without this the runtime snapshot would vanish at retention.
    const db = getSharedDb();
    const upsertStmt = db.prepare<void>(
      `INSERT INTO projection_cache (key, data, sequence, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         data = excluded.data,
         sequence = excluded.sequence,
         updated_at = excluded.updated_at`,
    );
    const loadAllStmt = db.prepare<{ key: string; data: string; sequence: number }>(
      `SELECT key, data, sequence FROM projection_cache WHERE key LIKE ?`,
    );

    // ── Bootstrap from projection_cache ──────────────────────────────────────
    const seedFromCache = (): Record<string, AgentRuntimeSnapshot> => {
      const seed: Record<string, AgentRuntimeSnapshot> = {};
      try {
        const rows = loadAllStmt.all([`${AGENT_RUNTIME_KEY_PREFIX}%`]);
        for (const row of rows) {
          try {
            const snap = JSON.parse(row.data) as AgentRuntimeSnapshot;
            if (snap && typeof snap.id === 'string') {
              seed[snap.id] = snap;
            }
          } catch {
            // skip malformed row
          }
        }
      } catch (err) {
        console.warn('[AgentStateService] projection_cache bootstrap failed:', err);
      }
      return seed;
    };

    const initial = seedFromCache();
    let maxCachedSequence = 0;
    if (Object.keys(initial).length > 0) {
      for (const snap of Object.values(initial)) {
        if (snap.updatedAtSequence > maxCachedSequence) maxCachedSequence = snap.updatedAtSequence;
      }
      yield* SubscriptionRef.set(ref, initial);
      setAgentRuntimeMirror(initial);
      console.log(
        `[AgentStateService] Bootstrapped ${Object.keys(initial).length} runtime snapshot(s) from projection_cache (seq=${maxCachedSequence})`,
      );
    }

    // ── Replay runtime events NEWER than the cache ────────────────────────────
    // Covers events that appended after the last projection_cache upsert (e.g.
    // server crash before a fold committed). Starting from maxCachedSequence
    // avoids redundantly replaying the entire 7-day event log (~14k events
    // observed in practice) — the projection_cache already captured those.
    try {
      const stored = store.readFrom(maxCachedSequence);
      let replayed = 0;
      for (const ev of stored) {
        if (isRuntimeEvent(ev)) {
          yield* applyEventToRef(ref, ev, upsertStmt);
          replayed++;
        }
      }
      if (replayed > 0) {
        console.log(`[AgentStateService] Replayed ${replayed} runtime event(s) from event log`);
      }
    } catch (err) {
      console.warn('[AgentStateService] event-log replay failed:', err);
    }

    // ── Subscribe forward ────────────────────────────────────────────────────
    // No unsubscribe — the service lives for the whole dashboard process.
    store.subscribe((ev) => {
      if (!isRuntimeEvent(ev)) return;
      Effect.runFork(applyEventToRef(ref, ev, upsertStmt));
    });

    return {
      get: (id) =>
        SubscriptionRef.get(ref).pipe(Effect.map((m) => m[id])),
      getAll: SubscriptionRef.get(ref),
      changes: ref.changes,
      emit: (event) =>
        Effect.promise(() =>
          store.appendAsync(event as Omit<DomainEvent, 'sequence'>),
        ).pipe(Effect.asVoid),
    };
  }),
);

// ─── Internals ────────────────────────────────────────────────────────────────

type UpsertStmt = ReturnType<ReturnType<typeof getSharedDb>['prepare']>;

function applyEventToRef(
  ref: SubscriptionRef.SubscriptionRef<Record<string, AgentRuntimeSnapshot>>,
  ev: StoredEvent,
  upsertStmt: UpsertStmt,
): Effect.Effect<void> {
  return SubscriptionRef.update(ref, (current) => {
    const fakeState = {
      ...INITIAL_READ_MODEL_STATE,
      agentRuntimeById: current,
    };
    const nextState = applyReducerEvent(fakeState, ev as unknown as DomainEvent);
    const next = nextState.agentRuntimeById;

    for (const [id, snap] of Object.entries(next)) {
      if (current[id] === snap) continue;
      try {
        upsertStmt.run([
          `${AGENT_RUNTIME_KEY_PREFIX}${id}`,
          JSON.stringify(snap),
          snap.updatedAtSequence,
          new Date().toISOString(),
        ]);
      } catch (err) {
        console.warn(
          `[AgentStateService] projection_cache upsert failed for ${id}:`,
          err,
        );
      }
    }

    setAgentRuntimeMirror(next);
    return next;
  });
}
