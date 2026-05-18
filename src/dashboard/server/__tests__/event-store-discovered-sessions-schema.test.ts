import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_HOME: string;

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-457-event-store-schema-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  const { resetDatabase } = await import('../../../lib/database/index.js');
  resetDatabase();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('event-store database startup schema', () => {
  it('opens the dashboard workspace database with discovered-session tables initialized', async () => {
    const { openEventDb } = await import('../event-store.js');

    const db = await openEventDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual')`)
      .all() as Array<{ name: string }>;
    const names = tables.map((table) => table.name);

    expect(names).toContain('discovered_sessions');
    expect(names).toContain('sessions_fts');
    expect(names).toContain('session_embeddings');
  });
});
