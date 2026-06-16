import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { runMigrations } from '../../../../src/lib/database/schema.js';

describe('projection_cache deletion is locked (PAN-1847)', () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('fresh DB built via runMigrations has no projection_cache table', () => {
    runMigrations(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projection_cache'")
      .get();
    expect(row).toBeUndefined();
  });

  it('dashboard server source files contain no projection_cache re-introduction patterns', () => {
    const root = join(process.cwd(), 'src/dashboard/server');
    const files = [
      join(root, 'read-model.ts'),
      join(root, 'event-store.ts'),
      join(root, 'services/agent-state-service.ts'),
    ];

    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      expect(src, `${file} must not reference initProjectionCache`).not.toContain('initProjectionCache');
      expect(src, `${file} must not call .save(buildSnapshot)`).not.toContain('.save(buildSnapshot');
      expect(src, `${file} must not import services/projection-cache`).not.toContain(
        'services/projection-cache',
      );
    }
  });
});
