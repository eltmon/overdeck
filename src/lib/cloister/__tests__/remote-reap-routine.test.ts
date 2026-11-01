import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reapCompletedRemoteAgents: vi.fn(),
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../remote/remote-completion.js', () => ({
  reapCompletedRemoteAgents: mocks.reapCompletedRemoteAgents,
}));

vi.mock('../../activity-logger.js', () => ({
  emitActivityEntry: mocks.emitActivityEntry,
}));

import { reapFinishedRemoteAgents } from '../remote-reap-routine.js';

const result = (issueId: string, status: string, details: string[] = ['detail']) => ({
  agentId: `agent-${issueId.toLowerCase()}`,
  issueId,
  status,
  details,
});

describe('reapFinishedRemoteAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('returns nothing and emits no activity for still-running, indeterminate and stale results', async () => {
    mocks.reapCompletedRemoteAgents.mockResolvedValue([
      result('PAN-1', 'still-running'),
      result('PAN-2', 'indeterminate'),
      result('PAN-3', 'stale'),
    ]);

    await expect(reapFinishedRemoteAgents()).resolves.toEqual([]);
    expect(mocks.emitActivityEntry).not.toHaveBeenCalled();
  });

  it('reports handed-off and error results as info and warn activity entries', async () => {
    mocks.reapCompletedRemoteAgents.mockResolvedValue([
      result('PAN-4', 'handed-off', ['a', 'b']),
      result('PAN-5', 'error', ['crash']),
    ]);

    const actions = await reapFinishedRemoteAgents();

    expect(actions).toEqual([
      'Remote reap PAN-4: handed-off (a; b)',
      'Remote reap PAN-5: error (crash)',
    ]);
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(2);
    expect(mocks.emitActivityEntry).toHaveBeenNthCalledWith(1, {
      source: 'cloister',
      level: 'info',
      message: 'Remote reap PAN-4: handed-off (a; b)',
    });
    expect(mocks.emitActivityEntry).toHaveBeenNthCalledWith(2, {
      source: 'cloister',
      level: 'warn',
      message: 'Remote reap PAN-5: error (crash)',
    });
  });

  it('skips a call that arrives while the previous reap is still running', async () => {
    let release: (value: unknown[]) => void = () => undefined;
    mocks.reapCompletedRemoteAgents.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    const first = reapFinishedRemoteAgents();
    await expect(reapFinishedRemoteAgents()).resolves.toEqual([]);
    release([]);
    await expect(first).resolves.toEqual([]);

    expect(mocks.reapCompletedRemoteAgents).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when there are no active remote agents', async () => {
    mocks.reapCompletedRemoteAgents.mockResolvedValue([]);

    await expect(reapFinishedRemoteAgents()).resolves.toEqual([]);
    expect(mocks.emitActivityEntry).not.toHaveBeenCalled();
  });
});
