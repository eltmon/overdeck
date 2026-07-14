/**
 * PAN-2207: checkOrphanedCompletions deacon patrol.
 *
 * Covers:
 *  - Recover pending issues whose PR is open, all beads are closed, and review
 *    was never dispatched.
 *  - Skip issues with open beads (review cannot be dispatched yet).
 *  - Skip issues where the live bead query failed transiently (do not treat the
 *    JSONL fallback as authoritative).
 *  - Skip already-recovered issues (tombstone present).
 *  - Skip issues in 'reviewing' or already merged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;

const {
  mockExecFn,
  mockResolveProjectFromIssueSync,
  mockGetProjectSync,
  mockQueryBeadsForIssue,
} = vi.hoisted(() => ({
  mockExecFn: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockGetProjectSync: vi.fn(),
  mockQueryBeadsForIssue: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn };
});

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
  getProjectSync: mockGetProjectSync,
  findProjectByPathSync: () => null,
  listProjectsSync: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../../src/lib/beads/presence.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/lib/beads/presence.js')>('../../../../src/lib/beads/presence.js');
  return {
    ...actual,
    // The recovery patrol reads beads through the cached bulk-snapshot door
    // (PAN-2640). Translate the fixtures' {beads, transientFailure} shape to
    // the door's BeadsReadResult at that boundary, bypassing the cache.
    readBeadsForIssueCached: vi.fn(async (workspacePath: string, issueId: string) => {
      const result = mockQueryBeadsForIssue(workspacePath, issueId);
      return result.transientFailure
        ? { ok: false, reason: 'transient bd failure', transient: true, error: result.transientFailure }
        : { ok: true, value: result.beads };
    }),
  };
});

vi.mock('../../../../src/lib/pipeline-notifier.js', () => ({
  notifyPipeline: vi.fn(),
  notifyPipelineSync: vi.fn(),
}));

vi.mock('../../../../src/lib/activity-logger.js', () => ({
  emitActivityEntry: vi.fn(),
  emitActivityEntrySync: vi.fn(),
  emitActivityTts: vi.fn(),
  emitActivityTtsSync: vi.fn(),
}));

beforeEach(() => {
  odb = setupOverdeckTestDb();
}, 20_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

import { checkOrphanedCompletions } from '../../../../src/lib/cloister/deacon.js';
import { readIssueRecordSync, writeIssueRecordSync } from '../../../../src/lib/pan-dir/record.js';

const seed = (cols: Record<string, string | number | null>) => {
  const keys = Object.keys(cols);
  const placeholders = keys.map(() => '?').join(', ');
  odb.raw()
    .prepare(`INSERT INTO review_status (${keys.join(', ')}) VALUES (${placeholders})`)
    .run(...keys.map((k) => cols[k]));
};

function makeBead(status: string) {
  return { id: 'bead-1', title: 'Bead', status, labels: ['pan-2207'], priority: 1 };
}

describe('checkOrphanedCompletions (PAN-2207)', () => {
  let tempDir: string;
  const projectConfig = { name: 'test', path: '' };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-deacon-orphan-'));
    mkdirSync(join(tempDir, 'workspaces', 'feature-pan-2207'), { recursive: true });
    mkdirSync(join(tempDir, '.pan', 'records'), { recursive: true });
    projectConfig.path = tempDir;

    mockResolveProjectFromIssueSync.mockReset();
    mockResolveProjectFromIssueSync.mockReturnValue({
      projectKey: 'test',
      projectName: 'test',
      projectPath: tempDir,
    });
    mockGetProjectSync.mockReset();
    mockGetProjectSync.mockReturnValue(projectConfig);
    mockExecFn.mockReset();
    mockQueryBeadsForIssue.mockReset();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('recovers a pending issue with an open PR and all beads closed', async () => {
    const prUrl = 'https://github.com/org/repo/pull/2207';
    mockExecFn.mockImplementation((cmd: string, _opts: any, cb: Function) => {
      if (cmd.includes('gh pr list --head feature/pan-2207')) {
        cb(null, { stdout: `${prUrl}\n`, stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed'), makeBead('closed')] });

    seed({
      issue_id: 'PAN-2207',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('PAN-2207');

    // updateIssueRecordForIssue (called by setReviewStatusSync) is async and
    // fire-and-forget; give it a tick to land before reading the journal.
    await new Promise((r) => setTimeout(r, 100));

    const record = readIssueRecordSync(projectConfig, 'PAN-2207');
    expect(record?.pipeline?.reviewRequestedAt).toBeDefined();
    expect(record?.pipeline?.prUrl).toBe(prUrl);
    expect(record?.pipeline?.panDoneRecoveredAt).toBeDefined();
  });

  it('skips an issue with open beads', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'https://github.com/org/repo/pull/2207\n', stderr: '' });
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed'), makeBead('open')] });

    seed({
      issue_id: 'PAN-OPEN',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(0);
    expect(mockExecFn).not.toHaveBeenCalled();
  });

  it('skips when the live bead query failed transiently', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'https://github.com/org/repo/pull/2207\n', stderr: '' });
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed')], transientFailure: new Error('bd locked') });

    seed({
      issue_id: 'PAN-TRANSIENT',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(0);
    expect(mockExecFn).not.toHaveBeenCalled();
  });

  it('skips an issue that already has a recovery tombstone', async () => {
    const prUrl = 'https://github.com/org/repo/pull/2207';
    mockExecFn.mockImplementation((cmd: string, _opts: any, cb: Function) => {
      if (cmd.includes('gh pr list --head feature/pan-2207')) {
        cb(null, { stdout: `${prUrl}\n`, stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed'), makeBead('closed')] });

    seed({
      issue_id: 'PAN-2207',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    writeIssueRecordSync(projectConfig, 'PAN-2207', {
      issueId: 'PAN-2207',
      schemaVersion: 2,
      pipeline: {
        issueId: 'PAN-2207',
        reviewStatus: 'pending',
        testStatus: 'pending',
        readyForMerge: false,
        updatedAt: '2026-07-01T00:00:00Z',
        panDoneRecoveredAt: '2026-07-01T01:00:00Z',
      },
      updatedAt: '2026-07-01T00:00:00Z',
    } as any);

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(0);
  });

  it('skips issues whose reviewStatus is not pending', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'https://github.com/org/repo/pull/2207\n', stderr: '' });
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed')] });

    seed({
      issue_id: 'PAN-REVIEWING',
      review_status: 'reviewing',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(0);
    expect(mockExecFn).not.toHaveBeenCalled();
  });

  it('skips issues that are already merged', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'https://github.com/org/repo/pull/2207\n', stderr: '' });
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed')] });

    seed({
      issue_id: 'PAN-MERGED',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'merged',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(0);
    expect(mockExecFn).not.toHaveBeenCalled();
  });

  it('continues past exec errors without throwing', async () => {
    mockExecFn.mockImplementation((cmd: string, _opts: any, cb: Function) => {
      if (cmd.includes('gh pr list --head feature/pan-2207')) {
        cb(new Error('gh not found'), { stdout: '', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockQueryBeadsForIssue.mockReturnValue({ beads: [makeBead('closed')] });

    seed({
      issue_id: 'PAN-2207',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });

    await expect(checkOrphanedCompletions()).resolves.toEqual([]);
  });
});
