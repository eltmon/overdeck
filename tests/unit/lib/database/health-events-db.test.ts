/**
 * Tests for health-events-db.ts module functions.
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: SqliteDatabase;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  writeHealthEvent,
  writeHealthEvents,
  getHealthHistory,
  getRecentHealthHistory,
  getAllHealthHistory,
  getLatestHealthEvent,
  getAgentsWithHistory,
  cleanupOldHealthEvents,
  deleteAgentHealthHistory,
} from '../../../../src/lib/database/health-events-db.js';

// ============== Helpers ==============

function ts(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function makeEvent(agentId: string, state = 'idle', offsetMs = 0) {
  return {
    agentId,
    timestamp: ts(offsetMs),
    state: state as any,
    previousState: undefined,
    source: undefined,
    metadata: undefined,
  };
}

// ============== writeHealthEvent ==============

describe('writeHealthEvent', () => {
  it('inserts a new event and returns a positive row id', () => {
    const id = writeHealthEvent(makeEvent('agent-1'));
    expect(id).toBeGreaterThan(0);
    const row = testDb.prepare('SELECT * FROM health_events WHERE id = ?').get(id) as any;
    expect(row).toBeTruthy();
    expect(row.agent_id).toBe('agent-1');
    expect(row.state).toBe('idle');
  });

  it('stores optional fields (previousState, source, metadata)', () => {
    const id = writeHealthEvent({
      agentId: 'agent-2',
      timestamp: ts(),
      state: 'working' as any,
      previousState: 'idle',
      source: 'heartbeat',
      metadata: JSON.stringify({ pid: 42 }),
    });
    const row = testDb.prepare('SELECT * FROM health_events WHERE id = ?').get(id) as any;
    expect(row.previous_state).toBe('idle');
    expect(row.source).toBe('heartbeat');
    expect(row.metadata).toBe(JSON.stringify({ pid: 42 }));
  });

  it('allows multiple events for the same agent', () => {
    writeHealthEvent(makeEvent('agent-3', 'idle', 0));
    writeHealthEvent(makeEvent('agent-3', 'working', 100));
    const rows = testDb.prepare('SELECT * FROM health_events WHERE agent_id = ?').all('agent-3');
    expect(rows).toHaveLength(2);
  });
});

// ============== writeHealthEvents ==============

describe('writeHealthEvents', () => {
  it('inserts multiple events in a single transaction and returns count', () => {
    const events = [
      makeEvent('batch-agent', 'idle', 0),
      makeEvent('batch-agent', 'working', 100),
      makeEvent('batch-agent', 'done', 200),
    ];
    const count = writeHealthEvents(events);
    expect(count).toBe(3);
    const rows = testDb.prepare('SELECT * FROM health_events WHERE agent_id = ?').all('batch-agent');
    expect(rows).toHaveLength(3);
  });

  it('returns 0 for an empty array', () => {
    expect(writeHealthEvents([])).toBe(0);
  });
});

// ============== getHealthHistory ==============

describe('getHealthHistory', () => {
  it('returns events within the time range', () => {
    const start = new Date(Date.now() - 10000).toISOString();
    const end = new Date(Date.now() + 10000).toISOString();
    writeHealthEvent(makeEvent('h-agent', 'idle'));
    const results = getHealthHistory('h-agent', start, end);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].agentId).toBe('h-agent');
  });

  it('excludes events outside the time range', () => {
    const futureStart = new Date(Date.now() + 60000).toISOString();
    const futureEnd = new Date(Date.now() + 120000).toISOString();
    writeHealthEvent(makeEvent('h-agent-2', 'idle'));
    const results = getHealthHistory('h-agent-2', futureStart, futureEnd);
    expect(results).toHaveLength(0);
  });

  it('only returns events for the specified agent', () => {
    const start = new Date(Date.now() - 10000).toISOString();
    const end = new Date(Date.now() + 10000).toISOString();
    writeHealthEvent(makeEvent('agent-A', 'idle'));
    writeHealthEvent(makeEvent('agent-B', 'idle'));
    const results = getHealthHistory('agent-A', start, end);
    expect(results.every(r => r.agentId === 'agent-A')).toBe(true);
  });

  it('parses metadata JSON when present', () => {
    const start = new Date(Date.now() - 10000).toISOString();
    const end = new Date(Date.now() + 10000).toISOString();
    writeHealthEvent({
      agentId: 'meta-agent',
      timestamp: ts(),
      state: 'idle' as any,
      metadata: JSON.stringify({ key: 'value' }),
    });
    const results = getHealthHistory('meta-agent', start, end);
    expect(results[0].metadata).toEqual({ key: 'value' });
  });
});

// ============== getRecentHealthHistory ==============

describe('getRecentHealthHistory', () => {
  it('returns empty array when no events', () => {
    expect(getRecentHealthHistory('no-agent')).toEqual([]);
  });

  it('returns most recent events up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      writeHealthEvent(makeEvent('recent-agent', 'idle', i * 100));
    }
    const results = getRecentHealthHistory('recent-agent', 3);
    expect(results).toHaveLength(3);
  });

  it('returns results in ascending timestamp order', () => {
    for (let i = 0; i < 3; i++) {
      writeHealthEvent(makeEvent('order-agent', 'idle', i * 1000));
    }
    const results = getRecentHealthHistory('order-agent');
    for (let i = 1; i < results.length; i++) {
      expect(results[i].timestamp >= results[i - 1].timestamp).toBe(true);
    }
  });
});

// ============== getAllHealthHistory ==============

describe('getAllHealthHistory', () => {
  it('returns events for all agents in range', () => {
    const start = new Date(Date.now() - 10000).toISOString();
    const end = new Date(Date.now() + 10000).toISOString();
    writeHealthEvent(makeEvent('all-agent-1', 'idle'));
    writeHealthEvent(makeEvent('all-agent-2', 'working'));
    const results = getAllHealthHistory(start, end);
    const ids = results.map(r => r.agentId);
    expect(ids).toContain('all-agent-1');
    expect(ids).toContain('all-agent-2');
  });

  it('returns empty array when no events in range', () => {
    const start = new Date(Date.now() + 60000).toISOString();
    const end = new Date(Date.now() + 120000).toISOString();
    const results = getAllHealthHistory(start, end);
    expect(results).toEqual([]);
  });
});

// ============== getLatestHealthEvent ==============

describe('getLatestHealthEvent', () => {
  it('returns null for unknown agent', () => {
    expect(getLatestHealthEvent('no-such-agent')).toBeNull();
  });

  it('returns the most recent event', () => {
    writeHealthEvent(makeEvent('latest-agent', 'idle', 0));
    writeHealthEvent(makeEvent('latest-agent', 'working', 1000));
    writeHealthEvent(makeEvent('latest-agent', 'done', 2000));
    const result = getLatestHealthEvent('latest-agent');
    expect(result).not.toBeNull();
    expect(result!.state).toBe('done');
  });
});

// ============== getAgentsWithHistory ==============

describe('getAgentsWithHistory', () => {
  it('returns empty array when no events', () => {
    expect(getAgentsWithHistory()).toEqual([]);
  });

  it('returns distinct agent IDs sorted alphabetically', () => {
    writeHealthEvent(makeEvent('zebra-agent', 'idle'));
    writeHealthEvent(makeEvent('alpha-agent', 'idle'));
    writeHealthEvent(makeEvent('zebra-agent', 'working'));
    const agents = getAgentsWithHistory();
    expect(agents).toContain('alpha-agent');
    expect(agents).toContain('zebra-agent');
    // Deduplicated
    expect(agents.filter(a => a === 'zebra-agent')).toHaveLength(1);
    // Sorted
    const idx1 = agents.indexOf('alpha-agent');
    const idx2 = agents.indexOf('zebra-agent');
    expect(idx1).toBeLessThan(idx2);
  });
});

// ============== cleanupOldHealthEvents ==============

describe('cleanupOldHealthEvents', () => {
  it('removes events older than retention days', () => {
    // Insert an event with a very old timestamp
    testDb.prepare(
      'INSERT INTO health_events (agent_id, timestamp, state) VALUES (?, ?, ?)'
    ).run('old-agent', new Date(0).toISOString(), 'idle');

    const deleted = cleanupOldHealthEvents(7);
    expect(deleted).toBeGreaterThan(0);

    const remaining = testDb.prepare(
      'SELECT * FROM health_events WHERE agent_id = ?'
    ).all('old-agent');
    expect(remaining).toHaveLength(0);
  });

  it('does not remove recent events', () => {
    writeHealthEvent(makeEvent('new-agent', 'idle'));
    const deleted = cleanupOldHealthEvents(7);
    const remaining = testDb.prepare(
      'SELECT * FROM health_events WHERE agent_id = ?'
    ).all('new-agent');
    expect(remaining).toHaveLength(1);
  });

  it('returns 0 when nothing to delete', () => {
    expect(cleanupOldHealthEvents(7)).toBe(0);
  });
});

// ============== deleteAgentHealthHistory ==============

describe('deleteAgentHealthHistory', () => {
  it('removes all events for the agent', () => {
    writeHealthEvent(makeEvent('del-agent', 'idle'));
    writeHealthEvent(makeEvent('del-agent', 'working'));
    const deleted = deleteAgentHealthHistory('del-agent');
    expect(deleted).toBe(2);
    const rows = testDb.prepare('SELECT * FROM health_events WHERE agent_id = ?').all('del-agent');
    expect(rows).toHaveLength(0);
  });

  it('does not affect other agents', () => {
    writeHealthEvent(makeEvent('del-agent-2', 'idle'));
    writeHealthEvent(makeEvent('keep-agent', 'idle'));
    deleteAgentHealthHistory('del-agent-2');
    const kept = testDb.prepare('SELECT * FROM health_events WHERE agent_id = ?').all('keep-agent');
    expect(kept).toHaveLength(1);
  });

  it('returns 0 when agent has no history', () => {
    expect(deleteAgentHealthHistory('ghost-agent')).toBe(0);
  });
});
