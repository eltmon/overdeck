/**
 * PAN-4641 WI-8: pan tell --when-limit-resets queues a conversation message
 * on the server through the scheduled-messages door, and refuses agents and
 * --steer without queueing anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doorMocks = vi.hoisted(() => ({
  scheduleConversationMessage: vi.fn(),
}));

const agentMocks = vi.hoisted(() => ({
  messageAgent: vi.fn(async () => ({ delivered: true, queuedToMail: false })),
}));

const exitMocks = vi.hoisted(() => ({
  exitCli: vi.fn(async (_code: number) => undefined as never),
}));

vi.mock('../../agent-target.js', () => ({
  resolveCliSingleAgentId: async (input: string) => ({ ok: true, agentId: input }),
  printAgentTargetFailure: vi.fn(),
}));
vi.mock('../../../lib/agents.js', () => ({
  getAgentState: () => null,
  messageAgent: agentMocks.messageAgent,
}));
vi.mock('../../../lib/work-agent-lifecycle.js', () => ({ issueOwesRework: vi.fn(async () => false) }));
vi.mock('../../../lib/remote/index.js', () => ({ loadRemoteAgentState: () => null, sendToRemoteAgent: vi.fn() }));
vi.mock('../../../lib/cloister/operator-decision.js', () => ({ closeOpenDecisionOnOperatorMessage: () => false }));
vi.mock('../../exit.js', () => ({ exitCli: exitMocks.exitCli }));
vi.mock('../../../lib/overdeck/conversation-scheduled-messages.js', () => doorMocks);

function printed(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => String(call[0])).join('\n');
}

describe('pan tell --when-limit-resets (PAN-4641)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('queues a conversation message and exits 0', async () => {
    doorMocks.scheduleConversationMessage.mockResolvedValue({
      status: 'scheduled',
      limit: null,
      message: { id: 1, notBefore: new Date(Date.now() + 3_600_000).toISOString(), resetSource: 'quota-limits', limitWindow: 'five_hour' },
    });
    const { tellCommand } = await import('../tell.js');

    await tellCommand('conv-x', 'hi', { whenLimitResets: true });

    expect(doorMocks.scheduleConversationMessage).toHaveBeenCalledWith('x', 'hi');
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
    expect(exitMocks.exitCli).toHaveBeenCalledWith(0);
    expect(printed(logSpy)).toContain('Queued for conv-x: sends at about');
    expect(printed(logSpy)).toContain('when the 5-hour limit resets');
  });

  it('refuses an agent target with exit 1 and queues nothing', async () => {
    const { tellCommand } = await import('../tell.js');

    await tellCommand('agent-pan-1', 'hi', { whenLimitResets: true });

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(doorMocks.scheduleConversationMessage).not.toHaveBeenCalled();
    expect(printed(errorSpy)).toContain('works only for conversations; agent-pan-1 is not one');
  });

  it('refuses --steer with exit 1 and queues nothing', async () => {
    const { tellCommand } = await import('../tell.js');

    await tellCommand('conv-x', 'hi', { whenLimitResets: true, steer: true });

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(doorMocks.scheduleConversationMessage).not.toHaveBeenCalled();
    expect(printed(errorSpy)).toContain('--steer cannot be combined with --when-limit-resets');
  });

  it('reports a door refusal with its code and exits 1', async () => {
    doorMocks.scheduleConversationMessage.mockResolvedValue({
      status: 'invalid', code: 'limit-detection-unsupported', error: 'scheduling is supported only for Claude Code conversations',
    });
    const { tellCommand } = await import('../tell.js');

    await tellCommand('conv-codex', 'hi', { whenLimitResets: true });

    expect(exitMocks.exitCli).toHaveBeenCalledWith(1);
    expect(printed(errorSpy)).toContain('limit-detection-unsupported');
  });
});
