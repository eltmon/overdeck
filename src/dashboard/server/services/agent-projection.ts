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
import { writeAgentStateJsonSync, type AgentState } from '../../../lib/agents.js';
import { WORK_LAUNCHER_GRACE_MS } from '../../../lib/cloister/agent-grace.js';
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

export type AgentStartPlaceholderClaim =
  | { claimed: true }
  | { claimed: false; reason: 'live-session' | 'active-state' };

/**
 * Claim the single in-flight work-spawn slot and project its starting state.
 * The SQLite write lock makes the status check and placeholder insert one
 * operation, so concurrent dashboard requests cannot both launch `pan start`.
 */
export function claimAgentStartPlaceholderWithDeps(
  db: SqliteDatabase,
  eventStore: AgentProjectionEventStore,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
  hasLiveTmuxSession: boolean,
): AgentStartPlaceholderClaim {
  if (hasLiveTmuxSession) return { claimed: false, reason: 'live-session' };

  prepareAgentStateForSave(state);
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(
      `SELECT status, started_at AS startedAt FROM agents WHERE id = ?`,
    ).get(state.id) as { status: string; startedAt: number | null } | undefined;
    const startingWithinGrace = current?.status === 'starting'
      && current.startedAt !== null
      && Date.now() - current.startedAt < WORK_LAUNCHER_GRACE_MS;
    if (current?.status === 'running' || startingWithinGrace) {
      rollbackTransaction(db);
      return { claimed: false, reason: 'active-state' };
    }

    writeAgentStateJsonSync(state);
    const rows = writeProjectionRows(db, state, event);
    db.exec('COMMIT');
    emitCommittedProjection(eventStore, state, event, rows);
    return { claimed: true };
  } catch (err) {
    rollbackTransaction(db);
    throw err;
  }
}

export function claimAgentStartPlaceholderProgram(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
  hasLiveTmuxSession: boolean,
): Effect.Effect<AgentStartPlaceholderClaim> {
  return Effect.sync(() => claimAgentStartPlaceholderWithDeps(
    getOverdeckDatabaseSync(),
    getEventStore(),
    state,
    event,
    hasLiveTmuxSession,
  ));
}

/**
 * Roll back only the placeholder owned by this failed spawn attempt. If the
 * agent has already advanced to a real running state, the compare fails and
 * the successful concurrent launch is left untouched.
 */
export function rollbackAgentStartPlaceholderWithDeps(
  db: SqliteDatabase,
  eventStore: AgentProjectionEventStore,
  placeholder: AgentState,
  fallback: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): boolean {
  prepareAgentStateForSave(fallback);
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare(
      `SELECT status, model, started_at AS startedAt FROM agents WHERE id = ?`,
    ).get(placeholder.id) as { status: string; model: string | null; startedAt: number | null } | undefined;
    const placeholderStartedAt = new Date(placeholder.startedAt).getTime();
    const ownsPlaceholder = current?.status === 'starting'
      && current.model === 'pending-work-spawn'
      && current.startedAt === placeholderStartedAt;
    if (!ownsPlaceholder) {
      rollbackTransaction(db);
      return false;
    }

    writeAgentStateJsonSync(fallback);
    const rows = writeProjectionRows(db, fallback, event);
    db.exec('COMMIT');
    emitCommittedProjection(eventStore, fallback, event, rows);
    return true;
  } catch (err) {
    rollbackTransaction(db);
    throw err;
  }
}

export function rollbackAgentStartPlaceholderProgram(
  placeholder: AgentState,
  fallback: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): Effect.Effect<boolean> {
  return Effect.sync(() => rollbackAgentStartPlaceholderWithDeps(
    getOverdeckDatabaseSync(),
    getEventStore(),
    placeholder,
    fallback,
    event,
  ));
}
