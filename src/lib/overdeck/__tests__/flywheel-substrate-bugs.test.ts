import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../../database/driver.js';
import { createOverdeckDatabase } from '../../../../scripts/create-overdeck-db.js';

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-flywheel-substrate-bugs-test-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('flywheel substrate bugs upgrade path', { timeout: 30_000 }, () => {
  it('adds affected_criteria to an existing overdeck.db that predates the column', async () => {
    const { getOverdeckDatabasePath } = await import('../paths.js');
    const { closeOverdeckDatabaseSync } = await import('../infra.js');

    createOverdeckDatabase();
    const dbPath = getOverdeckDatabasePath();

    // Simulate a database created before PAN-1491: full schema minus affected_criteria.
    const db = openDatabase(dbPath);
    try {
      db.exec('ALTER TABLE `flywheel_substrate_bugs` DROP COLUMN `affected_criteria`');
    } finally {
      db.close();
    }
    closeOverdeckDatabaseSync();

    const { getOverdeckDatabaseSync } = await import('../infra.js');
    const { upsert, getByIssueId, listInWindow } = await import('../flywheel-substrate-bugs.js');

    const opened = getOverdeckDatabaseSync();
    const columns = opened.prepare('PRAGMA table_info(flywheel_substrate_bugs)').all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toContain('affected_criteria');

    const filed = upsert({
      issueId: 'PAN-UPGRADE-1',
      filedAt: '2026-07-01T00:00:00.000Z',
      filedBy: 'agent',
      severity: 'P1',
      affectedCriteria: [1, 3, 5],
      updatedAt: '2026-07-01T00:00:00.000Z',
    });

    expect(filed.affectedCriteria).toEqual([1, 3, 5]);
    expect(getByIssueId('PAN-UPGRADE-1')?.affectedCriteria).toEqual([1, 3, 5]);
    expect(listInWindow('2026-06-01T00:00:00.000Z', '2026-07-31T23:59:59.000Z')).toHaveLength(1);
  });
});
