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
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';
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
export function saveAgentStateAndEmitEventWithDeps(
  db: SqliteDatabase,
  eventStore: Pick<EventStore, 'emitStored'>,
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  prepareAgentStateForSave(state);

  // Rollback source lives on the filesystem; keep it outside the SQLite tx
  // so a tx failure does not corrupt it.
  writeAgentStateJsonSync(state);

  const record = event as Record<string, unknown>;
  const timestamp = (record['timestamp'] as string) ?? new Date().toISOString();
  const timestampSecs = Math.floor(new Date(timestamp).getTime() / 1000);
  const payload = JSON.stringify(record['payload'] ?? {});
  const updatedAt = Date.now();

  db.exec('BEGIN IMMEDIATE');
  try {
    // Ensure the issues row exists (overdeck FK requirement).
    db.prepare(
      `INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'working', ?)`,
    ).run(state.issueId, updatedAt);

    // Upsert the agents row.
    db.prepare(
      `INSERT OR REPLACE INTO agents (${AGENT_COLUMNS_FOR_DB.join(', ')}) VALUES (${AGENT_COLUMNS_FOR_DB.map(() => '?').join(', ')})`,
    ).run(...stateToOverdeckParamsForDb(state, updatedAt));

    // Append the event. overdeck events.timestamp is integer unix seconds.
    db.prepare(
      `INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`,
    ).run(event.type, timestampSecs, payload);

    const row = db.prepare(`SELECT last_insert_rowid() AS sequence`).get() as
      | { sequence: number }
      | undefined;
    const sequence = row?.sequence ?? 0;
    db.exec('COMMIT');

    const stored = buildStoredEvent(event, sequence);
    eventStore.emitStored(stored);

    logAgentLifecycleSync(
      state.id,
      `projected ${event.type} (seq=${sequence}) for ${state.id}`,
    );

    return { sequence };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures; the connection may already be rolled back.
    }
    throw err;
  }
}
