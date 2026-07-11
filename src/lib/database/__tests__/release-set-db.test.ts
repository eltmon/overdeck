import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../driver.js';
import { initSchema } from '../schema.js';
import type { ReleaseSet } from '../../release-set.js';

let testDb: SqliteDatabase;

vi.mock('../index.js', () => ({
  getDatabase: () => testDb,
  DatabaseError: class DatabaseError extends Error {},
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

import {
  deleteReleaseSetSync,
  getReleaseSetSync,
  upsertReleaseSetSync,
  withComponentStateSync,
} from '../../release-set.js';

function makeReleaseSet(overrides: Partial<ReleaseSet> = {}): ReleaseSet {
  return {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/tmp/overdeck',
    workspaceType: 'polyrepo',
    status: 'releasing',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    components: [
      {
        componentKey: 'api',
        provider: 'kubernetes',
        trigger: 'auto',
        releaseOrder: 0,
        required: true,
        status: 'pending',
        healthStatus: 'pending',
        versionStatus: 'skipped',
        smokeStatus: 'pending',
        rollbackStatus: 'pending',
      },
      {
        componentKey: 'frontend',
        provider: 'vercel',
        trigger: 'auto',
        releaseOrder: 1,
        required: true,
        status: 'pending',
        healthStatus: 'pending',
        versionStatus: 'pending',
        smokeStatus: 'pending',
        rollbackStatus: 'skipped',
      },
    ],
    ...overrides,
  };
}

describe('release-set-db', () => {
  it('persists a release set and returns components ordered by releaseOrder', () => {
    upsertReleaseSetSync(makeReleaseSet());

    const result = getReleaseSetSync('PAN-399');

    expect(result?.status).toBe('releasing');
    expect(result?.components.map(component => component.componentKey)).toEqual(['api', 'frontend']);
    expect(result?.components[0]).toMatchObject({
      provider: 'kubernetes',
      trigger: 'auto',
      status: 'pending',
      healthStatus: 'pending',
    });
  });

  it('patches only the requested component state', () => {
    const original = makeReleaseSet();

    const updated = withComponentStateSync(original, 'frontend', {
      status: 'passed',
      smokeStatus: 'passed',
    });

    expect(updated.updatedAt).not.toBe(original.updatedAt);
    expect(updated.components.find(component => component.componentKey === 'api')?.status).toBe('pending');
    expect(updated.components.find(component => component.componentKey === 'frontend')).toMatchObject({
      status: 'passed',
      smokeStatus: 'passed',
    });
  });

  it('deletes release sets and cascades component rows', () => {
    upsertReleaseSetSync(makeReleaseSet());
    deleteReleaseSetSync('PAN-399');

    expect(getReleaseSetSync('PAN-399')).toBeNull();
    const components = testDb.prepare('SELECT * FROM release_set_components WHERE issue_id = ?').all('PAN-399');
    expect(components).toHaveLength(0);
  });
});
