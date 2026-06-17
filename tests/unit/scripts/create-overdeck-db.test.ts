import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase, type SqliteDatabase } from '../../../src/lib/database/driver.js';
import { createOverdeckDatabase, getOverdeckDatabasePath, OVERDECK_TABLE_COUNT } from '../../../scripts/create-overdeck-db.js';

const previousHome = process.env.PANOPTICON_HOME;
let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-db-'));
  tempDirs.push(dir);
  return dir;
}

function tableNames(db: SqliteDatabase): string[] {
  return db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all<{ name: string }>()
    .map((row) => row.name);
}

afterEach(() => {
  process.env.PANOPTICON_HOME = previousHome;
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('createOverdeckDatabase', () => {
  it('creates a fresh empty overdeck.db from the locked Drizzle schema', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'overdeck.db');

    const result = createOverdeckDatabase({ dbPath });
    expect(result).toEqual({ dbPath, tableCount: OVERDECK_TABLE_COUNT });

    const db = openDatabase(dbPath);
    try {
      const tables = tableNames(db);
      expect(tables).toHaveLength(24);

      for (const tableName of tables) {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get<{ count: number }>();
        expect(row?.count).toBe(0);
      }
    } finally {
      db.close();
    }
  });

  it('enforces foreign keys when PRAGMA foreign_keys=ON', () => {
    const dir = makeTempDir();
    const dbPath = join(dir, 'overdeck.db');
    createOverdeckDatabase({ dbPath });

    const db = openDatabase(dbPath);
    try {
      db.exec('PRAGMA foreign_keys = ON');

      expect(() =>
        db.prepare(`
          INSERT INTO agents (
            id,
            issue_id,
            role,
            status,
            workspace,
            harness,
            model,
            updated_at
          )
          VALUES ('agent-missing-parent', 'PAN-MISSING', 'work', 'running', '/tmp/workspace', 'codex', 'gpt-5', 0)
        `).run(),
      ).toThrow(/FOREIGN KEY constraint failed/i);
    } finally {
      db.close();
    }
  });

  it('defaults to overdeck.db without modifying panopticon.db', () => {
    const home = makeTempDir();
    process.env.PANOPTICON_HOME = home;
    const panopticonDbPath = join(home, 'panopticon.db');
    writeFileSync(panopticonDbPath, 'legacy database bytes');
    const before = readFileSync(panopticonDbPath, 'utf8');

    const result = createOverdeckDatabase();

    expect(result.dbPath).toBe(getOverdeckDatabasePath());
    expect(readFileSync(panopticonDbPath, 'utf8')).toBe(before);
  });
});
