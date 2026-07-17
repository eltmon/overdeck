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

  it('silently tolerates a missing table reported by SQLite', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = getOverdeckDatabaseSync(makeDbPath());

    expect(() =>
      runSchemaTopUp(db, 'ALTER TABLE `missing_schema_topup_table` ADD COLUMN `value` text'),
    ).not.toThrow();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
