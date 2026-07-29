/**
 * PAN-1990: projects/workspaces/project_targets/pinned_docs are added to
 * overdeck.db via the idempotent runtime top-up in src/lib/overdeck/infra.ts
 * (ensureWorkspaceTablesSync), not a Drizzle migration — see the same pattern
 * for release_sets (PAN-399) and uat_generation_repos (PAN-3093). These tests
 * cover the schema-level invariants the src/lib/workspaces/ writer.test.ts /
 * resolver.test.ts suites exercise only indirectly through the JS API.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('workspace tables top-up (PAN-1990)', () => {
  it('creates all four new tables and the workspace_id column on conversations', () => {
    const db = odb.raw();

    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('projects', 'workspaces', 'project_targets', 'pinned_docs')
      ORDER BY name
    `).all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(['pinned_docs', 'project_targets', 'projects', 'workspaces']);

    const conversationColumns = db.prepare('PRAGMA table_info(conversations)').all() as Array<{ name: string }>;
    expect(conversationColumns.map((c) => c.name)).toContain('workspace_id');

    // PAN-1990 AC-1/FR-4: agents.workspace_id must exist on both a fresh
    // database (drizzle/overdeck/0000_overdeck_init.sql) and an upgraded one
    // (this runtime top-up) — see agent-discovery-columns.test.ts for the
    // codec/DDL parity check.
    const agentColumns = db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>;
    expect(agentColumns.map((c) => c.name)).toContain('workspace_id');
  });

  it('rejects a workspace kind outside main/issue/scratch via the CHECK constraint', () => {
    const db = odb.raw();
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
    const db = odb.raw();
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

    expect(() => db.prepare(`
      INSERT INTO project_targets (project_id, path, is_primary, created_at, last_used_at)
      VALUES ('proj-1', '/repo/overdeck-secondary', 0, 2, 2)
    `).run()).not.toThrow();
  });

  it('re-running the top-up against an already-migrated db is a no-op (idempotent)', () => {
    const db = odb.raw();
    // getOverdeckDatabaseSync() already ran the top-up once when odb.raw() first
    // opened the db; calling it again for the same path must not throw.
    expect(() => odb.raw()).not.toThrow();
    const tables = db.prepare(`
      SELECT COUNT(*) as c FROM sqlite_master
      WHERE type = 'table' AND name IN ('projects', 'workspaces', 'project_targets', 'pinned_docs')
    `).get() as { c: number };
    expect(tables.c).toBe(4);
  });
});
