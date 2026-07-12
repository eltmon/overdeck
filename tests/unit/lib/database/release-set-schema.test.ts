import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';

describe('release set schema', () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDatabase(':memory:');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates release set tables and indexes idempotently', () => {
    expect(() => initSchema(db)).not.toThrow();

    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('release_sets', 'release_set_components')
      ORDER BY name
    `).all() as Array<{ name: string }>;
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND name IN (
        'idx_release_sets_project',
        'idx_release_set_components_issue_component',
        'idx_release_set_components_issue_order'
      )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(tables.map(row => row.name)).toEqual(['release_set_components', 'release_sets']);
    expect(indexes.map(row => row.name)).toEqual([
      'idx_release_set_components_issue_component',
      'idx_release_set_components_issue_order',
      'idx_release_sets_project',
    ]);
  });

  it('cascades components and rejects duplicate component keys per issue', () => {
    db.prepare(`
      INSERT INTO release_sets (
        issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
      ) VALUES (
        'PAN-399', 'overdeck', '/repo/overdeck', 'polyrepo', 'pending', '2026-07-04T00:00:00.000Z', '2026-07-04T00:00:00.000Z'
      )
    `).run();
    db.prepare(`
      INSERT INTO release_set_components (
        issue_id, component_key, provider, trigger, release_order, required, status
      ) VALUES (
        'PAN-399', 'api', 'kubernetes', 'auto', 0, 1, 'pending'
      )
    `).run();

    expect(() => db.prepare(`
      INSERT INTO release_set_components (
        issue_id, component_key, trigger, release_order
      ) VALUES (
        'PAN-399', 'api', 'manual', 1
      )
    `).run()).toThrow();

    db.prepare(`DELETE FROM release_sets WHERE issue_id = ?`).run('PAN-399');

    const components = db.prepare(`
      SELECT * FROM release_set_components WHERE issue_id = ?
    `).all('PAN-399');
    expect(components).toHaveLength(0);
  });
});
