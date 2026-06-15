/**
 * Agent lifecycle projection — write-through transactional boundary (PAN-1908)
 *
 * Every agent lifecycle transition writes the rollback source (state.json)
 * and then commits the authoritative row upsert + event append inside one
 * SQLite transaction. This replaces save-then-append, which a crash could
 * leave out of sync.
 *
 * The transaction runs on the shared panopticon.db connection. After commit,
 * the persisted event is emitted to the event store's subscribers so the
 * in-memory read model stays current.
 */

import { getDatabase } from '../../../lib/database/index.js';
import type { SqliteDatabase } from '../../../lib/database/driver.js';
import { upsertAgentWithDb, type Agent as DbAgent } from '../../../lib/database/agents-db.js';
import { getEventStore, type EventStore, type StoredEvent } from '../event-store.js';
import { agentStateToDbAgent, writeAgentStateJsonSync, type AgentState } from '../../../lib/agents.js';
import { logAgentLifecycleSync } from '../../../lib/persistent-logger.js';
import type { DomainEvent } from '@panctl/contracts';

export interface AgentProjectionResult {
  /** The agents-table row as persisted. */
  agent: DbAgent;
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

function appendEventInTransaction(
  db: SqliteDatabase,
  event: Omit<DomainEvent, 'sequence'>,
): number {
  const record = event as Record<string, unknown>;
  const timestamp = (record['timestamp'] as string) ?? new Date().toISOString();
  const payload = JSON.stringify(record['payload'] ?? {});

  db.prepare(`INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`).run([
    event.type,
    timestamp,
    payload,
  ]);
  const row = db.prepare(`SELECT last_insert_rowid() AS sequence`).get() as
    | { sequence: number }
    | undefined;
  return row?.sequence ?? 0;
}

/**
 * Atomically persist an agent state change and its lifecycle event.
 *
 * 1. Prepares the state (stoppedAt stamping).
 * 2. Writes state.json (rollback source) outside the SQLite tx.
 * 3. Begins a SQLite transaction, upserts the agents row, inserts the event.
 * 4. Commits and emits the stored event to subscribers.
 *
 * @throws If the SQLite transaction is rolled back, neither the row nor the
 *         event is persisted and state.json may be slightly ahead.
 */
export function saveAgentStateAndEmitEvent(
  state: AgentState,
  event: Omit<DomainEvent, 'sequence'>,
): AgentProjectionResult {
  const db = getDatabase();
  const eventStore = getEventStore();
  return saveAgentStateAndEmitEventWithDeps(db, eventStore, state, event);
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
  const oldStatus = state.status;
  prepareAgentStateForSave(state);

  // Rollback source lives on the filesystem; keep it outside the SQLite tx
  // so a tx failure does not corrupt it.
  writeAgentStateJsonSync(state);

  const agent = agentStateToDbAgent(state);

  db.exec('BEGIN IMMEDIATE');
  try {
    upsertAgentWithDb(db, agent);
    const sequence = appendEventInTransaction(db, event);
    db.exec('COMMIT');

    const stored = buildStoredEvent(event, sequence);
    eventStore.emitStored(stored);

    logAgentLifecycleSync(
      state.id,
      `projected ${event.type} (seq=${sequence}) for ${state.id}`,
    );

    return { agent, sequence };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failures; the connection may already be rolled back.
    }
    throw err;
  }
}
