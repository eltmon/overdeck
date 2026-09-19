import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecFile = vi.hoisted(() =>
  vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>());

// PAN-3917: the record plane (`pan-dir/record*`, `records`, `agents`,
// `auto-commit`) is being deleted by W3, and `auto-commit` already imports the
// removed `state-read-home`, so merge-ops' module graph cannot load. Stub the
// deleted modules and the boundaries that still reach them.
vi.mock('../../../../../src/lib/agents/spawn.js', () => ({
  spawnAgent: vi.fn(), spawnRun: vi.fn(), postAgentsRoute: vi.fn(),
}));
vi.mock('../../../../../src/lib/agents/tier-table.js', () => ({
  DEFAULT_TIERED_EXECUTION_CONFIG: { enabled: false, tiers: [], subscription: 'all' },
}));
vi.mock('../../../../../src/lib/git-activity.js', () => ({ listGitOperationsSync: vi.fn(() => []) }));
vi.mock('../../../../../src/dashboard/server/routes/specialists.js', () => ({ _serverManagedMerges: new Set<string>() }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function execFile(file: string, args: string[], optionsOrCallback: any, maybeCallback?: any) {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    mockExecFile(file, args, typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((error: any) => callback(error, error.stdout || '', error.stderr || ''));
  }

  (execFile as any)[kCustom] = mockExecFile;
  return { ...actual, execFile };
});

import { ensurePRExists } from '../../../../../src/dashboard/server/routes/workspaces/merge-ops.js';

const WORKSPACE = '/tmp/strike-pan-3639';
const BRANCH = 'strike/pan-3639';
const TARGET = 'main';
const OPEN_PR = 'https://github.com/eltmon/overdeck/pull/3640';
const CLOSED_PR = 'https://github.com/eltmon/overdeck/pull/3632';
const NEW_PR = 'https://github.com/eltmon/overdeck/pull/3641';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensurePRExists', () => {
  it('reuses an open PR for the requested head and base branches', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify([{ url: OPEN_PR, state: 'OPEN' }]),
      stderr: '',
    });

    await expect(ensurePRExists('PAN-3639', {
      cwd: WORKSPACE,
      branchName: BRANCH,
      targetBranch: TARGET,
    })).resolves.toEqual({ created: false, prUrl: OPEN_PR });

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith('gh', [
      'pr', 'list', '--head', BRANCH, '--base', TARGET, '--state', 'all',
      '--json', 'url,state', '--limit', '100',
    ], expect.objectContaining({ cwd: WORKSPACE }));
  });

  it('creates a fresh PR when the only matching PR is closed and unmerged', async () => {
    mockExecFile
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ url: CLOSED_PR, state: 'CLOSED' }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `${NEW_PR}\n`, stderr: '' });

    const result = await ensurePRExists('PAN-3639', {
      cwd: WORKSPACE,
      branchName: BRANCH,
      targetBranch: TARGET,
    });

    expect(result).toEqual({ created: true, prUrl: NEW_PR });
    expect(mockExecFile).toHaveBeenNthCalledWith(2, 'gh', [
      'pr', 'create', '--head', BRANCH, '--base', TARGET, '--title', 'PAN-3639',
      '--body-file', expect.stringContaining('pan-pr-body-PAN-3639-'),
    ], expect.objectContaining({ cwd: WORKSPACE }));
  });

  it('returns the new PR URL for pre-merge validation instead of the closed URL', async () => {
    mockExecFile
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ url: CLOSED_PR, state: 'CLOSED' }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `creating pull request\n${NEW_PR}\n`, stderr: '' });

    const result = await ensurePRExists('PAN-3639', {
      cwd: WORKSPACE,
      branchName: BRANCH,
      targetBranch: TARGET,
    });

    expect(result.prUrl).toBe(NEW_PR);
    expect(result.prUrl).not.toBe(CLOSED_PR);
  });

  it('lets a fresh strike readiness HEAD recover after a prior PR was closed', async () => {
    mockExecFile
      .mockResolvedValueOnce({
        stdout: JSON.stringify([{ url: CLOSED_PR, state: 'CLOSED' }]),
        stderr: '',
      })
      .mockResolvedValueOnce({ stdout: `${NEW_PR}\n`, stderr: '' });

    const result = await ensurePRExists('PAN-3639', {
      cwd: WORKSPACE,
      branchName: BRANCH,
      targetBranch: TARGET,
    });

    expect(result).toEqual({ created: true, prUrl: NEW_PR });
    expect(mockExecFile.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      '--head', BRANCH,
    ]));
  });

  it('preserves merged-PR reconciliation when the branch has already landed', async () => {
    const mergedPr = 'https://github.com/eltmon/overdeck/pull/3630';
    mockExecFile.mockResolvedValueOnce({
      stdout: JSON.stringify([
        { url: CLOSED_PR, state: 'CLOSED' },
        { url: mergedPr, state: 'MERGED' },
      ]),
      stderr: '',
    });

    await expect(ensurePRExists('PAN-3639', {
      cwd: WORKSPACE,
      branchName: BRANCH,
      targetBranch: TARGET,
    })).resolves.toEqual({ created: false, prUrl: mergedPr });

    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});
