import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../tests/helpers/overdeck-test-db.js';
import type { ReleaseSet } from '../../release-set.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  // The release_sets table has a foreign key to issues(id).
  odb.raw().prepare('INSERT INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run(
    'PAN-399',
    'open',
    Date.now(),
  );
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
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
    const components = odb.raw().prepare('SELECT * FROM release_set_components WHERE issue_id = ?').all('PAN-399');
    expect(components).toHaveLength(0);
  });
});
