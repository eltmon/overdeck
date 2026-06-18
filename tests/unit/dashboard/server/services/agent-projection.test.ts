/**
 * Tests for agent lifecycle transactional projection (PAN-1908, PAN-1938).
 *
 * Verifies that saveAgentStateAndEmitEvent commits the agents-row upsert and
 * the event append inside one SQLite transaction, preserves absent columns on
 * replay, and is idempotent.
 *
 * PAN-1938: ported from panopticon.db to overdeck.db via setupOverdeckTestDb().
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase } from '../../../../../src/lib/database/driver.js';
import type { StoredEvent } from '../../../../../src/dashboard/server/event-store.js';
import type { AgentState } from '../../../../../src/lib/agents.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  getOverdeckAgentStateSync,
  type OverdeckTestDb,
} from '../../../../helpers/overdeck-test-db.js';

// Mock writeAgentStateJsonSync so tests don't touch the filesystem.
vi.mock('../../../../../src/lib/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/agents.js')>();
  return {
    ...actual,
    writeAgentStateJsonSync: vi.fn(),
  };
});

// Mock logAgentLifecycleSync — fire-and-forget logging.
vi.mock('../../../../../src/lib/persistent-logger.js', () => ({
  logAgentLifecycleSync: vi.fn(),
}));

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  vi.clearAllMocks();
});

// Imports after mocks are registered.
import {
  saveAgentStateAndEmitEventWithDeps,
} from '../../../../../src/dashboard/server/services/agent-projection.js';

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
  return (odb.raw().prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

function readEvents(): Array<{ sequence: number; type: string; payload: string }> {
  return odb.raw().prepare('SELECT sequence, type, payload FROM events ORDER BY sequence ASC').all() as Array<{
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
      odb.raw(),
      eventStore,
      state,
      makeStartedEvent(),
    );

    expect(result.sequence).toBeGreaterThan(0);
    expect(eventStore.emitStored).toHaveBeenCalledTimes(1);

    const row = getOverdeckAgentStateSync('agent-pan-1908');
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

    const first = saveAgentStateAndEmitEventWithDeps(odb.raw(), eventStore, state, event);
    const second = saveAgentStateAndEmitEventWithDeps(odb.raw(), eventStore, state, event);

    expect(second.sequence).toBe(first.sequence + 1);
    expect(countEvents()).toBe(2);

    const row = getOverdeckAgentStateSync('agent-pan-1908');
    expect(row?.status).toBe('running');
  });

  it('persists the full current state even when the event payload is partial', () => {
    const eventStore = { emitStored: vi.fn() };

    // Seed a full agent row.
    saveAgentStateAndEmitEventWithDeps(
      odb.raw(),
      eventStore,
      makeAgentState({
        status: 'running',
        model: 'claude-opus-4-7',
        costSoFar: 5,
      }),
      makeStartedEvent(),
    );

    // Apply a status change whose event payload only carries status and
    // hasLiveTmuxSession. The persisted state still includes the full agent
    // record, so columns absent from the event are not nulled.
    saveAgentStateAndEmitEventWithDeps(
      odb.raw(),
      eventStore,
      makeAgentState({
        status: 'running',
        model: 'claude-opus-4-7',
        costSoFar: 5,
      }),
      makeStatusChangedEvent({
        agentId: 'agent-pan-1908',
        status: 'running',
        hasLiveTmuxSession: true,
      }),
    );

    const row = getOverdeckAgentStateSync('agent-pan-1908');
    expect(row?.status).toBe('running');
    expect(row?.model).toBe('claude-opus-4-7');
    expect(row?.costSoFar).toBe(5);

    // The emitted event is partial; downstream reducers merge it rather than
    // replacing the whole snapshot.
    const emittedPayload = eventStore.emitStored.mock.calls.at(-1)?.[0].payload as Record<string, unknown>;
    expect(emittedPayload['hasLiveTmuxSession']).toBe(true);
    expect(emittedPayload['model']).toBeUndefined();
  });

  it('does not leave row and event log disagreeing when the upsert fails', () => {
    const eventStore = { emitStored: vi.fn() };

    // Create an in-memory db whose agents table rejects any insert so the
    // upsert fails, but the events table exists so we can prove nothing leaked.
    const brokenDb = openDatabase(':memory:');
    brokenDb.exec(`
      CREATE TABLE issues (id TEXT PRIMARY KEY, stage TEXT, updated_at INTEGER);
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status = 'invalid')
      );
      CREATE TABLE events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload TEXT
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
      odb.raw(),
      eventStore,
      makeAgentState({ status: 'running' }),
      makeStartedEvent(),
    );

    saveAgentStateAndEmitEventWithDeps(
      odb.raw(),
      eventStore,
      makeAgentState({ status: 'stopped' }),
      makeStatusChangedEvent({ agentId: 'agent-pan-1908', status: 'stopped' }),
    );

    const row = getOverdeckAgentStateSync('agent-pan-1908');
    expect(row?.status).toBe('stopped');
    expect(row?.stoppedAt).toEqual(expect.any(String));
  });

  it('clears stoppedAt when transitioning back to running', () => {
    const eventStore = { emitStored: vi.fn() };

    saveAgentStateAndEmitEventWithDeps(
      odb.raw(),
      eventStore,
      makeAgentState({ status: 'stopped', stoppedAt: '2026-06-15T10:05:00.000Z' }),
      makeStatusChangedEvent({ agentId: 'agent-pan-1908', status: 'stopped' }),
    );

    saveAgentStateAndEmitEventWithDeps(
      odb.raw(),
      eventStore,
      makeAgentState({ status: 'running' }),
      makeStatusChangedEvent({ agentId: 'agent-pan-1908', status: 'running' }),
    );

    const row = getOverdeckAgentStateSync('agent-pan-1908');
    expect(row?.status).toBe('running');
    expect(row?.stoppedAt).toBeNull();
  });

  it('emits the stored event with the real sequence after commit', () => {
    const emitted: StoredEvent[] = [];
    const eventStore = {
      emitStored: (event: StoredEvent) => emitted.push(event),
    };

    const result = saveAgentStateAndEmitEventWithDeps(
      odb.raw(),
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
