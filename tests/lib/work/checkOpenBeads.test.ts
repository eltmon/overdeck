/**
 * Tests for checkOpenBeads pre-flight helper.
 *
 * Exercises the open-bead check without invoking the actual `bd` CLI by
 * mocking child_process.exec at the module level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFn = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    exec: mockExecFn,
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
    mockExecFn.mockReset();
  });

  it('returns empty array when no open beads exist', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
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
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
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

  it('uses the title field when task/subject are absent', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify([{ id: 'bead-xyz', title: 'My task' }]), stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result[1]).toContain('My task');
  });

  it('falls back to "untitled" when no title field is present', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: JSON.stringify([{ id: 'bead-nnn' }]), stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result[1]).toContain('untitled');
  });

  it('passes the issueId lowercased in the bd command', async () => {
    let capturedCmd = '';
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      capturedCmd = cmd;
      cb(null, { stdout: '[]', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    await checkOpenBeads('/fake/workspace', 'PAN-714');
    expect(capturedCmd).toContain('pan-714');
  });

  it('returns empty array when bd CLI is not installed (ENOENT)', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error('spawn bd ENOENT'), { code: 'ENOENT' });
      cb(err, { stdout: '', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result).toEqual([]);
  });

  it('returns empty array when bd CLI is not installed (shell exit 127)', async () => {
    // exec() runs through /bin/sh; missing command exits 127 (not ENOENT)
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      const err = Object.assign(new Error('Command failed: bd list --status open'), { code: 127 });
      cb(err, { stdout: '', stderr: '/bin/sh: bd: not found' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result).toEqual([]);
  });

  it('returns failure message when bd command fails with non-ENOENT error', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(new Error('bd exited with code 1'), { stdout: '', stderr: 'error' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/Open beads check failed/);
  });

  it('returns failure message when bd returns invalid JSON', async () => {
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: 'not-json', stderr: '' });
    });

    const { checkOpenBeads } = await import('../../../src/lib/work/done-preflight.js');
    const result = await checkOpenBeads('/fake/workspace', 'PAN-1');
    expect(result.length).toBe(1);
    expect(result[0]).toMatch(/invalid output/);
  });
});
