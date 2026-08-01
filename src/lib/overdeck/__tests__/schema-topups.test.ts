import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SqliteDatabase } from '../../database/driver.js';
import {
  closeOverdeckDatabaseSync,
  getOverdeckDatabaseSync,
  runSchemaTopUp,
} from '../infra.js';

let tempDirs: string[] = [];

function makeDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-schema-topups-'));
  tempDirs.push(dir);
  return join(dir, 'overdeck.db');
}

function costIndexRows(db: SqliteDatabase): Array<{ name: string; sql: string }> {
  return db
    .prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'index'
        AND name IN ('idx_cost_agent_id', 'idx_cost_issue_upper')
      ORDER BY name
    `)
    .all<{ name: string; sql: string }>();
}

afterEach(() => {
  closeOverdeckDatabaseSync();
  vi.restoreAllMocks();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck schema top-ups', () => {
  it('creates cost-event lookup indexes in a fresh database', () => {
    const db = getOverdeckDatabaseSync(makeDbPath());

    expect(costIndexRows(db)).toEqual([
      {
        name: 'idx_cost_agent_id',
        sql: 'CREATE INDEX `idx_cost_agent_id` ON `cost_events` (`agent_id`,`ts`)',
      },
      {
        name: 'idx_cost_issue_upper',
        sql: 'CREATE INDEX `idx_cost_issue_upper` ON `cost_events` (UPPER(`issue_id`))',
      },
    ]);
  });

  it('restores missing cost-event indexes idempotently in an existing database', () => {
    const dbPath = makeDbPath();
    const initial = getOverdeckDatabaseSync(dbPath);
    initial.exec('DROP INDEX IF EXISTS `idx_cost_agent_id`');
    initial.exec('DROP INDEX IF EXISTS `idx_cost_issue_upper`');
    closeOverdeckDatabaseSync();

    const toppedUp = getOverdeckDatabaseSync(dbPath);
    expect(costIndexRows(toppedUp).map((row) => row.name)).toEqual([
      'idx_cost_agent_id',
      'idx_cost_issue_upper',
    ]);
    closeOverdeckDatabaseSync();

    const reopened = getOverdeckDatabaseSync(dbPath);
    expect(costIndexRows(reopened)).toHaveLength(2);
  });

  it('restores review-status top-up columns in an existing database', () => {
    const dbPath = makeDbPath();
    const initial = getOverdeckDatabaseSync(dbPath);
    initial.exec('ALTER TABLE `review_status` DROP COLUMN `strike_transport_retry_count`');
    initial.exec('ALTER TABLE `review_status` DROP COLUMN `strike_next_attempt_at`');
    initial.exec('ALTER TABLE `review_status` DROP COLUMN `uat_status`');
    initial.exec('ALTER TABLE `review_status` DROP COLUMN `uat_notes`');
    closeOverdeckDatabaseSync();

    const toppedUp = getOverdeckDatabaseSync(dbPath);
    const columns = toppedUp
      .prepare('PRAGMA table_info(`review_status`)')
      .all<{ name: string }>()
      .map((column) => column.name);
    expect(columns).toContain('strike_transport_retry_count');
    expect(columns).toContain('strike_next_attempt_at');
    expect(columns).toContain('uat_status');
    expect(columns).toContain('uat_notes');
  });

  it('uses idx_cost_agent_id for the agent daily-cost query', () => {
    const db = getOverdeckDatabaseSync(makeDbPath());
    const plan = db
      .prepare(`
        EXPLAIN QUERY PLAN
        SELECT SUM(cost)
        FROM cost_events
        WHERE agent_id = ? AND ts >= ?
      `)
      .all<{ detail: string }>('agent-pan-2807', 0);

    expect(plan.some((row) => row.detail.includes('idx_cost_agent_id'))).toBe(true);
  });

  it('silently tolerates a duplicate column reported by SQLite', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = getOverdeckDatabaseSync(makeDbPath());

    expect(() => runSchemaTopUp(db, 'ALTER TABLE `agents` ADD COLUMN `id` text')).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs an unexpected SQLite error and continues with the next top-up', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = getOverdeckDatabaseSync(makeDbPath());
    db.exec('CREATE TABLE `schema_topup_probe` (`id` integer)');
    const malformed = 'ALTER TABLE `schema_topup_probe` ADD COLUMN';

    expect(() => runSchemaTopUp(db, malformed)).not.toThrow();
    runSchemaTopUp(db, 'ALTER TABLE `schema_topup_probe` ADD COLUMN `recovered` text');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = errorSpy.mock.calls[0]?.join(' ') ?? '';
    expect(logged).toContain('[schema]');
    expect(logged).toContain(malformed);
    expect(logged).toMatch(/incomplete input|syntax error/i);
    expect(
      db
        .prepare('PRAGMA table_info(`schema_topup_probe`)')
        .all<{ name: string }>()
        .map((column) => column.name),
    ).toContain('recovered');
  });

  it('logs a missing-table top-up failure while startup and later top-ups continue', () => {
    const dbPath = makeDbPath();
    const initial = getOverdeckDatabaseSync(dbPath);
    initial.exec('DROP TABLE `flywheel_substrate_bugs`');
    initial.exec('DROP INDEX `idx_cost_agent_id`');
    closeOverdeckDatabaseSync();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const reopened = getOverdeckDatabaseSync(dbPath);

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('[schema] top-up failed');
    expect(logged).toContain('ALTER TABLE `flywheel_substrate_bugs` ADD COLUMN `affected_criteria` text');
    expect(logged).toMatch(/no such table/i);
    expect(reopened.prepare('SELECT 1 AS ok').get<{ ok: number }>()).toEqual({ ok: 1 });
    expect(costIndexRows(reopened).map((row) => row.name)).toContain('idx_cost_agent_id');
  });
});
