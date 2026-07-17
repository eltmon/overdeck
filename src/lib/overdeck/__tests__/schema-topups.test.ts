import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteDatabase } from '../../database/driver.js';
import { closeOverdeckDatabaseSync, getOverdeckDatabaseSync } from '../infra.js';

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
});
