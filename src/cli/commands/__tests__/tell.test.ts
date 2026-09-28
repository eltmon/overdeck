import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  messageAgent: vi.fn(
    async (): Promise<{
      delivered: boolean;
      queuedToMail: boolean;
      reason?: string;
      confirmed?: boolean;
      landedInSubagent?: { agentId: string; description: string };
      inputTarget?: 'main';
      switchedFromSubagent?: string;
      inputTargetRefusal?: { reason: string; inputTarget: 'main' | { subagent: string } | 'unknown' };
    }> =>
      ({ delivered: true, queuedToMail: false }),
  ),
}));

const remoteMocks = vi.hoisted(() => ({
  loadRemoteAgentState: vi.fn(() => null),
  sendToRemoteAgent: vi.fn(async () => {}),
}));

// Keep a focused resolver implementation for the PAN-1749/PAN-1820 regressions:
// singleton IDs and known prefixes must not get a naive `agent-` prefix, and
// issue IDs can resolve to non-work agents when that is the registered run.
vi.mock('../../../lib/agents.js', () => ({
  resolveAgentTarget: (id: string) => {
    const lower = id.toLowerCase();
    if (lower === 'pan-1820') return 'strike-pan-1820';
    if (
      lower === 'flywheel-orchestrator' ||
      lower.startsWith('agent-') ||
      lower.startsWith('planning-') ||
      lower.startsWith('conv-') ||
      lower.startsWith('strike-') ||
      lower.startsWith('inspect-')
    ) {
      return lower;
    }
    return `agent-${lower}`;
  },
  getAgentState: (id: string) => ({ id, issueId: 'PAN-123' }),
  messageAgent: agentMocks.messageAgent,
}));

vi.mock('../../../lib/work-agent-lifecycle.js', () => ({
  issueOwesRework: vi.fn(async () => false),
}));

// W4 (PAN-3846): tellCommand now ends through exitCli on success and failure —
// intercept it so process.exit never fires inside the test runner.
vi.mock('../../exit.js', () => ({
  exitCli: vi.fn(async (_code: number) => undefined as never),
}));

vi.mock('../../../lib/remote/index.js', () => ({
  loadRemoteAgentState: remoteMocks.loadRemoteAgentState,
  sendToRemoteAgent: remoteMocks.sendToRemoteAgent,
}));

describe('tellCommand agent ID resolution (PAN-1749)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentMocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
  });

  it('does not prefix the flywheel-orchestrator singleton ID', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('flywheel-orchestrator', 'strike PAN-1: parking — need operator decision');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith(
      'flywheel-orchestrator',
      'strike PAN-1: parking — need operator decision',
      'pan-tell',
      { owesRework: false },
    );
  });

  it('prefixes bare issue IDs with agent-', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'hello');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('agent-pan-123', 'hello', 'pan-tell', { owesRework: false });
  });

  it('can resolve an issue ID to its registered strike agent', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-1820', 'hello strike');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('strike-pan-1820', 'hello strike', 'pan-tell', { owesRework: false });
  });

  it('preserves known agent prefixes like planning-', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('planning-pan-123', 'hello');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('planning-pan-123', 'hello', 'pan-tell', { owesRework: false });
  });
});

describe('tellCommand outcome reporting (PAN-3736)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
  });

  it('prints the busy-agent reason with the mail file path', async () => {
    const mailPath = '/home/user/.overdeck/agents/agent-pan-123/mail/2026-08-14T10-00-00-000Z.pending.md';
    const reason = `agent is alive and mid-turn; message queued to its mail file (${mailPath})`;
    agentMocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, reason });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'peer ping');

    const printed = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(printed).toContain('agent is alive and mid-turn');
    expect(printed).toContain(mailPath);
    logSpy.mockRestore();
  });

  it('prints no extra line when the delivery door had nothing to explain', async () => {
    agentMocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'peer ping');

    expect(logSpy).toHaveBeenCalledTimes(2);
    logSpy.mockRestore();
  });
});

