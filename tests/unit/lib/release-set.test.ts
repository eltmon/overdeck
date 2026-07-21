/**
 * Tests for release-set sync accessors (PAN-399 case-sensitivity follow-up).
 *
 * Verifies that getReleaseSetSync normalizes lowercase issue IDs to the
 * canonical uppercase form stored in overdeck.db.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../helpers/overdeck-test-db.js';
import {
  getReleaseSetSync,
  upsertReleaseSetSync,
  deleteReleaseSetSync,
} from '../../../src/lib/release-set.js';
import type { ReleaseSet } from '../../../src/lib/release-set-types.js';

let odb: OverdeckTestDb;

beforeEach(() => { odb = setupOverdeckTestDb(); });
afterEach(() => { teardownOverdeckTestDb(odb); });

function seedIssue(id: string): void {
  odb.raw().prepare(
    "INSERT OR IGNORE INTO issues (id, stage, updated_at) VALUES (?, 'open', ?)",
  ).run(id, Date.now());
}

function makeReleaseSet(overrides: Partial<ReleaseSet> = {}): ReleaseSet {
  return {
    issueId: 'PAN-399',
    projectKey: 'overdeck',
    projectPath: '/repo/overdeck',
    workspaceType: 'polyrepo',
    status: 'passed',
    createdAt: '2026-07-05T00:00:00.000Z',
    updatedAt: '2026-07-05T00:00:00.000Z',
    components: [
      {
        componentKey: 'api',
        provider: undefined,
        trigger: 'auto',
        releaseOrder: 0,
        required: true,
        status: 'passed',
        healthStatus: 'skipped',
        versionStatus: 'skipped',
        smokeStatus: 'skipped',
        rollbackStatus: 'skipped',
      },
    ],
    ...overrides,
  };
}

describe('release-set sync accessors', () => {
  it('getReleaseSetSync normalizes lowercase IDs to uppercase', () => {
    seedIssue('PAN-399');
    upsertReleaseSetSync(makeReleaseSet());

    const loaded = getReleaseSetSync('pan-399');

    expect(loaded).not.toBeNull();
    expect(loaded!.issueId).toBe('PAN-399');
  });

  it('upsertReleaseSetSync stores the canonical uppercase issue ID', () => {
    seedIssue('PAN-399');
    upsertReleaseSetSync(makeReleaseSet({ issueId: 'pan-399' }));

    const row = odb.raw().prepare('SELECT issue_id FROM release_sets WHERE issue_id = ?').get('PAN-399') as { issue_id: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.issue_id).toBe('PAN-399');
  });

  it('deleteReleaseSetSync normalizes lowercase IDs to uppercase', () => {
    seedIssue('PAN-399');
    upsertReleaseSetSync(makeReleaseSet());

    deleteReleaseSetSync('pan-399');

    const row = odb.raw().prepare('SELECT issue_id FROM release_sets WHERE issue_id = ?').get('PAN-399') as { issue_id: string } | undefined;
    expect(row).toBeUndefined();
  });
});
