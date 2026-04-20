/**
 * Tests for checkUncommittedChanges pre-flight helper.
 *
 * Covers:
 *  - monorepo: single top-level .git, clean and dirty
 *  - polyrepo: multiple sub-dirs each with .git, clean and dirty
 *  - graceful handling when git is unavailable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockExecFn = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: mockExecFn,
  };
});

vi.mock('../../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: vi.fn().mockReturnValue(null),
  syncBeadStatusToVBrief: vi.fn().mockReturnValue(null),
}));

describe('checkUncommittedChanges', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    tempDir = mkdtempSync(join(tmpdir(), 'pan-preflight-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Monorepo (top-level .git) ──────────────────────────────────────────────

  it('monorepo: returns empty array when working tree is clean', async () => {
    // Create .git dir to signal monorepo
    mkdirSync(join(tempDir, '.git'));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    expect(result).toEqual([]);
  });

  it('monorepo: returns failure lines when there are uncommitted changes', async () => {
    mkdirSync(join(tempDir, '.git'));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: ' M src/foo.ts\n?? src/bar.ts\n', stderr: '' });
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toBe('  Uncommitted changes:');
    expect(result[1]).toContain('src/foo.ts');
    expect(result[2]).toContain('src/bar.ts');
  });

  it('monorepo: returns empty array when git is unavailable', async () => {
    mkdirSync(join(tempDir, '.git'));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('git: command not found'), { stdout: '', stderr: '' });
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    expect(result).toEqual([]);
  });

  // ── Polyrepo (sub-dirs with .git) ─────────────────────────────────────────

  it('polyrepo: returns empty array when all sub-repos are clean', async () => {
    // No top-level .git; two sub-dirs each have .git
    const subA = join(tempDir, 'repo-a');
    const subB = join(tempDir, 'repo-b');
    mkdirSync(join(subA, '.git'), { recursive: true });
    mkdirSync(join(subB, '.git'), { recursive: true });

    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '', stderr: '' });
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    expect(result).toEqual([]);
  });

  it('polyrepo: reports dirty sub-repos individually', async () => {
    const subA = join(tempDir, 'repo-a');
    const subB = join(tempDir, 'repo-b');
    mkdirSync(join(subA, '.git'), { recursive: true });
    mkdirSync(join(subB, '.git'), { recursive: true });

    mockExecFn.mockImplementation((cmd: string, opts: any, cb: Function) => {
      if (opts?.cwd?.endsWith('repo-a')) {
        cb(null, { stdout: ' M dirty-file.ts\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    expect(result.some((l) => l.includes('repo-a'))).toBe(true);
    expect(result.some((l) => l.includes('dirty-file.ts'))).toBe(true);
    // repo-b is clean — should not appear
    expect(result.some((l) => l.includes('repo-b'))).toBe(false);
  });

  it('polyrepo: skips hidden directories (starting with .)', async () => {
    // .hidden-dir has a .git but should be ignored
    const hiddenDir = join(tempDir, '.hidden-repo');
    mkdirSync(join(hiddenDir, '.git'), { recursive: true });

    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: ' M some-file.ts\n', stderr: '' });
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    // Hidden dir is skipped — no failures
    expect(result).toEqual([]);
  });

  it('polyrepo: skips sub-dirs without .git', async () => {
    // sub-dir has no .git — should not trigger any git status
    mkdirSync(join(tempDir, 'not-a-repo'));
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: ' M stray-file.ts\n', stderr: '' });
    });

    const { checkUncommittedChanges } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkUncommittedChanges(tempDir);
    expect(result).toEqual([]);
  });
});
