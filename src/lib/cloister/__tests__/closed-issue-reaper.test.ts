import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const mocks = vi.hoisted(() => ({
  emitActivityEntrySync: vi.fn(),
  isIssueClosed: vi.fn(),
  listRunningAgents: vi.fn(),
  stopAgent: vi.fn(),
}));

vi.mock('../../agents.js', () => ({
  listRunningAgents: mocks.listRunningAgents,
  stopAgent: mocks.stopAgent,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntrySync: mocks.emitActivityEntrySync,
}));

vi.mock('../issue-closed.js', () => ({
  isIssueClosed: mocks.isIssueClosed,
}));

import { reconcileClosedIssueAgents } from '../closed-issue-reaper.js';

describe('reconcileClosedIssueAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRunningAgents.mockReturnValue(Effect.succeed([]));
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(false);
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
    mocks.stopAgent.mockReturnValue(Effect.succeed(undefined));
    mocks.isIssueClosed.mockResolvedValue(true);

    await expect(reconcileClosedIssueAgents()).resolves.toEqual([]);
    expect(mocks.isIssueClosed).not.toHaveBeenCalled();
    expect(mocks.stopAgent).not.toHaveBeenCalled();
  });
});
