/**
 * Tests for PAN-1908 cutover safety net:
 *  - v54 → v55 migration snapshots panopticon.db before altering agents data.
 *  - PANOPTICON_NO_RESUME disables event-driven deacon resume/orphan recovery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';

let testDb: SqliteDatabase;
let tmpHome: string;
let originalHome: string | undefined;
let originalNoResume: string | undefined;

vi.mock('../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'pan-safety-net-'));
  originalHome = process.env.PANOPTICON_HOME;
  process.env.PANOPTICON_HOME = tmpHome;
  mkdirSync(join(tmpHome, 'agents'));

  testDb = openDatabase(join(tmpHome, 'panopticon.db'));
  testDb.pragma('foreign_keys = ON');

  originalNoResume = process.env.PANOPTICON_NO_RESUME;
  delete process.env.PANOPTICON_NO_RESUME;
});

afterEach(() => {
  testDb.close();
  rmSync(tmpHome, { recursive: true, force: true });

  if (originalHome === undefined) {
    delete process.env.PANOPTICON_HOME;
  } else {
    process.env.PANOPTICON_HOME = originalHome;
  }

  if (originalNoResume === undefined) {
    delete process.env.PANOPTICON_NO_RESUME;
  } else {
    process.env.PANOPTICON_NO_RESUME = originalNoResume;
  }
});

import { runMigrations } from '../../../../src/lib/database/schema.js';
import {
  handleAgentStoppedEvent,
  handleAgentHeartbeatDeadEvent,
} from '../../../../src/lib/cloister/deacon.js';

describe('v54 → v55 migration safety net', () => {
  it('snapshots panopticon.db before altering agents data', () => {
    testDb.pragma('user_version = 54');
    testDb.exec(`
      CREATE TABLE review_status (
        issue_id TEXT PRIMARY KEY,
        review_status TEXT NOT NULL DEFAULT 'pending',
        updated_at TEXT NOT NULL
      );
    `);

    const snapshotPath = join(tmpHome, 'panopticon.db.v54-backfill-snapshot');
    expect(existsSync(snapshotPath)).toBe(false);

    runMigrations(testDb);

    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = readFileSync(snapshotPath);
    const original = readFileSync(join(tmpHome, 'panopticon.db'));
    expect(snapshot.length).toBeGreaterThan(0);
    expect(original.length).toBeGreaterThanOrEqual(snapshot.length);
  });
});

describe('PANOPTICON_NO_RESUME kill switch', () => {
  it('skips handleAgentStoppedEvent when PANOPTICON_NO_RESUME=1', async () => {
    process.env.PANOPTICON_NO_RESUME = '1';

    const result = await handleAgentStoppedEvent('agent-pan-1908');

    expect(result).toBeNull();
  });

  it('skips handleAgentHeartbeatDeadEvent when PANOPTICON_NO_RESUME=1', async () => {
    process.env.PANOPTICON_NO_RESUME = '1';

    const result = await handleAgentHeartbeatDeadEvent('agent-pan-1908', 'event');

    expect(result).toEqual([]);
  });
});
