/**
 * Tests for the one-time startup purge of agent.output_received rows (PAN-1925).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_HOME: string;

beforeEach(() => {
  vi.resetModules();
  TEST_HOME = join(tmpdir(), `pan-1925-purge-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  const { resetDatabase } = await import('../../../lib/database/index.js');
  resetDatabase();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('initEventStore agent.output_received purge', () => {
  it('purges pre-existing agent.output_received rows on startup and is idempotent', async () => {
    const { openEventDb, initEventStore } = await import('../event-store.js');

    // Seed agent.output_received rows directly into the DB before init.
    const db = await openEventDb();
    const insert = db.prepare(`INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`);
    for (let i = 0; i < 3; i++) {
      insert.run([
        'agent.output_received',
        new Date().toISOString(),
        JSON.stringify({ agentId: `agent-${i}`, lines: ['line'] }),
      ]);
    }

    // Startup purge runs inside initEventStore.
    const store = await initEventStore();

    // All pre-existing rows should be gone.
    const remaining = store.queryByType('agent.output_received');
    expect(remaining).toHaveLength(0);

    // A second purge is a no-op (idempotent).
    const purgedAgain = store.purgeType('agent.output_received');
    expect(purgedAgain).toBe(0);
  });

  it('leaves other event types intact during the purge', async () => {
    const { openEventDb, initEventStore } = await import('../event-store.js');

    const db = await openEventDb();
    const insert = db.prepare(`INSERT INTO events (type, timestamp, payload) VALUES (?, ?, ?)`);
    insert.run([
      'agent.output_received',
      new Date().toISOString(),
      JSON.stringify({ agentId: 'a', lines: ['line'] }),
    ]);
    insert.run([
      'agent.started',
      new Date().toISOString(),
      JSON.stringify({ agentId: 'a', issueId: 'PAN-1' }),
    ]);

    const store = await initEventStore();

    expect(store.queryByType('agent.output_received')).toHaveLength(0);
    expect(store.queryByType('agent.started')).toHaveLength(1);
  });
});
