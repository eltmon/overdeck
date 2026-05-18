/**
 * Tests for checkOpenBeads pre-flight helper.
 *
 * Exercises the open-bead check without invoking the actual `bd` CLI by
 * mocking child_process.execFile at the module level. The SUT uses
 * execFile (not exec) for the bd call so the issueId never goes through a shell.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFn = vi.fn();

// execFile mock delegates to mockExecFn so tests that only set up exec
// implementations also cover the bd list calls done-preflight makes via execFile.
const mockExecFileFn = vi.fn((...args: any[]) => {
  const lastArg = args[args.length - 1];
  const callback = typeof lastArg === 'function' ? lastArg : undefined;
  const file = args[0];
  const cmdArgs = Array.isArray(args[1]) ? args[1] : [];
  const cmd = [file, ...cmdArgs].join(' ');
  if (callback) {
    return mockExecFn(cmd, {}, callback);
  }
  return Promise.resolve({ stdout: '', stderr: '' });
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: mockExecFn,
    execFile: mockExecFileFn,
  };
});

// Mock vbrief/beads to avoid its own child_process dependencies
vi.mock('../../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: vi.fn().mockReturnValue(null),
  syncBeadStatusToVBrief: vi.fn().mockReturnValue(null),
}));

describe('checkOpenBeads', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecFileFn.mockReset();
  });

  it('returns empty array when no open beads exist', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: '[]', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-714');
    expect(result).toEqual([]);
  });

  it('returns failure lines when open beads exist', async () => {
    const beads = [
      { id: 'bead-abc', title: 'Implement feature X' },
      { id: 'bead-def', title: 'Write tests' },
    ];
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify(beads), stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-714');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatch(/Open beads \(2\)/);
    expect(result[1]).toContain('bead-abc');
    expect(result[1]).toContain('Implement feature X');
    expect(result[2]).toContain('bead-def');
  });

  it('honors a workspace beads redirect before reading stale local JSONL', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'pan-beads-redirect-'));
    try {
      const projectDir = join(tempDir, 'project');
      const workspaceDir = join(projectDir, 'workspaces', 'feature-pan-1');
      const canonicalBeadsDir = join(projectDir, '.beads');
      const staleBeadsDir = join(workspaceDir, '.beads');
      mkdirSync(canonicalBeadsDir, { recursive: true });
      mkdirSync(staleBeadsDir, { recursive: true });
      writeFileSync(join(staleBeadsDir, 'redirect'), '../../.beads');
      writeFileSync(
        join(staleBeadsDir, 'issues.jsonl'),
        `${JSON.stringify({ id: 'stale-open', title: 'Stale open', status: 'open', labels: ['pan-1'] })}\n`,
      );
      writeFileSync(
        join(canonicalBeadsDir, 'issues.jsonl'),
        `${JSON.stringify({ id: 'closed-real', title: 'Closed real', status: 'closed', labels: ['pan-1'] })}\n`,
      );

      const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
      const result = await checkOpenBeads(workspaceDir, 'PAN-1');
      expect(result).toEqual([]);
      expect(mockExecFileFn).not.toHaveBeenCalled();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the title field when task/subject are absent', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify([{ id: 'bead-xyz', title: 'My task' }]), stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result[1]).toContain('My task');
  });

  it('falls back to "untitled" when no title field is present', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify([{ id: 'bead-nnn' }]), stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result[1]).toContain('untitled');
  });

  it('passes the issueId lowercased in the bd args', async () => {
    let capturedArgs: string[] = [];
    mockExecFileFn.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      capturedArgs = args;
      cb(null, { stdout: '[]', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    await checkOpenBeads('/fake/workspace', 'PAN-714');
    expect(capturedArgs).toContain('pan-714');
  });

  it('returns empty array when bd CLI is not installed (ENOENT)', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error('spawn bd ENOENT'), { code: 'ENOENT' });
      cb(err, { stdout: '', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result).toEqual([]);
  });

  it('returns empty array when bd CLI is not installed (exit 127)', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error('Command failed: bd list --status open'), { code: 127 });
      cb(err, { stdout: '', stderr: 'bd: not found' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result).toEqual([]);
  });

  it('returns failure message when bd command fails with non-ENOENT error', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('bd exited with code 1'), { stdout: '', stderr: 'error' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/Open beads check failed/);
  });

  it('returns failure message when bd returns invalid JSON', async () => {
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: 'not-json', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/invalid output/);
  });
});
