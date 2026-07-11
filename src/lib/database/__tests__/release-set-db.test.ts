import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../driver.js';
import { initSchema } from '../schema.js';
import type { ReleaseSet } from '../../release-set.js';

let testDb: SqliteDatabase;

vi.mock('../index.js', () => ({
  getDatabase: () => testDb,
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
  deleteReleaseSet,
  getReleaseSetFromDb,
  upsertReleaseSet,
} from '../release-set-db.js';
import {
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
    status: 'pending',
    createdAt: '2026-07-04T12:00:00.000Z',
    updatedAt: '2026-07-04T12:00:00.000Z',
    components: [
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
        rollbackStatus: 'pending',
      },
      {
        componentKey: 'api',
        provider: 'kubernetes',
        trigger: 'auto',
        releaseOrder: 0,
        required: true,
        status: 'releasing',
        healthStatus: 'passed',
        versionStatus: 'pending',
        smokeStatus: 'pending',
        rollbackStatus: 'pending',
        notes: 'waiting on smoke test',
      },
    ],
    ...overrides,
  };
}

describe('release-set-db', () => {
  it('persists a release set and returns components ordered by release order', () => {
    upsertReleaseSet(makeReleaseSet());

    const result = getReleaseSetFromDb('PAN-399');

    expect(result).toEqual({
      ...makeReleaseSet(),
      components: [
        makeReleaseSet().components[1],
        makeReleaseSet().components[0],
      ],
    });
  });

  it('replaces component rows on update', () => {
    upsertReleaseSet(makeReleaseSet());
    upsertReleaseSet(makeReleaseSet({
      status: 'passed',
      components: [
        {
          componentKey: 'api',
          trigger: 'auto',
          releaseOrder: 0,
          required: true,
          status: 'passed',
          healthStatus: 'passed',
          versionStatus: 'passed',
          smokeStatus: 'passed',
          rollbackStatus: 'skipped',
        },
      ],
    }));

    const result = getReleaseSetFromDb('PAN-399');
    expect(result?.status).toBe('passed');
    expect(result?.components).toHaveLength(1);
    expect(result?.components[0].componentKey).toBe('api');
    expect(result?.components[0].provider).toBeUndefined();
  });

  it('public sync wrappers round-trip release sets', () => {
    upsertReleaseSetSync(makeReleaseSet());

    expect(getReleaseSetSync('PAN-399')?.components.map(component => component.componentKey)).toEqual(['api', 'frontend']);
  });

  it('patches only the requested component and updates updatedAt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T13:00:00.000Z'));
    try {
      const original = makeReleaseSet();

      const patched = withComponentStateSync(original, 'api', {
        status: 'failed',
        notes: 'health check failed',
      });

      expect(patched.updatedAt).toBe('2026-07-04T13:00:00.000Z');
      expect(patched.components[0]).toEqual(original.components[0]);
      expect(patched.components[1]).toEqual({
        ...original.components[1],
        status: 'failed',
        notes: 'health check failed',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes release sets and cascades component rows', () => {
    upsertReleaseSet(makeReleaseSet());
    deleteReleaseSet('PAN-399');

    expect(getReleaseSetFromDb('PAN-399')).toBeNull();
    const components = testDb.prepare('SELECT * FROM release_set_components WHERE issue_id = ?').all('PAN-399');
    expect(components).toHaveLength(0);
  });
});
