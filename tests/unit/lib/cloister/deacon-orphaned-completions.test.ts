/**
 * PAN-2207: checkOrphanedCompletions deacon patrol.
 *
 * Covers:
 *  - Recover pending issues whose PR is open, all beads are closed, and review
 *    was never dispatched.
 *  - Skip issues with open beads (review cannot be dispatched yet).
 *  - Skip already-recovered issues (tombstone present).
 *  - Skip issues in 'reviewing' or already merged.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;

const {
  mockExecFn,
  mockExecFileFn,
  mockResolveProjectFromIssueSync,
  mockGetProjectSync,
} = vi.hoisted(() => ({
  mockExecFn: vi.fn(),
  mockExecFileFn: vi.fn(),
  mockResolveProjectFromIssueSync: vi.fn(),
  mockGetProjectSync: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn, execFile: mockExecFileFn };
});

vi.mock('../../../../src/lib/projects.js', () => ({
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
  getProjectSync: mockGetProjectSync,
  listProjectsSync: vi.fn().mockReturnValue([]),
}));

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

function getWorkspacePath(projectPath: string, issueId: string) {
  const workspacePath = join(projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

function writeClosedBeads(projectPath: string, issueId: string) {
  const workspacePath = getWorkspacePath(projectPath, issueId);
  const beadsDir = join(workspacePath, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  const label = issueId.toLowerCase();
  writeFileSync(
    join(beadsDir, 'issues.jsonl'),
    [
      JSON.stringify({ _type: 'issue', id: 'bead-1', title: 'First bead', status: 'closed', labels: [label], priority: 1 }),
      JSON.stringify({ _type: 'issue', id: 'bead-2', title: 'Second bead', status: 'closed', labels: [label], priority: 1 }),
    ].join('\n') + '\n'
  );
}

function writeOpenBeads(projectPath: string, issueId: string) {
  const workspacePath = getWorkspacePath(projectPath, issueId);
  const beadsDir = join(workspacePath, '.beads');
  mkdirSync(beadsDir, { recursive: true });
  const label = issueId.toLowerCase();
  writeFileSync(
    join(beadsDir, 'issues.jsonl'),
    [
      JSON.stringify({ _type: 'issue', id: 'bead-1', title: 'First bead', status: 'closed', labels: [label], priority: 1 }),
      JSON.stringify({ _type: 'issue', id: 'bead-2', title: 'Second bead', status: 'open', labels: [label], priority: 1 }),
    ].join('\n') + '\n'
  );
}

describe('checkOrphanedCompletions (PAN-2207)', () => {
  let tempDir: string;
  const projectConfig = { name: 'test', path: '' };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pan-deacon-orphan-'));
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
    mockExecFileFn.mockReset();
    // Force queryBeadsForIssue to fall back to .beads/issues.jsonl.
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('bd not available in test'), '', '');
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('recovers a pending issue with an open PR, all beads closed, and writes a tombstone', async () => {
    const prUrl = 'https://github.com/org/repo/pull/2207';
    mockExecFn.mockImplementation((cmd: string, _opts: any, cb: Function) => {
      if (cmd.includes('gh pr list --head feature/pan-2207')) {
        cb(null, { stdout: `${prUrl}\n`, stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    seed({
      issue_id: 'PAN-2207',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });
    writeClosedBeads(tempDir, 'PAN-2207');

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

    seed({
      issue_id: 'PAN-OPEN',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });
    writeOpenBeads(tempDir, 'PAN-OPEN');

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

    seed({
      issue_id: 'PAN-2207',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });
    writeClosedBeads(tempDir, 'PAN-2207');

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

    seed({
      issue_id: 'PAN-REVIEWING',
      review_status: 'reviewing',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });
    writeClosedBeads(tempDir, 'PAN-REVIEWING');

    const actions = await checkOrphanedCompletions();

    expect(actions).toHaveLength(0);
    expect(mockExecFn).not.toHaveBeenCalled();
  });

  it('skips issues that are already merged', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: any, cb: Function) => {
      cb(null, { stdout: 'https://github.com/org/repo/pull/2207\n', stderr: '' });
    });

    seed({
      issue_id: 'PAN-MERGED',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'merged',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });
    writeClosedBeads(tempDir, 'PAN-MERGED');

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

    seed({
      issue_id: 'PAN-2207',
      review_status: 'pending',
      test_status: 'pending',
      merge_status: 'pending',
      ready_for_merge: 0,
      updated_at: '2026-07-01T00:00:00Z',
    });
    writeClosedBeads(tempDir, 'PAN-2207');

    await expect(checkOrphanedCompletions()).resolves.toEqual([]);
  });
});
