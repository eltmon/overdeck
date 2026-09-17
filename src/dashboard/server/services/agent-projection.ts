/**
 * Agent lifecycle projection — write-through transactional boundary (PAN-1908)
 *
 * Every agent lifecycle transition writes the rollback source (state.json)
 * and then commits the authoritative row upsert + event append inside one
 * SQLite transaction. This replaces save-then-append, which a crash could
 * leave out of sync.
 *
 * The transaction runs on the shared overdeck.db connection (PAN-1938). After
 * commit, the persisted event is emitted to the event store's subscribers so
 * the in-memory read model stays current.
 */

import { Effect } from 'effect';
import type { SqliteDatabase } from '../../../lib/database/driver.js';
import { getOverdeckDatabaseSync } from '../../../lib/overdeck/infra.js';
import { stateToOverdeckParamsForDb, AGENT_COLUMNS_FOR_DB } from '../../../lib/overdeck/agent-state-sync.js';
import { getEventStore, type EventStore, type StoredEvent } from '../event-store.js';
import { getAgentStateSync, writeAgentStateJsonSync, type AgentState } from '../../../lib/agents.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';
import { getWorkspaceForIssue } from '../../../lib/workspaces/resolver.js';
import type { DomainEvent } from '@overdeck/contracts';

export interface AgentProjectionResult {
  /** Assigned event sequence number. */
  sequence: number;
}

function prepareAgentStateForSave(state: AgentState): AgentState {
  if (state.status === 'running' || state.status === 'starting') {
    delete state.stoppedAt;
  } else if (state.status === 'stopped' && !state.stoppedAt) {
    state.stoppedAt = new Date().toISOString();
  }
  return state;
}

function buildStoredEvent(
  event: Omit<DomainEvent, 'sequence'>,
  sequence: number,
): StoredEvent {
  const record = event as Record<string, unknown>;
  return {
    sequence,
    type: event.type,
    timestamp: (record['timestamp'] as string) ?? new Date().toISOString(),
    payload: (record['payload'] as Record<string, unknown>) ?? {},
  };
}

/**
 * Atomically persist an agent state change and its lifecycle event.
 *
 * 1. Prepares the state (stoppedAt stamping).
 * 2. Writes state.json (rollback source) outside the SQLite tx.
 * 3. Begins an overdeck.db transaction, upserts the agents row, inserts the event.
 * 4. Commits and emits the stored event to subscribers.
 *
 * @throws If the SQLite transaction is rolled back, neither the row nor the
 *         event is persisted and state.json may be slightly ahead.
 */
export function saveAgentStateAndEmitEvent(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  const db = getOverdeckDatabaseSync();
  const eventStore = getEventStore();
  return saveAgentStateAndEmitEventWithDeps(db, eventStore, state, event);
}

/**
 * Effect wrapper for server routes. Runs the synchronous projection under
 * Effect.sync so callers in Effect.gen can compose it without blocking.
 */
export function saveAgentStateAndEmitEventProgram(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): Effect.Effect<AgentProjectionResult> {
  return Effect.sync(() => saveAgentStateAndEmitEvent(state, event));
}

/**
 * Dependency-injected variant for tests.
 */
type AgentProjectionEventStore = Pick<EventStore, 'emitStored'>;

type AgentProjectionRows = AgentProjectionResult & {
  stored: StoredEvent;
};

function writeProjectionRows(
  db: SqliteDatabase,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionRows {
  const record = event as Record<string, unknown>;
  const timestamp = (record['timestamp'] as string) ?? new Date().toISOString();
  const timestampMs = new Date(timestamp).getTime();
  // PAN-1990 D-10/WI-11: stamp workspaceId from the projected agent's issueId
  // when the caller didn't already set one — this transactional path bypasses
  // event-store.ts's append()/appendAsync() stamping, so it needs its own.
  const rawPayload = (record['payload'] ?? {}) as Record<string, unknown>;
  const payloadRecord = rawPayload.workspaceId === undefined
    ? { ...rawPayload, workspaceId: getWorkspaceForIssue(state.issueId)?.id }
    : rawPayload;
  const payload = JSON.stringify(payloadRecord);
  const updatedAt = Date.now();

  db.prepare(
    `INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'working', ?)`,
  ).run(state.issueId, updatedAt);
  db.prepare(
    `INSERT OR REPLACE INTO agents (${AGENT_COLUMNS_FOR_DB.join(', ')}) VALUES (${AGENT_COLUMNS_FOR_DB.map(() => '?').join(', ')})`,
  ).run(...stateToOverdeckParamsForDb(state, updatedAt));
  db.prepare(
    `INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`,
  ).run(event.type, timestampMs, payload);

  const row = db.prepare(`SELECT last_insert_rowid() AS sequence`).get() as
    | { sequence: number }
    | undefined;
  const sequence = row?.sequence ?? 0;
  return { sequence, stored: buildStoredEvent({ ...event, payload: payloadRecord }, sequence) };
}

function emitCommittedProjection(
  eventStore: AgentProjectionEventStore,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
  rows: AgentProjectionRows,
): AgentProjectionResult {
  eventStore.emitStored(rows.stored);
  logAgentLifecycleSync(
    state.id,
    `projected ${event.type} (seq=${rows.sequence}) for ${state.id}`,
  );
  return { sequence: rows.sequence };
}

function rollbackTransaction(db: SqliteDatabase): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    // Ignore rollback failures; the connection may already be rolled back.
  }
}

