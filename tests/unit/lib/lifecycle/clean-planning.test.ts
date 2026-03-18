import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

import { cleanPlanningArtifacts } from '../../../../src/lib/lifecycle/clean-planning.js';

describe('cleanPlanningArtifacts', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `panopticon-clean-planning-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should skip when no ephemeral planning files are tracked', async () => {
    // git ls-files returns empty for all files → nothing tracked
    mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const ctx = { issueId: 'PAN-337', projectPath: testDir };
    const result = await cleanPlanningArtifacts(ctx);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details?.[0]).toContain('No tracked ephemeral planning files found');
  });

  it('should remove tracked STATE.md and commit', async () => {
    // ls-files returns STATE.md as tracked, others empty
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes('ls-files') && cmd.includes('STATE.md')) {
        return Promise.resolve({ stdout: '.planning/STATE.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (cmd.includes('git diff --cached --quiet')) {
        // Throw to indicate staged changes exist
        return Promise.reject(new Error('exit 1'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const ctx = { issueId: 'PAN-337', projectPath: testDir };
    const result = await cleanPlanningArtifacts(ctx);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.details?.[0]).toContain('Removed 1 ephemeral planning file(s)');

    // Verify git rm was called
    const gitRmCall = mockExecAsync.mock.calls.find(
      (call: string[]) => call[0].includes('git rm'),
    );
    expect(gitRmCall).toBeDefined();
    expect(gitRmCall![0]).toContain('.planning/STATE.md');

    // Verify commit was made with issueId in message
    const commitCall = mockExecAsync.mock.calls.find(
      (call: string[]) => call[0].includes('git commit'),
    );
    expect(commitCall).toBeDefined();
    expect(commitCall![0]).toContain('PAN-337');
  });

  it('should remove tracked feedback/ directory and commit', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes('ls-files') && cmd.includes('feedback')) {
        return Promise.resolve({ stdout: '.planning/feedback/001-test.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (cmd.includes('git diff --cached --quiet')) {
        return Promise.reject(new Error('exit 1'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const ctx = { issueId: 'PAN-337', projectPath: testDir };
    const result = await cleanPlanningArtifacts(ctx);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);

    const gitRmCall = mockExecAsync.mock.calls.find(
      (call: string[]) => call[0].includes('git rm'),
    );
    expect(gitRmCall).toBeDefined();
    expect(gitRmCall![0]).toContain('.planning/feedback/');
  });

  it('should skip commit when git rm produces no staged changes', async () => {
    // Files are "tracked" by ls-files but git rm produces no diff (already removed)
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes('ls-files') && cmd.includes('STATE.md')) {
        return Promise.resolve({ stdout: '.planning/STATE.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (cmd.includes('git diff --cached --quiet')) {
        // No staged changes
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const ctx = { issueId: 'PAN-337', projectPath: testDir };
    const result = await cleanPlanningArtifacts(ctx);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.details?.[0]).toContain('already clean');

    // Verify no commit was made
    const commitCall = mockExecAsync.mock.calls.find(
      (call: string[]) => call[0].includes('git commit'),
    );
    expect(commitCall).toBeUndefined();
  });

  it('should remove multiple tracked files in one git rm call', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes('ls-files') && cmd.includes('STATE.md')) {
        return Promise.resolve({ stdout: '.planning/STATE.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files') && cmd.includes('PLANNING_PROMPT.md') && !cmd.includes('archived')) {
        return Promise.resolve({ stdout: '.planning/PLANNING_PROMPT.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files') && cmd.includes('archived')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (cmd.includes('ls-files') && cmd.includes('feedback')) {
        return Promise.resolve({ stdout: '.planning/feedback/001-test.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (cmd.includes('git diff --cached --quiet')) {
        return Promise.reject(new Error('exit 1'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const ctx = { issueId: 'PAN-337', projectPath: testDir };
    const result = await cleanPlanningArtifacts(ctx);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.details?.[0]).toContain('Removed 3 ephemeral planning file(s)');
  });

  it('should return failed when git rm throws unexpectedly', async () => {
    mockExecAsync.mockImplementation((cmd: string) => {
      if (cmd.includes('ls-files') && cmd.includes('STATE.md')) {
        return Promise.resolve({ stdout: '.planning/STATE.md\n', stderr: '' });
      }
      if (cmd.includes('ls-files')) {
        return Promise.resolve({ stdout: '', stderr: '' });
      }
      if (cmd.includes('git rm')) {
        return Promise.reject(new Error('permission denied'));
      }
      return Promise.resolve({ stdout: '', stderr: '' });
    });

    const ctx = { issueId: 'PAN-337', projectPath: testDir };
    const result = await cleanPlanningArtifacts(ctx);

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain('permission denied');
  });
});
