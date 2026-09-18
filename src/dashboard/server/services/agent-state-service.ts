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
 * - `readFileSync` is forbidden.
 *
 * PAN-3917 (FR-12): the bootstrap seed is the terminal backend's live pane
 * inventory, not a reconstruction from `state.json` plus tmux. There is no
 * persisted runtime mirror to reconstruct from any more.
 */

import { Effect, Layer, Context, Stream, SubscriptionRef } from 'effect';
import {
  applyEvent as applyReducerEvent,
  INITIAL_READ_MODEL_STATE,
} from '@overdeck/contracts';
import type {
  Activity,
  AgentRuntimeSnapshot,
  AgentState,
  DomainEvent,
} from '@overdeck/contracts';
import { initEventStore } from '../event-store.js';
import type { StoredEvent } from '../event-store.js';
import { setAgentRuntimeMirror, getRuntimeSnapshot as getMirrorSnapshot, markAgentStateServiceInProcess } from '../../../lib/agent-runtime-mirror.js';
import { appendSessionIdToHistory } from '../../../lib/session-history.js';
import { getBackendPanes } from './backend-inventory.js';

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
>()('overdeck/dashboard/AgentStateService') {}

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

    // ── Bootstrap from the backend inventory (PAN-3917) ─────────────────────
    // Seed the runtime map from the live pane inventory in a background fork so
    // the dashboard port binds fast. The merge keeps any live events that
    // arrived during the fork (they carry a higher sequence than the seed).
    const seedFromBackend = Effect.gen(function* () {
      const panes = yield* Effect.promise(() => getBackendPanes());
      const seeded: Record<string, AgentRuntimeSnapshot> = {};
      const liveById: Record<string, boolean> = {};
      for (const pane of panes) {
        const id = pane.terminalId ?? pane.id;
        liveById[id] = pane.state !== 'exited';
        seeded[id] = {
          id,
          activity: activityForPaneState(pane.state),
          lastActivity: new Date(pane.stateSince ?? Date.now()).toISOString(),
          ...(pane.model && pane.model !== 'unknown' ? { model: pane.model } : {}),
          ...(pane.harness && pane.harness !== 'unknown' ? { sessionHarness: pane.harness } : {}),
          ...(pane.issue ? { currentIssue: pane.issue } : {}),
          updatedAtSequence: 0,
        } as AgentRuntimeSnapshot;
      }
      if (Object.keys(seeded).length > 0) {
        yield* SubscriptionRef.update(ref, (current) =>
          mergeRuntimeBySequence(current, seeded, liveById),
        );
        yield* setAgentRuntimeMirror(yield* SubscriptionRef.get(ref));
        console.log(
          `[AgentStateService] Seeded ${Object.keys(seeded).length} runtime snapshot(s) from the backend inventory`,
        );
      }
    });
    yield* Effect.forkDetach(seedFromBackend);

    // ── Subscribe forward ────────────────────────────────────────────────────
    // No unsubscribe — the service lives for the whole dashboard process.
    store.subscribe((ev) => {
      if (!isRuntimeEvent(ev)) return;
      // PAN-1989: record a newly-learned Claude session id in the agent's
      // session history. This is the single convergence point — every
      // model_set, hook-emitted or server-emitted, flows through here — so the
      // resume pointer is written the instant it is known, instead of living
      // only in the in-memory snapshot that a restart discards. The state-plane
      // copy of the same list is gone with the record plane (PAN-3917).
      if (ev.type === 'agent.model_set') {
        const payload = (ev as { payload?: { agentId?: string; claudeSessionId?: string } }).payload;
        if (payload?.agentId && payload.claudeSessionId) {
          appendSessionIdToHistory(payload.agentId, payload.claudeSessionId);
        }
      }
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

/** BackendPane state → the read model's Activity vocabulary. */
export function activityForPaneState(state: AgentState): Activity {
  switch (state) {
    case 'working': return 'working';
    case 'blocked': return 'waiting';
    case 'done':
    case 'exited': return 'stopped';
    default: return 'idle';
  }
}

/**
 * Fold the backend seed under whatever live events already arrived. A seeded
 * `stopped` for a pane the backend says is not live always wins: it is the
 * backend's own answer, and a stale in-memory snapshot must not resurrect it.
 */
export function mergeRuntimeBySequence(
  current: Record<string, AgentRuntimeSnapshot>,
  seeded: Record<string, AgentRuntimeSnapshot>,
  liveById: Record<string, boolean>,
): Record<string, AgentRuntimeSnapshot> {
  const merged: Record<string, AgentRuntimeSnapshot> = { ...seeded };
  for (const [id, snap] of Object.entries(current)) {
    const recon = seeded[id];
    if (!recon) {
      merged[id] = snap;
      continue;
    }
    if (recon.activity === 'stopped' && liveById[id] === false) {
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
