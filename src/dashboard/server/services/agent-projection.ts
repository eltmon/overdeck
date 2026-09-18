/**
 * Agent lifecycle projection — event emission only (PAN-3917 W6, FR-12).
 *
 * This used to be a write-through transactional boundary: every lifecycle
 * transition wrote `state.json`, upserted the `agents` and `issues` rows in
 * overdeck.db, and appended the event, all in one SQLite transaction, so the
 * three copies could not drift.
 *
 * There are no copies any more. Session liveness and state come from the
 * terminal backend (`services/backend-inventory.ts`), so the mirror rows and
 * the runtime half of `state.json` are gone and nothing needs reconciling.
 * What survives is the event: the dashboard's read model and every subscriber
 * are fed from the event store, and that path is unchanged.
 *
 * `AgentState` is still the argument shape because callers hold one and its
 * permanent fields (issueId, workspace, harness, model, role) are what the
 * event payload carries. Its runtime fields are no longer written anywhere.
 */

import { Effect } from 'effect';
import { getEventStore, type EventStore } from '../event-store.js';
import { getAgentStateSync, type AgentState } from '../../../lib/agents.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';
import { getBackendPanes } from './backend-inventory.js';
import type { DomainEvent } from '@overdeck/contracts';

export interface AgentProjectionResult {
  /** Assigned event sequence number. */
  sequence: number;
}

/** Only the door this module uses, so tests can pass a stub. */
type AgentProjectionEventStore = Pick<EventStore, 'append'>;

/**
 * Append an agent lifecycle event. The event store stamps `workspaceId` and
 * emits to subscribers itself, so this is a thin, named wrapper that also
 * writes the persistent lifecycle log line.
 */
export function saveAgentStateAndEmitEventWithDeps(
  eventStore: AgentProjectionEventStore,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  const sequence = eventStore.append(event);
  logAgentLifecycleSync(
    state.id,
    `projected ${event.type} (seq=${sequence}) for ${state.id}`,
  );
  return { sequence };
}

export function saveAgentStateAndEmitEvent(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  return saveAgentStateAndEmitEventWithDeps(getEventStore(), state, event);
}

/**
 * Effect wrapper for server routes. Runs the synchronous append under
 * Effect.sync so callers in Effect.gen can compose it without blocking.
 */
export function saveAgentStateAndEmitEventProgram(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): Effect.Effect<AgentProjectionResult> {
  return Effect.sync(() => saveAgentStateAndEmitEvent(state, event));
}

// ─── PTY-supervisor lifecycle events (PAN-3849 W33) ─────────────────────────
//
// The PTY supervisor observes the harness process directly (it owns the PTY
// master), so ITS events are the source for running/stopped transitions of
// supervisor-launched agents. Each one appends an event; none of them writes a
// status anywhere.

export type AgentLifecycleEventName = 'session-started' | 'turn-started' | 'turn-ended' | 'exited';

export interface AgentLifecycleEventInput {
  event: AgentLifecycleEventName;
  at: string;
  exitCode?: number;
}

export type AgentLifecycleApplyResult =
  | { applied: true; status: 'running' | 'stopped' | 'unknown' }
  | { applied: false; reason: 'no-state' | 'already-stopped' | 'duplicate' };

/**
 * The event payload's agent snapshot. `status` is the event's own meaning at
 * emission time (agent.started means running), not a status read from a
 * mirror — it is carried because the read model's AgentSnapshot requires it.
 */
function snapshotFromState(state: AgentState, status: 'running' | 'stopped') {
  return {
    id: state.id,
    issueId: state.issueId,
    status,
    ...(state.workspace ? { workspace: state.workspace } : {}),
    ...(state.harness ? { runtime: state.harness } : {}),
    ...(state.model ? { model: state.model } : {}),
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state.startedBy ? { startedBy: state.startedBy } : {}),
    ...(state.role ? { role: state.role } : {}),
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
  };
}

/**
 * Idempotency ring for supervisor retries. The supervisor builds one request
 * body and re-POSTs it after a failure, so a retry carries the same `at` as
 * the already-appended event. This used to be answered by comparing
 * `state.stoppedAt` on the mirror; it is an in-memory dedupe now, because a
 * delivery detail is not a fact worth persisting.
 */
const RECENT_LIFECYCLE_KEYS_MAX = 512;
const recentLifecycleKeys = new Set<string>();

function rememberLifecycleKey(key: string): boolean {
  if (recentLifecycleKeys.has(key)) return false;
  recentLifecycleKeys.add(key);
  if (recentLifecycleKeys.size > RECENT_LIFECYCLE_KEYS_MAX) {
    const oldest = recentLifecycleKeys.values().next().value;
    if (oldest !== undefined) recentLifecycleKeys.delete(oldest);
  }
  return true;
}

/** Test seam: forget the dedupe ring between cases. */
export function _resetAgentLifecycleDedupeForTests(): void {
  recentLifecycleKeys.clear();
}

export interface AgentLifecycleDeps {
  /** Permanent facts for the event payload (issue, workspace, harness, model). */
  readonly readAgentState?: (agentId: string) => AgentState | null;
  /** True when the backend reports this agent's pane already exited. */
  readonly hasExited?: (agentId: string) => Promise<boolean>;
}

async function paneAlreadyExited(agentId: string): Promise<boolean> {
  const panes = await getBackendPanes();
  const pane = panes.find((candidate) => candidate.id === agentId || candidate.terminalId === agentId);
  return pane?.state === 'exited';
}

export async function applyAgentLifecycleEventWithDeps(
  eventStore: AgentProjectionEventStore,
  agentId: string,
  input: AgentLifecycleEventInput,
  deps: AgentLifecycleDeps = {},
): Promise<AgentLifecycleApplyResult> {
  const state = (deps.readAgentState ?? getAgentStateSync)(agentId);
  if (!state) return { applied: false, reason: 'no-state' };
  const at = input.at;

  if (!rememberLifecycleKey(`${agentId}:${input.event}:${at}`)) {
    return { applied: false, reason: 'duplicate' };
  }

  switch (input.event) {
    case 'session-started': {
      // agent.started is emitted HERE — when the harness process actually
      // exists — and nowhere earlier. A late event must not resurrect an agent
      // whose pane the backend already reports as exited.
      if (await (deps.hasExited ?? paneAlreadyExited)(agentId)) {
        return { applied: false, reason: 'already-stopped' };
      }
      saveAgentStateAndEmitEventWithDeps(eventStore, state, {
        type: 'agent.started',
        timestamp: at,
        payload: { agentId, issueId: state.issueId, agent: snapshotFromState(state, 'running') },
      });
      return { applied: true, status: 'running' };
    }
    case 'turn-started':
    case 'turn-ended': {
      saveAgentStateAndEmitEventWithDeps(eventStore, state, {
        type: 'agent.activity_changed',
        timestamp: at,
        payload: { agentId, activity: input.event === 'turn-started' ? 'working' : 'idle' },
      });
      return { applied: true, status: 'unknown' };
    }
    case 'exited': {
      saveAgentStateAndEmitEventWithDeps(eventStore, state, {
        type: 'agent.stopped',
        timestamp: at,
        payload: {
          agentId,
          issueId: state.issueId,
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
        },
      });
      return { applied: true, status: 'stopped' };
    }
  }
}

export function applyAgentLifecycleEvent(
  agentId: string,
  input: AgentLifecycleEventInput,
  deps: AgentLifecycleDeps = {},
): Promise<AgentLifecycleApplyResult> {
  return applyAgentLifecycleEventWithDeps(getEventStore(), agentId, input, deps);
}
