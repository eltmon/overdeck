/**
 * Unit tests for the no-op rebase pre-check in triggerMerge
 * (src/dashboard/server/routes/workspaces.ts — isBranchAlreadyRebased).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() =>
  vi.fn<[string, string[], any?], Promise<{ stdout: string; stderr: string }>>());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const kCustom = Symbol.for('nodejs.util.promisify.custom');

  function execFile(file: string, args: string[], optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    mockExecFile(file, args, typeof optionsOrCb === 'object' ? optionsOrCb : undefined)
      .then(({ stdout, stderr }) => callback(null, stdout, stderr))
      .catch((err: any) => callback(err, err.stdout || '', err.stderr || ''));
  }

  (execFile as any)[kCustom] = mockExecFile;
  return {
    ...actual,
    execFile,
  };
});

import { isBranchAlreadyRebased } from '../../../../../src/dashboard/server/routes/workspaces/merge-ops.js';

const WORKSPACE = '/tmp/test-workspace';
const BRANCH = 'feature/pan-850';
const TARGET = 'main';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isBranchAlreadyRebased', () => {
  it('returns alreadyRebased=true when origin/branch contains origin/target', async () => {
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' })   // fetch origin/target
      .mockResolvedValueOnce({ stdout: '', stderr: '' })   // fetch origin/branch
      .mockResolvedValueOnce({ stdout: '', stderr: '' })   // merge-base --is-ancestor
      .mockResolvedValueOnce({ stdout: 'deadbeef1234\n', stderr: '' }); // rev-parse

    const result = await isBranchAlreadyRebased(WORKSPACE, BRANCH, TARGET);

    expect(result.alreadyRebased).toBe(true);
    expect(result.currentHead).toBe('deadbeef1234');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin', TARGET],
      expect.objectContaining({ cwd: WORKSPACE }),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['fetch', 'origin', BRANCH],
      expect.objectContaining({ cwd: WORKSPACE }),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['merge-base', '--is-ancestor', `origin/${TARGET}`, `origin/${BRANCH}`],
      expect.objectContaining({ cwd: WORKSPACE }),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-parse', `origin/${BRANCH}`],
      expect.objectContaining({ cwd: WORKSPACE }),
    );
  });

  it('returns alreadyRebased=false when branch is behind target', async () => {
    // is-ancestor exits non-zero → branch does NOT contain target
    mockExecFile
      .mockResolvedValueOnce({ stdout: '', stderr: '' })   // fetch origin/target
      .mockResolvedValueOnce({ stdout: '', stderr: '' })   // fetch origin/branch
      .mockRejectedValueOnce(new Error('exit code 1'));    // merge-base --is-ancestor fails

    const result = await isBranchAlreadyRebased(WORKSPACE, BRANCH, TARGET);

    expect(result.alreadyRebased).toBe(false);
    expect(result.currentHead).toBeUndefined();
  });

  it('returns alreadyRebased=false when fetch fails', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('network error'));

    const result = await isBranchAlreadyRebased(WORKSPACE, BRANCH, TARGET);

    expect(result.alreadyRebased).toBe(false);
    expect(result.currentHead).toBeUndefined();
  });
});
