import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { SCHEMA_VERSION, initSchema, runMigrations } from '../../../../src/lib/database/schema.js';

/**
 * Structural snapshot of every table/index: PRAGMA-derived column/index info
 * rather than raw sqlite_master.sql text, since ALTER TABLE ADD COLUMN and
 * CREATE TABLE store semantically-identical columns as different SQL text.
 * Includes PRAGMA index_list per table (not just index_info) so a dropped
 * UNIQUE or partial-index WHERE predicate shows up as a diff — index_info
 * alone only lists indexed columns, not uniqueness or partiality.
 */
function schemaSnapshot(db: SqliteDatabase): Record<string, unknown> {
  const objects = db.prepare(`
    SELECT name, type FROM sqlite_master
    WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all() as Array<{ name: string; type: string }>;

  const snapshot: Record<string, unknown> = {};
  for (const { name, type } of objects) {
    if (type === 'table') {
      snapshot[`table:${name}`] = db.prepare(`PRAGMA table_info(${name})`).all();
      snapshot[`table-indexes:${name}`] = db.prepare(`PRAGMA index_list(${name})`).all();
    } else {
      snapshot[`index:${name}`] = db.prepare(`PRAGMA index_info(${name})`).all();
    }
  }
  return snapshot;
}

describe('projects/workspaces schema (PAN-1990)', () => {
  let db: SqliteDatabase;

  afterEach(() => {
    db.close();
  });

  it('a fresh database creates all four new tables and both workspace_id columns', () => {
    db = openDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    initSchema(db);

    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('projects', 'workspaces', 'project_targets', 'pinned_docs')
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['pinned_docs', 'project_targets', 'projects', 'workspaces']);

    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN (
        'idx_workspace_project', 'idx_workspace_kind', 'idx_workspace_last_accessed',
        'idx_project_targets_one_primary', 'idx_pinned_docs_scope'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual([
      'idx_pinned_docs_scope',
      'idx_project_targets_one_primary',
      'idx_workspace_kind',
      'idx_workspace_last_accessed',
      'idx_workspace_project',
    ]);

    const conversationColumns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>;
    const agentColumns = db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>;
    expect(conversationColumns.map((c) => c.name)).toContain('workspace_id');
    expect(agentColumns.map((c) => c.name)).toContain('workspace_id');
  });

  it('migrating a genuine v63 fixture DB produces a schema structurally identical to a fresh DB', () => {
    const fresh = openDatabase(':memory:');
    fresh.pragma('foreign_keys = ON');
    initSchema(fresh);
    const freshSnapshot = schemaSnapshot(fresh);
    fresh.close();

    // Build a genuine pre-v64 fixture: start from a fresh (v64-shaped) DB, then
    // strip back the exact objects this migration adds, so runMigrations()
    // actually has to (re)create them rather than no-op against existing ones.
    db = openDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    db.exec('DROP TABLE pinned_docs');
    db.exec('DROP TABLE workspaces');
    db.exec('DROP TABLE project_targets');
    db.exec('DROP TABLE projects');
    db.exec('ALTER TABLE conversations DROP COLUMN workspace_id');
    db.exec('ALTER TABLE agents DROP COLUMN workspace_id');
    db.pragma('user_version = 63');

    // Sanity-check the fixture is genuinely pre-migration before trusting the parity assertion.
    const preMigration = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'
    `).get();
    expect(preMigration).toBeUndefined();

    runMigrations(db);

    expect(schemaSnapshot(db)).toEqual(freshSnapshot);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

    // PRAGMA table_info/index_info/index_list don't expose CHECK constraint text,
    // so schema-snapshot equality alone can't prove the migration's hand-copied DDL
    // kept the kind CHECK and the partial-unique predicate. Prove it behaviorally
    // against the MIGRATED db (not just the fresh one AC-3/AC-4 already cover).
    db.prepare(`
      INSERT INTO projects (id, name, primary_path, created_at, last_accessed_at)
      VALUES ('proj-migrated', 'overdeck', '/repo/overdeck-migrated', 1, 1)
    `).run();
    expect(() => db.prepare(`
      INSERT INTO workspaces (id, project_id, kind, name, path, created_at, last_accessed_at)
      VALUES ('ws-migrated', 'proj-migrated', 'bogus', 'test', '/repo/overdeck-migrated', 1, 1)
    `).run()).toThrow();

    db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES ('proj-migrated', '/repo/overdeck-migrated', 1, 1, 1)
    `).run();
    expect(() => db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES ('proj-migrated', '/repo/overdeck-migrated-2', 1, 2, 2)
    `).run()).toThrow();
  });

  it('rejects a workspace kind outside main/issue/scratch via the CHECK constraint', () => {
    db = openDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    initSchema(db);

    db.prepare(`
      INSERT INTO projects (id, name, primary_path, created_at, last_accessed_at)
      VALUES ('proj-1', 'overdeck', '/repo/overdeck', 1, 1)
    `).run();

    expect(() => db.prepare(`
      INSERT INTO workspaces (id, project_id, kind, name, path, created_at, last_accessed_at)
      VALUES ('ws-1', 'proj-1', 'bogus', 'test', '/repo/overdeck', 1, 1)
    `).run()).toThrow();
  });

  it('the partial unique index rejects a second is_primary=1 row for the same project', () => {
    db = openDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    initSchema(db);

    db.prepare(`
      INSERT INTO projects (id, name, primary_path, created_at, last_accessed_at)
      VALUES ('proj-1', 'overdeck', '/repo/overdeck', 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES ('proj-1', '/repo/overdeck', 1, 1, 1)
    `).run();

    expect(() => db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES ('proj-1', '/repo/overdeck-secondary', 1, 2, 2)
    `).run()).toThrow();

    // A second non-primary target for the same project is still fine.
    expect(() => db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES ('proj-1', '/repo/overdeck-secondary', 0, 2, 2)
    `).run()).not.toThrow();
  });
});
