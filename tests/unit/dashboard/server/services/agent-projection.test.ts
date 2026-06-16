/**
 * Tests for agent lifecycle transactional projection (PAN-1908).
 *
 * Verifies that saveAgentStateAndEmitEvent commits the agents-row upsert and
 * the event append inside one SQLite transaction, preserves absent columns on
 * replay, and is idempotent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../../src/lib/database/schema.js';
import type { StoredEvent } from '../../../../../src/dashboard/server/event-store.js';
import type { AgentState } from '../../../../../src/lib/agents.js';

// In-memory DB injection for agents-db and the events table.
let testDb: SqliteDatabase;

vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

vi.mock('../../../../../src/dashboard/server/event-store.js', () => {
  const emitted: StoredEvent[] = [];
  return {
    getEventStore: () => ({
      emitStored: (event: StoredEvent) => emitted.push(event),
    }),
    // Expose the collected events through a module-level getter so tests can
    // inspect them without relying on the singleton store.
    __getEmitted: () => emitted,
  };
});

function getEmittedEvents(): StoredEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = require('../../../../../src/dashboard/server/event-store.js') as any;
  return mod.__getEmitted();
}

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
  vi.clearAllMocks();
});

// Imports after mocks are registered.
import {
  saveAgentStateAndEmitEventWithDeps,
} from '../../../../../src/dashboard/server/services/agent-projection.js';
import { getAgent } from '../../../../../src/lib/database/agents-db.js';

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 'agent-pan-1908',
    issueId: 'PAN-1908',
    workspace: '/tmp/ws',
    role: 'work',
    model: 'claude-sonnet-4-6',
    status: 'running',
    startedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  } as AgentState;
}

function makeStartedEvent(): Record<string, unknown> {
  return {
    type: 'agent.started',
    timestamp: '2026-06-15T10:00:00.000Z',
    payload: {
      agentId: 'agent-pan-1908',
      issueId: 'PAN-1908',
      agent: {
        id: 'agent-pan-1908',
        issueId: 'PAN-1908',
        status: 'running',
      },
    },
  };
}

function makeStatusChangedEvent(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'agent.status_changed',
    timestamp: '2026-06-15T10:01:00.000Z',
    payload,
  };
}

function countEvents(): number {
  return (testDb.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

function readEvents(): Array<{ sequence: number; type: string; payload: string }> {
  return testDb.prepare('SELECT sequence, type, payload FROM events ORDER BY sequence ASC').all() as Array<{
    sequence: number;
    type: string;
    payload: string;
  }>;
}

describe('saveAgentStateAndEmitEventWithDeps', () => {
  it('upserts the agents row and appends the event inside one transaction', () => {
    const eventStore = {
      emitStored: vi.fn(),
    };
    const state = makeAgentState({ status: 'running', costSoFar: 1.23 });

    const result = saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      state,
      makeStartedEvent(),
    );

    expect(result.sequence).toBeGreaterThan(0);
    expect(eventStore.emitStored).toHaveBeenCalledTimes(1);

    const row = getAgent('agent-pan-1908');
    expect(row).not.toBeNull();
    expect(row?.status).toBe('running');
    expect(row?.costSoFar).toBe(1.23);
    expect(row?.issueId).toBe('PAN-1908');

    expect(countEvents()).toBe(1);
    const events = readEvents();
    expect(events[0].type).toBe('agent.started');
    expect(JSON.parse(events[0].payload).agentId).toBe('agent-pan-1908');
  });

  it('returns the same sequence and row when replayed (idempotent)', () => {
    const eventStore = { emitStored: vi.fn() };
    const state = makeAgentState();
    const event = makeStartedEvent();

    const first = saveAgentStateAndEmitEventWithDeps(testDb, eventStore, state, event);
    const second = saveAgentStateAndEmitEventWithDeps(testDb, eventStore, state, event);

    expect(second.sequence).toBe(first.sequence + 1);
    expect(countEvents()).toBe(2);

    const row = getAgent('agent-pan-1908');
    expect(row?.status).toBe('running');
  });

  it('persists the full current state even when the event payload is partial', () => {
    const eventStore = { emitStored: vi.fn() };

    // Seed a full agent row.
    saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState({
        status: 'running',
        model: 'claude-opus-4-7',
        costSoFar: 5,
        branch: 'feature/pan-1908',
      }),
      makeStartedEvent(),
    );

    // Apply a status change whose event payload only carries status and
    // hasLiveTmuxSession. The persisted state still includes the full agent
    // record, so columns absent from the event are not nulled.
    saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState({
        status: 'running',
        model: 'claude-opus-4-7',
        costSoFar: 5,
        branch: 'feature/pan-1908',
      }),
      makeStatusChangedEvent({
        agentId: 'agent-pan-1908',
        status: 'running',
        hasLiveTmuxSession: true,
      }),
    );

    const row = getAgent('agent-pan-1908');
    expect(row?.status).toBe('running');
    expect(row?.model).toBe('claude-opus-4-7');
    expect(row?.costSoFar).toBe(5);
    expect(row?.branch).toBe('feature/pan-1908');

    // The emitted event is partial; downstream reducers merge it rather than
    // replacing the whole snapshot.
    const emittedPayload = eventStore.emitStored.mock.calls.at(-1)?.[0].payload as Record<string, unknown>;
    expect(emittedPayload['hasLiveTmuxSession']).toBe(true);
    expect(emittedPayload['model']).toBeUndefined();
  });

  it('does not leave row and event log disagreeing when the upsert fails', () => {
    const eventStore = { emitStored: vi.fn() };

    // Create a DB where the agents table rejects the status value so the
    // upsert fails, but the events table exists so we can prove nothing leaked.
    const brokenDb = openDatabase(':memory:');
    brokenDb.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status = 'invalid')
      );
      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);

    expect(() =>
      saveAgentStateAndEmitEventWithDeps(
        brokenDb,
        eventStore,
        makeAgentState(),
        makeStartedEvent(),
      ),
    ).toThrow();

    // No event should be persisted and emitStored must not have been called.
    const events = brokenDb.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number };
    expect(events.n).toBe(0);
    expect(eventStore.emitStored).not.toHaveBeenCalled();

    brokenDb.close();
  });

  it('stamps stoppedAt when transitioning to stopped', () => {
    const eventStore = { emitStored: vi.fn() };

    saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState({ status: 'running' }),
      makeStartedEvent(),
    );

    saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState({ status: 'stopped' }),
      makeStatusChangedEvent({ agentId: 'agent-pan-1908', status: 'stopped' }),
    );

    const row = getAgent('agent-pan-1908');
    expect(row?.status).toBe('stopped');
    expect(row?.stoppedAt).toEqual(expect.any(String));
  });

  it('clears stoppedAt when transitioning back to running', () => {
    const eventStore = { emitStored: vi.fn() };

    saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState({ status: 'stopped', stoppedAt: '2026-06-15T10:05:00.000Z' }),
      makeStatusChangedEvent({ agentId: 'agent-pan-1908', status: 'stopped' }),
    );

    saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState({ status: 'running' }),
      makeStatusChangedEvent({ agentId: 'agent-pan-1908', status: 'running' }),
    );

    const row = getAgent('agent-pan-1908');
    expect(row?.status).toBe('running');
    expect(row?.stoppedAt).toBeNull();
  });

  it('emits the stored event with the real sequence after commit', () => {
    const emitted: StoredEvent[] = [];
    const eventStore = {
      emitStored: (event: StoredEvent) => emitted.push(event),
    };

    const result = saveAgentStateAndEmitEventWithDeps(
      testDb,
      eventStore,
      makeAgentState(),
      makeStartedEvent(),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0].sequence).toBe(result.sequence);
    expect(emitted[0].type).toBe('agent.started');
    expect(emitted[0].timestamp).toBe('2026-06-15T10:00:00.000Z');
  });
});
