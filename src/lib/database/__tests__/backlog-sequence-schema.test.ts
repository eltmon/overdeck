import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_HOME: string;

async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
  const { closeOverdeckDatabaseSync } = await import('../../overdeck/infra.js');
  closeOverdeckDatabaseSync();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-1866-backlog-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('backlog_sequence schema migration (PAN-1866)', { timeout: 30_000 }, () => {
  it('creates backlog_sequence table on fresh init', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();
    const cols = db.prepare("PRAGMA table_info(backlog_sequence)").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('issue_id');
    expect(colNames).toContain('rank');
    expect(colNames).toContain('project_key');
    expect(colNames).toContain('condition');
  });

  it('applies v57 migration on a v56 database without disturbing other tables', async () => {
    const { getDatabase } = await import('../index.js');
    const db = getDatabase();

    // Force version back to 56 and drop the backlog_sequence table to simulate v56 state
    db.exec('DROP TABLE IF EXISTS backlog_sequence');
    db.pragma('user_version = 56');

    // Re-run migrations
    const { runMigrations } = await import('../schema.js');
    runMigrations(db);

    // backlog_sequence should now exist
    const cols = db.prepare("PRAGMA table_info(backlog_sequence)").all() as Array<{ name: string }>;
    expect(cols.length).toBeGreaterThan(0);

    // review_status should still exist (pre-existing table not disturbed)
    const rsInfo = db.prepare("PRAGMA table_info(review_status)").all() as Array<{ name: string }>;
    expect(rsInfo.length).toBeGreaterThan(0);
  });
});
