/**
 * PAN-4223 FR-16: `pan tell` refuses to re-task a critic or verifier lane
 * that already filed its done verdict, unless --force. Other lanes deliver.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
  exitCli: vi.fn(async (_code: number) => undefined as never),
  rows: {} as Record<string, { id: number; laneRole: string | null; laneKey: string | null }>,
  reports: {} as Record<string, { status: string } | null>,
}));

vi.mock('../../../lib/agents.js', () => ({
  resolveAgentTarget: (id: string) => id.toLowerCase(),
  getAgentState: () => null,
  messageAgent: mocks.messageAgent,
}));
vi.mock('../../../lib/work-agent-lifecycle.js', () => ({ issueOwesRework: vi.fn(async () => false) }));
vi.mock('../../exit.js', () => ({ exitCli: mocks.exitCli }));
vi.mock('../../../lib/remote/index.js', () => ({ loadRemoteAgentState: () => null, sendToRemoteAgent: vi.fn() }));
vi.mock('../../../lib/overdeck/conversations.js', () => ({
  getConversationByName: (name: string) => mocks.rows[name] ?? null,
}));
vi.mock('../../../lib/agents/worker/report.js', () => ({
  latestWorkerReport: async (id: string) => mocks.reports[id] ?? null,
}));

const { tellCommand } = await import('../tell.js');

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  mocks.rows = {
    'critic-lane': { id: 42, laneRole: 'critic', laneKey: '663' },
    'verifier-lane': { id: 43, laneRole: 'verifier', laneKey: '663' },
    'builder-lane': { id: 44, laneRole: 'builder', laneKey: '663' },
  };
  mocks.reports = {
    'conv-critic-lane': { status: 'done' },
    'conv-verifier-lane': { status: 'done' },
    'conv-builder-lane': { status: 'done' },
  };
});

describe('pan tell lane guard (PAN-4223 FR-16)', () => {
  it('refuses a critic lane with a done verdict and names the fresh-lane command', async () => {
    await tellCommand('conv-critic-lane', 'look again');
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.exitCli).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(
      'conv 42 is a critic lane that already filed its verdict. Launch a fresh one: pan lane start --role critic --for 663',
    ));
  });

  it('refuses a verifier lane the same way', async () => {
    await tellCommand('conv-verifier-lane', 'look again');
    expect(mocks.messageAgent).not.toHaveBeenCalled();
    expect(mocks.exitCli).toHaveBeenCalledWith(1);
  });

  it('delivers with --force', async () => {
    await tellCommand('conv-critic-lane', 'look again', { force: true });
    expect(mocks.messageAgent).toHaveBeenCalledWith('conv-critic-lane', 'look again', 'pan-tell', expect.any(Object));
    expect(mocks.exitCli).toHaveBeenCalledWith(0);
  });

  it('delivers to a builder lane with a done report, and to a critic still working', async () => {
    await tellCommand('conv-builder-lane', 'next iteration');
    mocks.reports['conv-critic-lane'] = { status: 'blocked' };
    await tellCommand('conv-critic-lane', 'here is your ruling');
    expect(mocks.messageAgent).toHaveBeenCalledTimes(2);
    expect(mocks.exitCli).not.toHaveBeenCalledWith(1);
  });
});
