/**
 * Tests for runPreflightChecks orchestrator.
 *
 * Covers:
 *  - clean workspace returns []
 *  - failures from multiple checks are aggregated
 *  - no commits issued (pure validator)
 *  - bead sync (bd list --status closed) is called before checkVBriefACStatus
 *
 * SUT uses execFile for bd (avoids shell injection of issueId) and exec for git.
 * Both are mocked separately.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockExecFn = vi.fn();
const mockExecFileFn = vi.fn();
const mockGetVBriefACStatus = vi.fn();
const mockSyncBeadStatusToVBrief = vi.fn();

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, exec: mockExecFn, execFile: mockExecFileFn };
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
    mockExecFileFn.mockReset();
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
    // bd list (open + closed) → []
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: '[]', stderr: '' });
    });
    // git status → empty (clean)
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '', stderr: '' });
    });
    mockGetVBriefACStatus.mockReturnValue(null); // no vBRIEF plan

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    const result = await runPreflightChecks(tempDir, 'PAN-714');
    expect(result).toEqual([]);
  });

  it('aggregates failures from open beads AND uncommitted changes', async () => {
    mockExecFileFn.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes('open')) {
        cb(null, { stdout: JSON.stringify([{ id: 'bead-aaa', title: 'Unfinished work' }]), stderr: '' });
      } else {
        // closed beads
        cb(null, { stdout: '[]', stderr: '' });
      }
    });
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      if (cmd.includes('git status --porcelain')) {
        cb(null, { stdout: ' M dirty.ts\n', stderr: '' });
      } else {
        cb(null, { stdout: '', stderr: '' });
      }
    });
    mockGetVBriefACStatus.mockReturnValue(null);

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    const result = await runPreflightChecks(tempDir, 'PAN-714');

    expect(result.some((l) => l.includes('Open beads'))).toBe(true);
    expect(result.some((l) => l.includes('bead-aaa'))).toBe(true);
    expect(result.some((l) => l.includes('Uncommitted changes'))).toBe(true);
    expect(result.some((l) => l.includes('dirty.ts'))).toBe(true);
  });

  it('does NOT issue any git commits (pure validation — no side effects)', async () => {
    const capturedCmds: string[] = [];
    mockExecFn.mockImplementation((cmd: string, _opts: unknown, cb: Function) => {
      capturedCmds.push(cmd);
      cb(null, { stdout: '', stderr: '' });
    });
    mockExecFileFn.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, { stdout: '[]', stderr: '' });
    });
    mockGetVBriefACStatus.mockReturnValue(null);

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    await runPreflightChecks(tempDir, 'PAN-714');

    expect(capturedCmds.some((c) => c.includes('git commit'))).toBe(false);
    expect(capturedCmds.some((c) => c.includes('git add'))).toBe(false);
  });

  it('calls bd list --status closed to sync beads to vBRIEF before AC check', async () => {
    const capturedArgs: string[][] = [];
    mockExecFileFn.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      capturedArgs.push(args);
      cb(null, { stdout: '[]', stderr: '' });
    });
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '', stderr: '' });
    });
    mockGetVBriefACStatus.mockReturnValue(null);

    const { runPreflightChecks } = await import('../../../src/lib/work/done-preflight.js');
    await runPreflightChecks(tempDir, 'PAN-714');

    expect(capturedArgs.some((args) => args.includes('closed'))).toBe(true);
  });

  it('calls syncBeadStatusToVBrief for each closed bead', async () => {
    const closedBeads = [
      { id: 'bead-c1', title: 'Task one' },
      { id: 'bead-c2', title: 'Task two' },
    ];
    mockExecFileFn.mockImplementation((_file: string, args: string[], _opts: unknown, cb: Function) => {
      if (args.includes('closed')) {
        cb(null, { stdout: JSON.stringify(closedBeads), stderr: '' });
      } else {
        // open beads
        cb(null, { stdout: '[]', stderr: '' });
      }
    });
    mockExecFn.mockImplementation((_cmd: string, _opts: unknown, cb: Function) => {
      cb(null, { stdout: '', stderr: '' });
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
