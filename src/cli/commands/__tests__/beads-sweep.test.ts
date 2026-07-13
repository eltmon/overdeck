import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAllBeads = vi.hoisted(() => vi.fn());
const mockSweepOrphanedBeads = vi.hoisted(() => vi.fn());
const mockReadGitHubCloseState = vi.hoisted(() => vi.fn());
const mockResolveProjectFromIssueSync = vi.hoisted(() => vi.fn());
const mockGetProjectSync = vi.hoisted(() => vi.fn());
const mockCwd = vi.hoisted(() => vi.fn(() => '/test-project'));

vi.mock('../../../lib/beads/resolver.js', () => ({
  createBeadsResolver: vi.fn(() => ({
    getAllBeads: mockGetAllBeads,
  })),
}));

vi.mock('../../../lib/lifecycle/orphaned-beads-sweep.js', () => ({
  sweepOrphanedBeads: mockSweepOrphanedBeads,
}));

vi.mock('../close.js', () => ({
  readGitHubCloseState: mockReadGitHubCloseState,
}));

vi.mock('../../../lib/projects.js', () => ({
  resolveProjectFromIssueSync: mockResolveProjectFromIssueSync,
  getProjectSync: mockGetProjectSync,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue(''),
  };
});

import { registerBeadsCommands } from '../beads.js';

describe('pan beads sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'cwd').mockImplementation(mockCwd);
    process.exitCode = undefined;

    mockResolveProjectFromIssueSync.mockImplementation((issueId: string) => ({
      projectKey: 'overdeck',
      projectName: 'Overdeck',
      projectPath: '/test-project',
      linearTeam: issueId.split('-')[0].toUpperCase(),
    }));
    mockGetProjectSync.mockImplementation(() => ({
      name: 'Overdeck',
      path: '/test-project',
      github_repo: 'eltmon/overdeck',
    }));
  });

  function createProgram(): Command {
    const program = new Command();
    registerBeadsCommands(program);
    return program;
  }

  it('dry-run prints per-issue would-close counts and reasons without mutating', async () => {
    mockGetAllBeads.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-1', title: 'Orphan 1', status: 'open', labels: ['pan-2602'] },
        { id: 'bead-2', title: 'Orphan 2', status: 'in_progress', labels: ['pan-2602'] },
      ],
    });
    mockReadGitHubCloseState.mockResolvedValue({ state: 'closed', reason: 'completed' });
    mockSweepOrphanedBeads.mockResolvedValue({ ok: true, closedIds: ['bead-1', 'bead-2'], skipped: 0 });

    const logs: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const program = createProgram();
    await program.parseAsync(['node', 'script', 'beads', 'sweep', '--all-closed', '--dry-run']);

    expect(mockGetAllBeads).toHaveBeenCalledTimes(1);
    expect(mockSweepOrphanedBeads).toHaveBeenCalledWith({
      beadsCwd: '/test-project',
      issueId: 'pan-2602',
      reason: 'issue closed (completed); orphaned bead swept',
      dryRun: true,
    });

    const reportLine = logs.find((line) => line.includes('Would sweep'));
    expect(reportLine).toContain('pan-2602');
    expect(reportLine).toContain('2 bead(s)');
    expect(reportLine).toContain('issue closed (completed); orphaned bead swept');

    const totalLine = logs.find((line) => line.includes('Total:'));
    expect(totalLine).toContain('1 processed, 0 skipped, 0 failed');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('skips GitHub-open issues with orphaned beads and lists them separately', async () => {
    mockGetAllBeads.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-1', title: 'Open orphan', status: 'open', labels: ['pan-2603'] },
      ],
    });
    mockReadGitHubCloseState.mockResolvedValue({ state: 'open', reason: null });

    const logs: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const program = createProgram();
    await program.parseAsync(['node', 'script', 'beads', 'sweep', '--all-closed']);

    expect(mockSweepOrphanedBeads).not.toHaveBeenCalled();

    const skippedLine = logs.find((line) => line.includes('Open with orphaned beads'));
    expect(skippedLine).toContain('pan-2603');

    const totalLine = logs.find((line) => line.includes('Total:'));
    expect(totalLine).toContain('0 processed, 1 skipped, 0 failed');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('uses not-planned default reason for issues closed as not planned', async () => {
    mockGetAllBeads.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-1', title: 'Cancelled orphan', status: 'open', labels: ['pan-2604'] },
      ],
    });
    mockReadGitHubCloseState.mockResolvedValue({ state: 'closed', reason: 'not_planned' });
    mockSweepOrphanedBeads.mockResolvedValue({ ok: true, closedIds: ['bead-1'], skipped: 0 });

    const logs: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const program = createProgram();
    await program.parseAsync(['node', 'script', 'beads', 'sweep', '--all-closed']);

    expect(mockSweepOrphanedBeads).toHaveBeenCalledWith({
      beadsCwd: '/test-project',
      issueId: 'pan-2604',
      reason: 'issue closed (not planned); bead cancelled',
      dryRun: undefined,
    });

    const reportLine = logs.find((line) => line.includes('Swept'));
    expect(reportLine).toContain('issue closed (not planned); bead cancelled');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('--reason overrides the default close reason', async () => {
    mockGetAllBeads.mockResolvedValue({
      ok: true,
      value: [
        { id: 'bead-1', title: 'Orphan', status: 'open', labels: ['pan-2605'] },
      ],
    });
    mockReadGitHubCloseState.mockResolvedValue({ state: 'closed', reason: 'completed' });
    mockSweepOrphanedBeads.mockResolvedValue({ ok: true, closedIds: ['bead-1'], skipped: 0 });

    const program = createProgram();
    await program.parseAsync(['node', 'script', 'beads', 'sweep', '--all-closed', '--reason', 'custom reason']);

    expect(mockSweepOrphanedBeads).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'custom reason' }),
    );
  });

  it('refuses to sweep explicit open issues and reports failure', async () => {
    mockReadGitHubCloseState.mockResolvedValue({ state: 'open', reason: null });

    const logs: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(msg); });

    const program = createProgram();
    await program.parseAsync(['node', 'script', 'beads', 'sweep', 'pan-2606']);

    expect(mockSweepOrphanedBeads).not.toHaveBeenCalled();

    const totalLine = logs.find((line) => line.includes('Total:'));
    expect(totalLine).toContain('0 processed, 1 skipped, 0 failed');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
