import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  emitActivityEntry: vi.fn(),
  exec: vi.fn(),
  getPrFacts: vi.fn(),
  isIssueClosed: vi.fn(),
  listRunningAgents: vi.fn(),
  listProjectsSync: vi.fn(),
  listLiveAgentIds: vi.fn(),
  reapIssueResidue: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: mocks.exec,
  };
});

vi.mock('../../agents.js', () => ({
  listRunningAgents: mocks.listRunningAgents,
  stopAgent: mocks.stopAgent,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: mocks.emitActivityEntry,
}));

vi.mock('../../paths.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../paths.js')>()),
  get AGENTS_DIR() {
    return `${process.env.OVERDECK_HOME ?? '/tmp'}/agents`;
  },
}));

vi.mock('../../projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
}));

vi.mock('../../overdeck/issue-projects.js', () => ({
  resolveProjectForIssue: mocks.resolveProjectForIssue,
}));

// PAN-3917: the by-name backstop sweeps the SELECTED backend's inventory, not
// a tmux census — under Herdr there is no tmux session to list.
vi.mock('../../terminal-backends/inventory.js', () => ({
  listLiveAgentIds: mocks.listLiveAgentIds,
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../reap-issue-residue.js', () => ({
  reapIssueResidue: mocks.reapIssueResidue,
}));

// PAN-3917: "did this issue's PR merge?" is the forge's answer now.
vi.mock('../pr-facts.js', () => ({
  getPrFacts: mocks.getPrFacts,
}));

import {
  clearReapedResidueMemo,
  REAPED_RESIDUE_RECHECK_MS,
  reconcileClosedIssueAgents,
} from '../closed-issue-reaper.js';

