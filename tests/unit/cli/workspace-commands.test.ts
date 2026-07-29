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
    // PAN-1990 review fix: argument-vector spawn (execFile), not an
    // interpolated shell string — see workspace-scratch-isolated.test.ts for
    // the security/branch-collision behavior this call shape fixes.
    expect(mockExecAsync).toHaveBeenCalledWith(
      'git',
      ['worktree', 'add', '-b', 'scratch/isolated-notes', expectedPath, 'main'],
      expect.objectContaining({ cwd: projectRoot }),
    );
  });

  it('rejects a name containing a path separator before touching git or the filesystem (non-blocking review fix)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    try {
      await expect(workspaceNewCommand('bad/name', { isolated: true })).rejects.toThrow('process.exit:1');
    } finally {
      exitSpy.mockRestore();
    }

    expect(mockExecAsync).not.toHaveBeenCalled();
    expect(getWorkspaceByName('test-project', 'bad/name')).toBeNull();
  });

  it('rejects a name containing spaces', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    try {
      await expect(workspaceNewCommand('bad name', {})).rejects.toThrow('process.exit:1');
    } finally {
      exitSpy.mockRestore();
    }
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

describe('pan workspace list --kind/--archived (PAN-1990)', () => {
  it('returns only matching rows read through the resolver', async () => {
    const { createWorkspace, upsertProjectFromConfig } = await import('../../../src/lib/workspaces/writer.js');
    upsertProjectFromConfig('test-project', { name: 'Test Project', path: projectRoot });
    const scratchId = await createWorkspace({ projectId: 'test-project', kind: 'scratch', name: 'scratch-a', path: join(projectRoot, 'a') });
    const issueId = await createWorkspace({ projectId: 'test-project', kind: 'issue', name: 'feature-pan-1', path: join(projectRoot, 'b'), issueId: 'PAN-1' });
    const { archiveWorkspace } = await import('../../../src/lib/workspaces/writer.js');
    await archiveWorkspace(scratchId);

    const { listCommand } = await import('../../../src/cli/commands/workspace-list.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await listCommand({ kind: 'scratch' as any });
    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('scratch-a'); // archived, excluded by default

    logSpy.mockClear();
    await listCommand({ kind: 'scratch' as any, archived: true });
    expect(logSpy.mock.calls.flat().join('\n')).toContain('scratch-a');

    logSpy.mockClear();
    await listCommand({ kind: 'issue' as any });
    expect(logSpy.mock.calls.flat().join('\n')).toContain('feature-pan-1');
    expect(logSpy.mock.calls.flat().join('\n')).not.toContain('scratch-a');

    logSpy.mockRestore();
    expect(issueId).toBeDefined();
  });
});

describe('pan workspace destroy (PAN-1990)', () => {
  it('refuses to destroy a kind=main workspace', async () => {
    const { createWorkspace, upsertProjectFromConfig } = await import('../../../src/lib/workspaces/writer.js');
    upsertProjectFromConfig('test-project', { name: 'Test Project', path: projectRoot });
    const id = await createWorkspace({ projectId: 'test-project', kind: 'main', name: 'main', path: projectRoot, issueId: 'PAN-9030' });

    const exitError = new Error('process exited');
    const { destroyCommand } = await import('../../../src/cli/commands/workspace-list.js');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(destroyCommand('pan-9030', {})).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }

    // getWorkspaceForIssue is kind='issue'-only by design, so it can't see this
    // main row — check by id (still present, unaffected by the refusal) instead.
    const { getWorkspaceById } = await import('../../../src/lib/workspaces/resolver.js');
    expect(getWorkspaceById(id)).not.toBeNull();
  });

  it('deletes the workspace row; --purge-memory additionally removes the memory home', async () => {
    const { mkdirSync: mkdirSyncReal, writeFileSync } = await import('node:fs');
    const { createWorkspace, upsertProjectFromConfig } = await import('../../../src/lib/workspaces/writer.js');
    const { getWorkspaceForIssue } = await import('../../../src/lib/workspaces/resolver.js');
    const { resolveMemoryRoot } = await import('../../../src/lib/memory/paths.js');

    upsertProjectFromConfig('test-project', { name: 'Test Project', path: projectRoot });
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-9031');
    mkdirSyncReal(workspacePath, { recursive: true });
    const workspaceId = await createWorkspace({
      projectId: 'test-project', kind: 'issue', name: 'feature-pan-9031', path: workspacePath, issueId: 'PAN-9031',
    });

    const memoryHome = join(resolveMemoryRoot('test-project'), workspaceId);
    mkdirSyncReal(memoryHome, { recursive: true });
    writeFileSync(join(memoryHome, 'status.json'), '{}', 'utf-8');

    const { Effect } = await import('effect');
    const worktreeModule = await import('../../../src/lib/worktree.js');
    vi.spyOn(worktreeModule, 'removeWorktree').mockReturnValue(Effect.succeed(undefined));

    const { destroyCommand } = await import('../../../src/cli/commands/workspace-list.js');
    await destroyCommand('pan-9031', { project: projectRoot });
    vi.restoreAllMocks();

    expect(getWorkspaceForIssue('PAN-9031')).toBeNull();
    const { existsSync: existsSyncReal } = await import('node:fs');
    expect(existsSyncReal(memoryHome)).toBe(true); // preserved without --purge-memory
  });

  it('--purge-memory additionally removes the memory home', async () => {
    const { mkdirSync: mkdirSyncReal, writeFileSync, existsSync: existsSyncReal } = await import('node:fs');
    const { createWorkspace, upsertProjectFromConfig } = await import('../../../src/lib/workspaces/writer.js');
    const { getWorkspaceForIssue } = await import('../../../src/lib/workspaces/resolver.js');
    const { resolveMemoryRoot } = await import('../../../src/lib/memory/paths.js');
    const { Effect } = await import('effect');
    const worktreeModule = await import('../../../src/lib/worktree.js');

    upsertProjectFromConfig('test-project', { name: 'Test Project', path: projectRoot });
    const workspacePath = join(projectRoot, 'workspaces', 'feature-pan-9032');
    mkdirSyncReal(workspacePath, { recursive: true });
    const workspaceId = await createWorkspace({
      projectId: 'test-project', kind: 'issue', name: 'feature-pan-9032', path: workspacePath, issueId: 'PAN-9032',
    });

    const memoryHome = join(resolveMemoryRoot('test-project'), workspaceId);
    mkdirSyncReal(memoryHome, { recursive: true });
    writeFileSync(join(memoryHome, 'status.json'), '{}', 'utf-8');

    vi.spyOn(worktreeModule, 'removeWorktree').mockReturnValue(Effect.succeed(undefined));

    const { destroyCommand } = await import('../../../src/cli/commands/workspace-list.js');
    await destroyCommand('pan-9032', { project: projectRoot, purgeMemory: true });
    vi.restoreAllMocks();

    expect(getWorkspaceForIssue('PAN-9032')).toBeNull();
    expect(existsSyncReal(memoryHome)).toBe(false);
  });
});

describe('pan workspace get/activate/archive (PAN-1990)', () => {
  it('get prints the row; activate touches lastAccessedAt; archive marks is_archived=1 and the row survives', async () => {
    const { createWorkspace, upsertProjectFromConfig } = await import('../../../src/lib/workspaces/writer.js');
    const { getWorkspaceById } = await import('../../../src/lib/workspaces/resolver.js');
    const { workspaceActivateCommand, workspaceArchiveCommand, workspaceGetCommand } = await import('../../../src/cli/commands/workspace-lifecycle.js');

    upsertProjectFromConfig('test-project', { name: 'Test Project', path: projectRoot });
    const id = await createWorkspace({ projectId: 'test-project', kind: 'scratch', name: 'lifecycle-notes', path: join(projectRoot, 'notes') });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await workspaceGetCommand(id);
    expect(logSpy.mock.calls.flat().join('\n')).toContain('lifecycle-notes');
    logSpy.mockRestore();

    const before = getWorkspaceById(id)!.lastAccessedAt;
    await workspaceActivateCommand(id);
    expect(getWorkspaceById(id)!.lastAccessedAt).toBeGreaterThanOrEqual(before);

    await workspaceArchiveCommand(id);
    const row = getWorkspaceById(id);
    expect(row?.isArchived).toBe(true);
    expect(row).not.toBeNull(); // reversible — row survives
  });

  it('archive refuses a kind=main workspace', async () => {
    const { createWorkspace, upsertProjectFromConfig } = await import('../../../src/lib/workspaces/writer.js');
    const { workspaceArchiveCommand } = await import('../../../src/cli/commands/workspace-lifecycle.js');

    upsertProjectFromConfig('test-project', { name: 'Test Project', path: projectRoot });
    const id = await createWorkspace({ projectId: 'test-project', kind: 'main', name: 'main', path: projectRoot });

    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });
    try {
      await expect(workspaceArchiveCommand(id)).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }

    const { getWorkspaceById } = await import('../../../src/lib/workspaces/resolver.js');
    expect(getWorkspaceById(id)?.isArchived).toBe(false);
  });
});