describe('tellCommand subagent-landing outcome (PAN-4247)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
  });

  it('prints the subagent name and exits 1 instead of confirming delivery (AC2/AC3)', async () => {
    agentMocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      landedInSubagent: { agentId: 'agent-1', description: 'Investigate flaky test' },
      reason: 'Claude Code routed the message into running subagent "Investigate flaky test" (agent-1), not the main conversation. Stop or finish that subagent, then resend.',
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { exitCli } = await import('../../exit.js');

    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'please pause and check the logs');

    const printed = errorSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(printed).toContain('agent-pan-123');
    expect(printed).toContain('Investigate flaky test');
    expect(printed).toContain('agent-1');
    expect(printed).not.toContain('turn confirmed');
    expect(exitCli).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});

describe('tellCommand main-agent input target (PAN-4268)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
  });

  it('prints the refusal and exits 1 when input could not be moved to the main agent', async () => {
    const reason = "Could not move keyboard focus into Claude Code's agent selector.";
    agentMocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: true,
      confirmed: false,
      reason,
      inputTargetRefusal: { reason, inputTarget: { subagent: 'Counter run' } },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { exitCli } = await import('../../exit.js');

    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'please continue');

    const printed = errorSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(printed).toContain('could not be moved to the main agent');
    expect(printed).toContain(reason);
    expect(printed).not.toContain('turn confirmed');
    expect(exitCli).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });

  it("names the main agent on a confirmed delivery", async () => {
    agentMocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, confirmed: true, inputTarget: 'main' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { exitCli } = await import('../../exit.js');

    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'please continue');

    const printed = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(printed).toContain("agent-pan-123's main agent (turn confirmed)");
    expect(exitCli).toHaveBeenCalledWith(0);
    logSpy.mockRestore();
  });

  it('names the subagent it switched away from', async () => {
    agentMocks.messageAgent.mockResolvedValue({
      delivered: true,
      queuedToMail: true,
      confirmed: true,
      inputTarget: 'main',
      switchedFromSubagent: 'Counter run',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'please continue');

    const printed = logSpy.mock.calls.map(call => String(call[0])).join('\n');
    expect(printed).toContain('Switched Claude Code\'s input from subagent "Counter run"');
    logSpy.mockRestore();
  });
});

describe('tellCommand --steer (PAN-4292)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    agentMocks.messageAgent.mockResolvedValue({ delivered: true, queuedToMail: true, confirmed: true });
    remoteMocks.loadRemoteAgentState.mockReturnValue(null);
  });

  it('passes steer: true to messageAgent and reports the steer', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'change course', { steer: true });

    expect(agentMocks.messageAgent).toHaveBeenCalledWith('agent-pan-123', 'change course', 'pan-tell', {
      owesRework: false,
      steer: true,
    });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Message steered into agent-pan-123's running turn"));
  });

  it('passes no steer option without the flag', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'queue this');

    expect(agentMocks.messageAgent).toHaveBeenCalledWith('agent-pan-123', 'queue this', 'pan-tell', { owesRework: false });
  });

  it('refuses --steer for a remote agent with exit 1 and nothing sent', async () => {
    const { exitCli } = await import('../../exit.js');
    remoteMocks.loadRemoteAgentState.mockReturnValue({ location: 'remote', vmName: 'fly-vm-1' } as never);
    const { tellCommand } = await import('../tell.js');

    await tellCommand('PAN-123', 'change course', { steer: true });

    expect(remoteMocks.sendToRemoteAgent).not.toHaveBeenCalled();
    expect(agentMocks.messageAgent).not.toHaveBeenCalled();
    expect(exitCli).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--steer is not supported for remote agents'));
  });

  it('does not claim a steer when the message went out as a normal submit', async () => {
    agentMocks.messageAgent.mockResolvedValue({
      delivered: true,
      queuedToMail: true,
      confirmed: true,
      reason: 'supervisor predates steer; delivered as a normal submit',
    });
    const { tellCommand } = await import('../tell.js');

    await tellCommand('PAN-123', 'change course', { steer: true });

    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('steered into'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Message delivered to agent-pan-123'));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('supervisor predates steer'));
  });

  it('exits 1 with the reason when messageAgent refuses the steer', async () => {
    const { exitCli } = await import('../../exit.js');
    agentMocks.messageAgent.mockResolvedValue({
      delivered: false,
      queuedToMail: false,
      reason: 'steer is supported for Claude Code only; agent-pan-123 runs Codex. Send it without steer to deliver a normal message.',
    });
    const { tellCommand } = await import('../tell.js');

    await tellCommand('PAN-123', 'change course', { steer: true });

    expect(exitCli).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('runs Codex'));
  });
});