describe('reconcileClosedIssueAgents', () => {
  let overdeckHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    clearReapedResidueMemo();
    overdeckHome = mkdtempSync(join(tmpdir(), 'closed-issue-reaper-'));
    process.env.OVERDECK_HOME = overdeckHome;
    delete process.env.OVERDECK_NO_RESUME;
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.listProjectsSync.mockReturnValue([]);
    mocks.listLiveAgentIds.mockResolvedValue(new Set<string>());
    mocks.getPrFacts.mockResolvedValue({ merged: false });
    mocks.reapIssueResidue.mockResolvedValue([]);
    mocks.resolveProjectForIssue.mockReturnValue(null);
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(false);
    mocks.exec.mockImplementation((_command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      cb?.(null, { stdout: '', stderr: '' });
      return { on: vi.fn() };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(overdeckHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
    delete process.env.OVERDECK_NO_RESUME;
  });

  it('stops running agents whose parent issue is closed', async () => {
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-1613-ship', issueId: 'PAN-1613', role: 'ship', status: 'running' },
      { id: 'agent-pan-1614', issueId: 'PAN-1614', role: 'work', status: 'running' },
      { id: 'agent-pan-1615', issueId: 'PAN-1615', role: 'work', status: 'stopped' },
    ]));
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-1613');

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped agent-pan-1613-ship — parent issue PAN-1613 is closed',
    ]);

    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledWith('agent-pan-1613-ship');
    expect(mocks.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      source: 'cloister',
      level: 'info',
      issueId: 'PAN-1613',
      message: '[deacon] reaped agent-pan-1613-ship — parent issue PAN-1613 is closed',
    }));
  });

  it('does not stop open issues, verifying-on-main issues, or already stopped agents', async () => {
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-2001', issueId: 'PAN-2001', role: 'work', status: 'running' },
      { id: 'agent-pan-2002-ship', issueId: 'PAN-2002', role: 'ship', status: 'running' },
      { id: 'agent-pan-2003', issueId: 'PAN-2003', role: 'work', status: 'stopped' },
    ]));
    mocks.isIssueClosed.mockResolvedValue(false);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.stopAgent).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntry).not.toHaveBeenCalled();
  });

  it('evaluates isIssueClosed once per distinct issue per pass and is idempotent after agents are stopped', async () => {
    mocks.listRunningAgents
      .mockReturnValueOnce(Effect.succeed([
        { id: 'agent-pan-3001', issueId: 'PAN-3001', role: 'work', status: 'running' },
        { id: 'agent-pan-3001-review', issueId: 'PAN-3001', role: 'review', status: 'running' },
      ]))
      .mockReturnValueOnce(Effect.succeed([
        { id: 'agent-pan-3001', issueId: 'PAN-3001', role: 'work', status: 'stopped' },
        { id: 'agent-pan-3001-review', issueId: 'PAN-3001', role: 'review', status: 'stopped' },
      ]));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped agent-pan-3001 — parent issue PAN-3001 is closed',
      'Reaped agent-pan-3001-review — parent issue PAN-3001 is closed',
    ]);
    expect(mocks.isIssueClosed).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    mocks.listLiveAgentIds.mockResolvedValue(new Set<string>());
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);
    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });

  it('stops inspect-shaped backend panes whose parent issue is closed', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(new Set([
      'inspect-pan-1613-workspace-rn3ha',
      'inspect-pan-1614-workspace-b95lw',
      'agent-pan-1613',
    ]));
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-1613');

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped inspect-pan-1613-workspace-rn3ha — parent issue PAN-1613 is closed',
    ]);

    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledWith('inspect-pan-1613-workspace-rn3ha');
    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-1613');
    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-1614');
  });

  it('stops strike-shaped backend panes whose parent issue is closed (PAN-1721)', async () => {
    mocks.listLiveAgentIds.mockResolvedValue(new Set([
      'strike-pan-1716',
      'strike-pan-1717',
      'agent-pan-1716',
    ]));
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-1716');

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped strike-pan-1716 — parent issue PAN-1716 is closed',
    ]);

    expect(mocks.stopAgent).toHaveBeenCalledTimes(1);
    expect(mocks.stopAgent).toHaveBeenCalledWith('strike-pan-1716');
  });

  it('reaps closed-issue agents even when OVERDECK_NO_RESUME was set at boot', async () => {
    process.env.OVERDECK_NO_RESUME = '1';
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-1613', issueId: 'PAN-1613', role: 'work', status: 'running' },
    ]));
    mocks.listLiveAgentIds.mockResolvedValue(new Set(['inspect-pan-1613-workspace-rn3ha']));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([
      'Reaped agent-pan-1613 — parent issue PAN-1613 is closed',
      'Reaped inspect-pan-1613-workspace-rn3ha — parent issue PAN-1613 is closed',
    ]);

    expect(mocks.listRunningAgents).toHaveBeenCalledTimes(1);
    expect(mocks.listLiveAgentIds).toHaveBeenCalledTimes(1);
    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-1613');
    expect(mocks.stopAgent).toHaveBeenCalledWith('agent-pan-1613');
    expect(mocks.stopAgent).toHaveBeenCalledWith('inspect-pan-1613-workspace-rn3ha');
  });

  it('reaps closed pure-disk residue discovered from configured project workspaces', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-5555'), { recursive: true });
    mocks.listProjectsSync.mockReturnValue([{ key: 'overdeck', config: { name: 'Overdeck', path: projectPath } }]);
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-5555');
    mocks.reapIssueResidue.mockResolvedValue(['removed residue PAN-5555']);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual(['removed residue PAN-5555']);

    expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
    expect(mocks.reapIssueResidue).toHaveBeenCalledWith(projectPath, 'PAN-5555');
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reaps closed pure-disk residue discovered from agent state directories', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
    mkdirSync(join(overdeckHome, 'agents', 'agent-pan-5556'), { recursive: true });
    mocks.resolveProjectForIssue.mockReturnValue({ name: 'Overdeck', path: projectPath });
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-5556');
    mocks.reapIssueResidue.mockResolvedValue(['removed agent residue PAN-5556']);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual(['removed agent residue PAN-5556']);

    expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
    expect(mocks.reapIssueResidue).toHaveBeenCalledWith(projectPath, 'PAN-5556');
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('reaps closed-issue residue discovered from leaked _devnet networks', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      const stdout = String(command).includes('docker network ls')
        ? 'myn-feature-min-729_devnet\noverdeck-feature-pan-5558_devnet\nbridge\n'
        : '';
      cb?.(null, { stdout, stderr: '' });
      return { on: vi.fn() };
    });
    mocks.resolveProjectForIssue.mockImplementation((issueId: string) =>
      issueId === 'PAN-5558' ? { name: 'Overdeck', path: projectPath } : null,
    );
    mocks.isIssueClosed.mockImplementation(async (issueId: string) => issueId === 'PAN-5558');
    mocks.reapIssueResidue.mockResolvedValue(['removed network residue PAN-5558']);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual(['removed network residue PAN-5558']);

    expect(mocks.isIssueClosed).toHaveBeenCalledWith('MIN-729');
    expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
    expect(mocks.reapIssueResidue).toHaveBeenCalledWith(projectPath, 'PAN-5558');
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('checks leaked devnet closure state with bounded concurrency', async () => {
    mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
      const cb = typeof opts === 'function' ? opts : callback;
      const stdout = String(command).includes('docker network ls')
        ? Array.from({ length: 6 }, (_, index) => `overdeck-feature-pan-${6000 + index}_devnet`).join('\n')
        : '';
      cb?.(null, { stdout, stderr: '' });
      return { on: vi.fn() };
    });
    let active = 0;
    let maxActive = 0;
    const resolveChecks: Array<() => void> = [];
    mocks.isIssueClosed.mockImplementation(() => new Promise<boolean>((resolve) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      resolveChecks.push(() => {
        active -= 1;
        resolve(false);
      });
    }));

    const reconciliation = reconcileClosedIssueAgents();
    await vi.waitFor(() => expect(mocks.isIssueClosed).toHaveBeenCalledTimes(4));
    expect(maxActive).toBe(4);
    resolveChecks.splice(0, 4).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(mocks.isIssueClosed).toHaveBeenCalledTimes(6));
    resolveChecks.splice(0).forEach((resolve) => resolve());

    await expect(reconciliation).resolves.toEqual([]);
    expect(maxActive).toBe(4);
  });

  it('preserves open pure-disk residue', async () => {
    const projectPath = mkdtempSync(join(tmpdir(), 'open-project-'));
    mkdirSync(join(projectPath, 'workspaces', 'feature-pan-5557'), { recursive: true });
    mocks.listProjectsSync.mockReturnValue([{ key: 'overdeck', config: { name: 'Overdeck', path: projectPath } }]);
    mocks.isIssueClosed.mockResolvedValue(false);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.isIssueClosed).toHaveBeenCalledWith('PAN-5557');
    expect(mocks.reapIssueResidue).not.toHaveBeenCalled();
    rmSync(projectPath, { recursive: true, force: true });
  });

  describe('reaped-residue memo (PAN-5001)', () => {
    it('does not ask the tracker again about an agent dir whose residue it already reaped', async () => {
      const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
      mkdirSync(join(overdeckHome, 'agents', 'agent-pan-7001'), { recursive: true });
      mocks.resolveProjectForIssue.mockReturnValue({ name: 'Overdeck', path: projectPath });
      mocks.isIssueClosed.mockResolvedValue(true);
      mocks.reapIssueResidue.mockResolvedValue(['pruned PAN-7001']);

      await expect(reconcileClosedIssueAgents()).resolves.toEqual(['pruned PAN-7001']);
      await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

      expect(mocks.isIssueClosed).toHaveBeenCalledTimes(1);
      expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(1);
      rmSync(projectPath, { recursive: true, force: true });
    });

    it('skips a reaped workspace dir and a reaped devnet on later passes', async () => {
      const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
      mkdirSync(join(projectPath, 'workspaces', 'feature-pan-7002'), { recursive: true });
      mocks.listProjectsSync.mockReturnValue([{ key: 'overdeck', config: { name: 'Overdeck', path: projectPath } }]);
      mocks.resolveProjectForIssue.mockReturnValue({ name: 'Overdeck', path: projectPath });
      mocks.exec.mockImplementation((command: string, opts: unknown, callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void) => {
        const cb = typeof opts === 'function' ? opts : callback;
        const stdout = String(command).includes('docker network ls') ? 'overdeck-feature-pan-7003_devnet\n' : '';
        cb?.(null, { stdout, stderr: '' });
        return { on: vi.fn() };
      });
      mocks.isIssueClosed.mockResolvedValue(true);

      await reconcileClosedIssueAgents();
      expect(mocks.isIssueClosed).toHaveBeenCalledTimes(2);
      expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(2);

      await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);
      expect(mocks.isIssueClosed).toHaveBeenCalledTimes(2);
      expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(2);
      rmSync(projectPath, { recursive: true, force: true });
    });

    it('checks a reaped issue again once the recheck window has passed', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'));
      const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
      mkdirSync(join(overdeckHome, 'agents', 'agent-pan-7004'), { recursive: true });
      mocks.resolveProjectForIssue.mockReturnValue({ name: 'Overdeck', path: projectPath });
      mocks.isIssueClosed.mockResolvedValue(true);

      await reconcileClosedIssueAgents();
      vi.setSystemTime(Date.now() + REAPED_RESIDUE_RECHECK_MS - 1);
      await reconcileClosedIssueAgents();
      expect(mocks.isIssueClosed).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 1);
      await reconcileClosedIssueAgents();
      expect(mocks.isIssueClosed).toHaveBeenCalledTimes(2);
      expect(mocks.reapIssueResidue).toHaveBeenCalledTimes(2);
      rmSync(projectPath, { recursive: true, force: true });
    });

    it('still stops a running agent whose issue residue was already reaped', async () => {
      const projectPath = mkdtempSync(join(tmpdir(), 'closed-project-'));
      mkdirSync(join(overdeckHome, 'agents', 'agent-pan-7005'), { recursive: true });
      mocks.resolveProjectForIssue.mockReturnValue({ name: 'Overdeck', path: projectPath });
      mocks.isIssueClosed.mockResolvedValue(true);
      await reconcileClosedIssueAgents();

      mocks.listRunningAgents.mockReturnValue(Effect.succeed([
        { id: 'agent-pan-7005', issueId: 'PAN-7005', role: 'work', status: 'running' },
      ]));
      await expect(reconcileClosedIssueAgents()).resolves.toContain(
        'Reaped agent-pan-7005 — parent issue PAN-7005 is closed',
      );
      expect(mocks.stopAgent).toHaveBeenCalledWith('agent-pan-7005');
      rmSync(projectPath, { recursive: true, force: true });
    });
  });
});
