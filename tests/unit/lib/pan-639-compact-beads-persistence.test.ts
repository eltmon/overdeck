/**
 * PAN-639 regression tests: compact-beads must persist to git.
 *
 * Verifies that beads compaction stages, commits, and pushes changes —
 * the behavior removed by fe2c7803 and restored by PAN-639.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync } from 'fs';

const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('util')>();
  return {
    ...actual,
    promisify: () => mockExecAsync,
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

import { Effect } from 'effect';
import { compactBeads as compactBeadsProgram, type CompactBeadsOptions } from '../../../src/lib/lifecycle/compact-beads.js';

const compactBeads = (...args: Parameters<typeof compactBeadsProgram>) =>
  Effect.runPromise(compactBeadsProgram(...args));

describe('PAN-639: compact-beads git persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should run git add .beads/ after compaction', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })  // which bd
      .mockResolvedValueOnce({ stdout: '3', stderr: '' })             // jq count
      .mockResolvedValueOnce({ stdout: '', stderr: '' })              // bd admin compact
      .mockResolvedValueOnce({ stdout: '', stderr: '' })              // git add .beads/
      .mockRejectedValueOnce(new Error('exit 1'))                     // git diff --cached --quiet (has changes)
      .mockResolvedValueOnce({ stdout: '', stderr: '' })              // git commit
      .mockResolvedValueOnce({ stdout: '', stderr: '' });             // git push

    const result = await compactBeads({ issueId: 'PAN-100', projectPath: '/tmp/test-beads' });

    expect(result.success).toBe(true);

    const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('git add .beads/');
  });

  it('should push to remote by default', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '2', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('exit 1'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await compactBeads({ issueId: 'PAN-100', projectPath: '/tmp/test' });

    expect(result.success).toBe(true);
    const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('git push');
  });

  it('should skip push when pushToRemote is false', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' })
      .mockResolvedValueOnce({ stdout: '1', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('exit 1'))
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await compactBeads(
      { issueId: 'PAN-100', projectPath: '/tmp/test' },
      { pushToRemote: false },
    );

    expect(result.success).toBe(true);
    const calls = mockExecAsync.mock.calls.map((c: any[]) => c[0]);
    expect(calls).not.toContain('git push');
  });

  it('CompactBeadsOptions must include pushToRemote', () => {
    const opts: CompactBeadsOptions = { days: 30, pushToRemote: false };
    expect(opts.pushToRemote).toBe(false);
  });
});
