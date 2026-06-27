import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  emitActivityEntrySync: vi.fn(),
  getNoResumeMode: vi.fn(),
  isIssueClosed: vi.fn(),
  listRunningAgents: vi.fn(),
  listProjectsSync: vi.fn(),
  listSessionNames: vi.fn(),
  reapIssueResidue: vi.fn(),
  resolveProjectForIssue: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  listRunningAgents: mocks.listRunningAgents,
  stopAgent: mocks.stopAgent,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../../paths.js', () => ({
  get AGENTS_DIR() {
    return `${process.env.OVERDECK_HOME ?? '/tmp'}/agents`;
  },
}));

vi.mock('../../projects.js', () => ({
  listProjectsSync: mocks.listProjectsSync,
}));

vi.mock('../../pan-dir/record.js', () => ({
  resolveProjectForIssue: mocks.resolveProjectForIssue,
}));

vi.mock('../../tmux.js', () => ({
  listSessionNames: mocks.listSessionNames,
}));

vi.mock('../no-resume-mode.js', () => ({
  getNoResumeMode: mocks.getNoResumeMode,
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

vi.mock('../reap-issue-residue.js', () => ({
  reapIssueResidue: mocks.reapIssueResidue,
}));

import { reconcileClosedIssueAgents } from '../closed-issue-reaper.js';

describe('reconcileClosedIssueAgents', () => {
  let overdeckHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    overdeckHome = mkdtempSync(join(tmpdir(), 'closed-issue-reaper-'));
    process.env.OVERDECK_HOME = overdeckHome;
    mocks.getNoResumeMode.mockReturnValue({ active: false, since: null });
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.listProjectsSync.mockReturnValue([]);
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.reapIssueResidue.mockResolvedValue([]);
    mocks.resolveProjectForIssue.mockReturnValue(null);
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(false);
  });

  afterEach(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
    delete process.env.OVERDECK_HOME;
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
    expect(mocks.emitActivityEntrySync).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(mocks.emitActivityEntrySync).not.toHaveBeenCalled();
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
    mocks.getNoResumeMode.mockReturnValue({ active: false, since: null });
    mocks.listSessionNames.mockReturnValue(Effect.succeed([]));
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);
    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });

  it('stops inspect-shaped tmux sessions whose parent issue is closed', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed([
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

  it('stops strike-shaped tmux sessions whose parent issue is closed (PAN-1721)', async () => {
    mocks.listSessionNames.mockReturnValue(Effect.succeed([
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

  it('does not reap closed-issue agents when no-resume mode is active', async () => {
    mocks.getNoResumeMode.mockReturnValue({ active: true, since: '2026-06-08T12:00:00.000Z' });
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([
      { id: 'agent-pan-1613', issueId: 'PAN-1613', role: 'work', status: 'running' },
    ]));
    mocks.listSessionNames.mockReturnValue(Effect.succeed(['inspect-pan-1613-workspace-rn3ha']));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);

    expect(mocks.listRunningAgents).not.toHaveBeenCalled();
    expect(mocks.listSessionNames).not.toHaveBeenCalled();
    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.reapIssueResidue).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
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
});
