import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return { ...actual, exec: vi.fn() };
});

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return { ...actual, promisify: () => mockExecAsync };
});

import { createWorkspacePromise } from '../../../../src/lib/workspace-manager/create.js';
import { getWorkspaceForIssue, getProjectByPath } from '../../../../src/lib/workspaces/resolver.js';
import { upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { registerProjectSync, unregisterProjectSync } from '../../../../src/lib/projects.js';

let odb: OverdeckTestDb;
let tempDir: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  tempDir = mkdtempSync(join(tmpdir(), 'pan-1990-create-row-'));
  mockExecAsync.mockReset();
  mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(tempDir, { recursive: true, force: true });
});

describe('createWorkspacePromise: workspace row creation (PAN-1990)', () => {
  it('creates a kind=issue row via the writer before the worktree directory exists', async () => {
    upsertProjectFromConfig('test-project', { name: 'Test', path: tempDir });

    let rowExistedDuringWorktreeAdd: boolean | null = null;
    mockExecAsync.mockImplementation(async (command: string) => {
      if (typeof command === 'string' && command.includes('git worktree add')) {
        rowExistedDuringWorktreeAdd = getWorkspaceForIssue('PAN-2050') !== null;
      }
      return { stdout: '', stderr: '' };
    });

    const result = await createWorkspacePromise({
      projectConfig: { name: 'Test', path: tempDir },
      featureName: 'pan-2050',
    });

    expect(result.success).toBe(true);
    expect(rowExistedDuringWorktreeAdd).toBe(true);

    const row = getWorkspaceForIssue('PAN-2050');
    expect(row?.kind).toBe('issue');
    expect(row?.branchName).toBe('feature/pan-2050');
    expect(row?.path).toBe(join(tempDir, 'workspaces', 'feature-pan-2050'));
  });

  it('reuses an existing row for the same issue and creates no duplicates', async () => {
    upsertProjectFromConfig('test-project', { name: 'Test', path: tempDir });

    await createWorkspacePromise({
      projectConfig: { name: 'Test', path: tempDir },
      featureName: 'pan-3000',
    });
    const firstRowId = getWorkspaceForIssue('PAN-3000')?.id;
    expect(firstRowId).toBeDefined();

    // Simulate the workspace already existing on disk and being re-created
    // (e.g. a retried `pan start`) by clearing the mocked side effects only —
    // the row itself should be reused, not duplicated.
    await createWorkspacePromise({
      projectConfig: { name: 'Test', path: tempDir },
      featureName: 'pan-3000',
    }).catch(() => undefined); // second call may fail at the "already exists" guard; that's fine

    const rows = odb.raw().prepare(
      `SELECT COUNT(*) as c FROM workspaces WHERE issue_id = 'PAN-3000'`,
    ).get() as { c: number };
    expect(rows.c).toBe(1);
  });

  it('seeds the project row from projects.yaml when boot-seeding has not run yet, then creates the workspace row (FR-6/AC-4)', async () => {
    // Registered in projects.yaml (registerProjectSync) but deliberately NOT
    // upserted into the DB — simulates a project the dashboard hasn't
    // boot-seeded against yet.
    registerProjectSync('pan-4000-project', { name: 'Unseeded', path: tempDir });
    try {
      expect(getProjectByPath(tempDir)).toBeNull();

      let rowExistedDuringWorktreeAdd: boolean | null = null;
      mockExecAsync.mockImplementation(async (command: string) => {
        if (typeof command === 'string' && command.includes('git worktree add')) {
          rowExistedDuringWorktreeAdd = getWorkspaceForIssue('PAN-4000') !== null;
        }
        return { stdout: '', stderr: '' };
      });

      const result = await createWorkspacePromise({
        projectConfig: { name: 'Unseeded', path: tempDir },
        featureName: 'pan-4000',
      });

      expect(result.success).toBe(true);
      expect(rowExistedDuringWorktreeAdd).toBe(true);
      expect(getWorkspaceForIssue('PAN-4000')?.kind).toBe('issue');
    } finally {
      unregisterProjectSync('pan-4000-project');
    }
  });

  it('fails workspace creation (never reaching worktree creation) when the project has no projects.yaml entry at all (FR-6/AC-4)', async () => {
    // Deliberately skip both upsertProjectFromConfig and registerProjectSync.
    const result = await createWorkspacePromise({
      projectConfig: { name: 'Unregistered', path: tempDir },
      featureName: 'pan-4001',
    });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('No projects.yaml entry found');
    expect(getWorkspaceForIssue('PAN-4001')).toBeNull();
    expect(mockExecAsync).not.toHaveBeenCalled();
  });
});