export function saveAgentStateAndEmitEventWithDeps(
  db: SqliteDatabase,
  eventStore: AgentProjectionEventStore,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  prepareAgentStateForSave(state);

  // Rollback source lives on the filesystem; keep it outside the SQLite tx
  // so a tx failure does not corrupt it.
  writeAgentStateJsonSync(state);

  db.exec('BEGIN IMMEDIATE');
  try {
    const rows = writeProjectionRows(db, state, event);
    db.exec('COMMIT');
    return emitCommittedProjection(eventStore, state, event, rows);
  } catch (err) {
    rollbackTransaction(db);
    throw err;
  }
}

// ─── PTY-supervisor lifecycle events (PAN-3849 W33) ─────────────────────────
//
// The PTY supervisor observes the harness process directly (it owns the PTY
// master), so ITS events — not a patrol inferring exit from a missing tmux
// session — are the write source for running/stopped transitions of
// supervisor-launched agents. Every event writes state.json and the agents
// row through the same one-transaction projection above.

export type AgentLifecycleEventName = 'session-started' | 'turn-started' | 'turn-ended' | 'exited';

export interface AgentLifecycleEventInput {
  event: AgentLifecycleEventName;
  at: string;
  exitCode?: number;
}

export type AgentLifecycleApplyResult =
  | { applied: true; status: AgentState['status'] }
  | { applied: false; reason: 'no-state' | 'already-stopped' };

function snapshotFromState(state: AgentState) {
  return {
    id: state.id,
    issueId: state.issueId,
    ...(state.workspace ? { workspace: state.workspace } : {}),
    ...(state.harness ? { runtime: state.harness } : {}),
    ...(state.model ? { model: state.model } : {}),
    status: state.status,
    ...(state.startedAt ? { startedAt: state.startedAt } : {}),
    ...(state.lastActivity ? { lastActivity: state.lastActivity } : {}),
    ...(state.startedBy ? { startedBy: state.startedBy } : {}),
    ...(state.role ? { role: state.role } : {}),
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
  };
}

export function applyAgentLifecycleEventWithDeps(
  db: SqliteDatabase,
  eventStore: AgentProjectionEventStore,
  agentId: string,
  input: AgentLifecycleEventInput,
): AgentLifecycleApplyResult {
  const state = getAgentStateSync(agentId);
  if (!state) return { applied: false, reason: 'no-state' };
  const at = input.at;

  switch (input.event) {
    case 'session-started': {
      // agent.started is emitted HERE — when the harness process actually
      // exists — and nowhere earlier (W34: no placeholder row pre-emits it).
      // A duplicate/late event must not resurrect an agent that already
      // stopped (event retries are not a total order).
      if (state.status === 'stopped') return { applied: false, reason: 'already-stopped' };
      const next: AgentState = { ...state, status: 'running', lastActivity: at };
      saveAgentStateAndEmitEventWithDeps(db, eventStore, next, {
        type: 'agent.started',
        timestamp: at,
        payload: { agentId, issueId: next.issueId, agent: snapshotFromState(next) },
      });
      return { applied: true, status: 'running' };
    }
    case 'turn-started':
    case 'turn-ended': {
      const next: AgentState = { ...state, lastActivity: at };
      saveAgentStateAndEmitEventWithDeps(db, eventStore, next, {
        type: 'agent.activity_changed',
        timestamp: at,
        payload: { agentId, activity: input.event === 'turn-started' ? 'working' : 'idle' },
      });
      return { applied: true, status: next.status };
    }
    case 'exited': {
      const next: AgentState = {
        ...state,
        status: 'stopped',
        stoppedAt: state.stoppedAt ?? at,
        lastActivity: at,
      };
      saveAgentStateAndEmitEventWithDeps(db, eventStore, next, {
        type: 'agent.stopped',
        timestamp: at,
        payload: {
          agentId,
          issueId: next.issueId,
          ...(next.sessionId ? { sessionId: next.sessionId } : {}),
        },
      });
      return { applied: true, status: 'stopped' };
    }
  }
}

export function applyAgentLifecycleEvent(
  agentId: string,
  input: AgentLifecycleEventInput,
): AgentLifecycleApplyResult {
  return applyAgentLifecycleEventWithDeps(
    getOverdeckDatabaseSync(),
    getEventStore(),
    agentId,
    input,
  );
}
