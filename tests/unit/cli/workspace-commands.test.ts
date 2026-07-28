import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';

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

const { mockListProjects } = vi.hoisted(() => ({ mockListProjects: vi.fn() }));

vi.mock('../../../src/lib/projects.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/projects.js')>('../../../src/lib/projects.js');
  return { ...actual, listProjectsSync: mockListProjects };
});

import { workspaceMainCommand, workspaceNewCommand } from '../../../src/cli/commands/workspace-scratch.js';
import { getMainWorkspace, getWorkspaceByName } from '../../../src/lib/workspaces/resolver.js';

let odb: OverdeckTestDb;
let projectRoot: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-cli-workspace-'));
  mockExecAsync.mockReset();
  mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });
  mockListProjects.mockReset();
  mockListProjects.mockReturnValue([
    { key: 'test-project', config: { name: 'Test Project', path: projectRoot } },
  ]);
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('pan workspace new (PAN-1990)', () => {
  it('creates a kind=scratch row sharing the project directory by default', async () => {
    await workspaceNewCommand('notes', {});

    const row = getWorkspaceByName('test-project', 'notes');
    expect(row?.kind).toBe('scratch');
    expect(row?.path).toBe(projectRoot);
    // No worktree is created for a shared (non-isolated) scratch workspace.
    expect(mockExecAsync).not.toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      expect.anything(),
    );
  });

  it('--isolated additionally creates a git worktree at workspaces/scratch-<name>', async () => {
    await workspaceNewCommand('isolated-notes', { isolated: true, parentBranch: 'main' });

    const expectedPath = join(projectRoot, 'workspaces', 'scratch-isolated-notes');
    const row = getWorkspaceByName('test-project', 'isolated-notes');
    expect(row?.kind).toBe('scratch');
    expect(row?.path).toBe(expectedPath);
    expect(row?.isGitRepository).toBe(true);
    expect(row?.parentBranch).toBe('main');
    expect(row?.parentBranchGuessed).toBe(false);
    expect(mockExecAsync).toHaveBeenCalledWith(
      expect.stringContaining('git worktree add'),
      expect.objectContaining({ cwd: projectRoot }),
    );
  });
});

describe('pan workspace main (PAN-1990)', () => {
  it('creates the singleton main workspace on first call and reuses it on the second', async () => {
    await workspaceMainCommand({});
    const firstRow = getMainWorkspace('test-project');
    expect(firstRow).not.toBeNull();
    const firstAccessedAt = firstRow?.lastAccessedAt;

    await workspaceMainCommand({});
    const secondRow = getMainWorkspace('test-project');
    expect(secondRow?.id).toBe(firstRow?.id);
    expect(secondRow?.lastAccessedAt).toBeGreaterThanOrEqual(firstAccessedAt ?? 0);

    const count = odb.raw().prepare(`SELECT COUNT(*) as c FROM workspaces WHERE project_id = 'test-project'`).get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('produces is_git_repository=0 for a non-git primary path', async () => {
    await workspaceMainCommand({});
    const row = getMainWorkspace('test-project');
    expect(row?.isGitRepository).toBe(false);
  });

  it('produces is_git_repository=1 for a git primary path', async () => {
    mkdirSync(join(projectRoot, '.git'), { recursive: true });
    await workspaceMainCommand({});
    const row = getMainWorkspace('test-project');
    expect(row?.isGitRepository).toBe(true);
  });
});
