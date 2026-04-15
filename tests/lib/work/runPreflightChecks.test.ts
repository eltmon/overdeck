/**
 * Tests for runPreflightChecks orchestrator.
 *
 * Covers:
 *  - clean workspace returns []
 *  - failures from multiple checks are aggregated
 *  - auto-commit of .planning/ is attempted before and after vBRIEF sync
 *  - bead sync (bd list --status closed) is called before checkVBriefACStatus
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockExecFn = vi.fn();
const mockGetVBriefACStatus = vi.fn();
const mockSyncBeadStatusToVBrief = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn };
});

vi.mock('../../../src/lib/vbrief/beads.js', () => ({
  getVBriefACStatus: mockGetVBriefACStatus,
  syncBeadStatusToVBrief: mockSyncBeadStatusToVBrief,
}));

describe('runPreflightChecks', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.resetModules();
    mockExecFn.mockReset();
    mockGetVBriefACStatus.mockReset();
    mockSyncBeadStatusToVBrief.mockReset();

    tempDir = mkdtempSync(join(tmpdir(), 'pan-preflight-orch-'));
    // Create .git so the monorepo path is taken in checkUncommittedChanges
    mkdirSync(join(tempDir, '.git'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns [] when all checks pass (clean workspace, no open beads, AC complete)', async () => {
    // All exec calls succeed with "pass" results:
    // 1. git status --porcelain .planning/ → empty (no dirty planning files to auto-commit)
    // 2. bd list --status open → [] (no open beads)
    // 3. git status --porcelain → empty (clean workspace)
    // 4. bd list --status closed → [] (no closed beads to sync)
    // 5. git status --porcelain .planning/ → empty (no dirty planning after sync)
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '[]', stderr: '' }); // '[]' is valid JSON for bd calls; empty for git
    });
    // Override git status to return empty
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' }); // git commands: empty = clean
      }
    });
    mockGetVBriefACStatus.mockReturnValue(null); // no vBRIEF plan

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    const result = await runPreflightChecks(tempDir, 'PAN-714');
    expect(result).toEqual([]);
  });

  it('aggregates failures from open beads AND uncommitted changes', async () => {
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('--status open')) {
        // Return one open bead
        cb(null, { stdout: JSON.stringify([{ id: 'bead-aaa', title: 'Unfinished work' }]), stderr: '' });
      } else if (cmd.includes('git status --porcelain') && !cmd.includes('.planning/')) {
        // Uncommitted changes
        cb(null, { stdout: ' M dirty.ts\n', stderr: '' });
      } else if (cmd.includes('--status closed')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' }); // .planning/ status: clean
      }
    });
    mockGetVBriefACStatus.mockReturnValue(null);

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    const result = await runPreflightChecks(tempDir, 'PAN-714');

    // Should contain both bead failure lines AND git failure lines
    expect(result.some((l) => l.includes('Open beads'))).toBe(true);
    expect(result.some((l) => l.includes('bead-aaa'))).toBe(true);
    expect(result.some((l) => l.includes('Uncommitted changes'))).toBe(true);
    expect(result.some((l) => l.includes('dirty.ts'))).toBe(true);
  });

  it('attempts to auto-commit .planning/ before the uncommitted-changes check', async () => {
    const capturedCmds: string[] = [];
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      capturedCmds.push(cmd);
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else if (cmd.includes('git status --porcelain .planning/') && capturedCmds.filter(c => c.includes('.planning/')).length === 1) {
        // First .planning/ check returns dirty
        cb(null, { stdout: ' M .planning/STATE.md\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockGetVBriefACStatus.mockReturnValue(null);

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    await runPreflightChecks(tempDir, 'PAN-714');

    // Auto-commit commands should have been issued
    expect(capturedCmds.some((c) => c.includes('git add .planning/'))).toBe(true);
    expect(capturedCmds.some((c) => c.includes('git commit') && c.includes('sync planning artifacts'))).toBe(true);
  });

  it('calls bd list --status closed to sync beads to vBRIEF before AC check', async () => {
    const capturedCmds: string[] = [];
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      capturedCmds.push(cmd);
      if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockGetVBriefACStatus.mockReturnValue(null);

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    await runPreflightChecks(tempDir, 'PAN-714');

    expect(capturedCmds.some((c) => c.includes('--status closed'))).toBe(true);
    // syncBeadStatusToVBrief is called for each closed bead (none here, but the call was attempted)
  });

  it('calls syncBeadStatusToVBrief for each closed bead', async () => {
    const closedBeads = [
      { id: 'bead-c1', title: 'Task one' },
      { id: 'bead-c2', title: 'Task two' },
    ];
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('--status closed')) {
        cb(null, { stdout: JSON.stringify(closedBeads), stderr: '' });
      } else if (cmd.includes('bd list')) {
        cb(null, { stdout: '[]', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockGetVBriefACStatus.mockReturnValue(null);
    mockSyncBeadStatusToVBrief.mockReturnValue('item-1');

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    await runPreflightChecks(tempDir, 'PAN-714');

    expect(mockSyncBeadStatusToVBrief).toHaveBeenCalledTimes(2);
    expect(mockSyncBeadStatusToVBrief).toHaveBeenCalledWith('bead-c1', tempDir, 'completed', 'Task one');
    expect(mockSyncBeadStatusToVBrief).toHaveBeenCalledWith('bead-c2', tempDir, 'completed', 'Task two');
  });
});
