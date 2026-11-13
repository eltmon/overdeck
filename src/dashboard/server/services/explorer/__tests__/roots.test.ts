import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanRpcError } from '@overdeck/contracts';
import type { WorkspaceRow } from '../../../../../lib/workspaces/types.js';

const mocks = vi.hoisted(() => ({
  listProjectsAsync: vi.fn(),
  resolveProjectFromIssue: vi.fn(),
  getWorkspaceById: vi.fn(),
}));

vi.mock('../../../../../lib/projects.js', () => ({
  listProjectsAsync: mocks.listProjectsAsync,
  resolveProjectFromIssue: mocks.resolveProjectFromIssue,
}));
vi.mock('../../../../../lib/workspaces/resolver.js', () => ({
  getWorkspaceById: mocks.getWorkspaceById,
}));

const { resolveExplorerRoot } = await import('../roots.js');

let base: string;
let projectPath: string;
let outsidePath: string;

function row(overrides: Partial<WorkspaceRow>): WorkspaceRow {
  return {
    id: 'w1',
    projectId: 'p',
    kind: 'scratch',
    name: 'edit-1',
    path: join(projectPath, 'workspaces', 'edit-1'),
    branchName: 'scratch/edit-1',
    parentBranch: null,
    parentBranchGuessed: false,
    isGitRepository: true,
    issueId: null,
    layoutConfig: null,
    runCommand: null,
    isFavorite: false,
    isArchived: false,
    title: null,
    createdAt: 0,
    lastAccessedAt: 0,
    ...overrides,
  };
}

async function codeOf(rootId: string): Promise<string | undefined> {
  try {
    await resolveExplorerRoot(rootId);
  } catch (error) {
    expect(error).toBeInstanceOf(PanRpcError);
    return (error as PanRpcError).code;
  }
  return 'resolved';
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'explorer-roots-')));
  projectPath = join(base, 'proj');
  outsidePath = join(base, 'elsewhere');
  await mkdir(join(projectPath, 'workspaces', 'feature-pan-1'), { recursive: true });
  await mkdir(join(projectPath, 'workspaces', 'edit-1'), { recursive: true });
  await mkdir(outsidePath, { recursive: true });
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.listProjectsAsync.mockResolvedValue([
    { key: 'p', config: { name: 'P', path: projectPath, workspace: { default_branch: 'trunk' } } },
  ]);
  mocks.resolveProjectFromIssue.mockImplementation((id: string) =>
    Effect.succeed(/^pan-\d+$/i.test(id) ? { projectKey: 'p', projectName: 'P', projectPath } : null),
  );
  mocks.getWorkspaceById.mockReturnValue(row({}));
});

describe('resolveExplorerRoot', () => {
  it('resolves a project root read-only with its default branch', async () => {
    await expect(resolveExplorerRoot('project:p')).resolves.toEqual({
      kind: 'project',
      id: 'project:p',
      absPath: projectPath,
      writable: false,
      projectKey: 'p',
      defaultBranch: 'trunk',
    });
  });

  it.each(['project:missing', 'nope', 'issue:', 'foo:bar'])('rejects %j with ROOT_NOT_FOUND', async (rootId) => {
    expect(await codeOf(rootId)).toBe('ROOT_NOT_FOUND');
  });

  it('resolves an issue root to its feature workspace', async () => {
    const r = await resolveExplorerRoot('issue:pan-1');
    expect(r).toMatchObject({
      kind: 'issue',
      id: 'issue:PAN-1',
      issueId: 'PAN-1',
      writable: true,
      projectKey: 'p',
      defaultBranch: 'trunk',
    });
    expect(r.absPath).toBe(await realpath(join(projectPath, 'workspaces', 'feature-pan-1')));
  });

  it('rejects an issue whose workspace directory is missing', async () => {
    expect(await codeOf('issue:pan-2')).toBe('ROOT_NOT_FOUND');
  });

  it('resolves a scratch workspace root under workspaces/', async () => {
    mocks.getWorkspaceById.mockReturnValue(row({ parentBranch: 'develop' }));
    await expect(resolveExplorerRoot('workspace:w1')).resolves.toEqual({
      kind: 'workspace',
      id: 'workspace:w1',
      absPath: join(projectPath, 'workspaces', 'edit-1'),
      writable: true,
      projectKey: 'p',
      workspaceId: 'w1',
      defaultBranch: 'develop',
    });
  });

  it.each<[string, () => Partial<WorkspaceRow>]>([
    ['kind issue', () => ({ kind: 'issue' })],
    ['archived', () => ({ isArchived: true })],
    ['no branch', () => ({ branchName: null })],
    ['non-scratch branch', () => ({ branchName: 'feature/x' })],
    ['primary checkout path', () => ({ path: projectPath })],
    ['path outside workspaces/', () => ({ path: outsidePath })],
    ['the workspaces dir itself', () => ({ path: join(projectPath, 'workspaces') })],
  ])('rejects a workspace row with %s', async (_label, overrides) => {
    mocks.getWorkspaceById.mockReturnValue(row(overrides()));
    expect(await codeOf('workspace:w1')).toBe('ROOT_NOT_FOUND');
  });

  it('rejects an unknown workspace id', async () => {
    mocks.getWorkspaceById.mockReturnValue(null);
    expect(await codeOf('workspace:nope')).toBe('ROOT_NOT_FOUND');
  });
});
