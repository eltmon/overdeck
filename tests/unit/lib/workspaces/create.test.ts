/**
 * PAN-3847 W17 — performWorkspaceCreate fetches origin/<parent> and cuts the
 * new branch from origin/<parent>, never from a remembered local ref.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  listProjectsAsync: vi.fn(),
  ensureProjectSeeded: vi.fn(),
  createWorkspace: vi.fn(),
}));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const execFile = mocks.execFile;
  Object.assign(execFile, {
    [Symbol.for('nodejs.util.promisify.custom')]: (command: string, args: string[], options: unknown) =>
      Promise.resolve(mocks.execFile(command, args, options)),
  });
  return { ...actual, execFile };
});

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsAsync: mocks.listProjectsAsync,
}));

vi.mock('../../../../src/lib/workspaces/writer.js', () => ({
  createWorkspace: mocks.createWorkspace,
  upsertProjectFromConfig: mocks.ensureProjectSeeded,
}));

import { performWorkspaceCreate, type ResolvedWorkspaceIntent } from '../../../../src/lib/workspaces/create.js';

function intent(overrides: Partial<ResolvedWorkspaceIntent> = {}): ResolvedWorkspaceIntent {
  return {
    findings: [],
    projectId: 'overdeck',
    kind: 'scratch',
    name: 'scratch-x',
    path: '/project/workspaces/scratch-x',
    branchName: 'scratch/scratch-x',
    parentBranch: null,
    parentBranchGuessed: false,
    wouldCreateWorktree: true,
    isGitRepository: true,
    unregisteredTargetPath: false,
    ...overrides,
  };
}

describe('performWorkspaceCreate — branch provenance (PAN-3847)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execFile.mockReturnValue({ stdout: '', stderr: '' });
    mocks.listProjectsAsync.mockResolvedValue([
      { key: 'overdeck', config: { path: '/project' } },
    ]);
    mocks.createWorkspace.mockResolvedValue({ id: 'ws-1' });
  });

  it('fetches origin main and cuts the branch from origin/main when no parent is given', async () => {
    await performWorkspaceCreate(intent());

    const calls = mocks.execFile.mock.calls.map((call) => call[1] as string[]);
    const fetchIdx = calls.findIndex((args) => args[0] === 'fetch');
    const addIdx = calls.findIndex((args) => args[0] === 'worktree');
    expect(fetchIdx).toBeGreaterThanOrEqual(0);
    expect(calls[fetchIdx]).toEqual(['fetch', 'origin', 'main']);
    expect(addIdx).toBeGreaterThan(fetchIdx);
    expect(calls[addIdx]).toEqual(['worktree', 'add', '-b', 'scratch/scratch-x', '--', '/project/workspaces/scratch-x', 'origin/main']);
  });

  it('cuts from origin/<parent> when a parent branch is given', async () => {
    await performWorkspaceCreate(intent({ parentBranch: 'release/1.2' }));

    const calls = mocks.execFile.mock.calls.map((call) => call[1] as string[]);
    expect(calls).toContainEqual(['fetch', 'origin', 'release/1.2']);
    const add = calls.find((args) => args[0] === 'worktree');
    expect(add?.at(-1)).toBe('origin/release/1.2');
  });

  it('falls back to the local ref with a warning when the fetch fails (offline)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const args_ = args[1] as string[];
      if (args_[0] === 'fetch') throw new Error('Could not resolve host: github.com');
      return { stdout: '', stderr: '' };
    });

    await performWorkspaceCreate(intent());

    const calls = mocks.execFile.mock.calls.map((call) => call[1] as string[]);
    const add = calls.find((args) => args[0] === 'worktree');
    expect(add?.at(-1)).toBe('main');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('LOCAL main');
    warn.mockRestore();
  });
});
