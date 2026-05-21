import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted to avoid initialization order issues
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

import { Effect } from 'effect';
import { compactBeads as compactBeadsEffect } from '../../../../src/lib/lifecycle/compact-beads.js';

const compactBeads = (...args: Parameters<typeof compactBeadsEffect>) =>
  Effect.runPromise(compactBeadsEffect(...args));

describe('compact-beads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should skip when bd is not available', async () => {
    mockExecAsync.mockRejectedValue(new Error('command not found: bd'));

    const result = await compactBeads({
      issueId: 'PAN-100',
      projectPath: '/tmp/test',
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('should compact beads when bd is available', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'Compacted 5 beads', stderr: '' });

    const result = await compactBeads({
      issueId: 'PAN-100',
      projectPath: '/tmp/test',
    });

    expect(result.success).toBe(true);
  });

  it('should handle compaction errors gracefully', async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: '/usr/bin/bd', stderr: '' }) // which bd
      .mockRejectedValueOnce(new Error('compaction failed')); // bd compact

    const result = await compactBeads({
      issueId: 'PAN-100',
      projectPath: '/tmp/test',
    });

    // Beads failures are non-fatal — should still report success (skipped)
    expect(result.success).toBe(true);
  });
});
