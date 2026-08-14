import { beforeEach, describe, expect, it, vi } from 'vitest';

const agentMocks = vi.hoisted(() => ({
  messageAgent: vi.fn(
    async (): Promise<{ delivered: boolean; queuedToMail: boolean; reason?: string }> =>
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
  resolveAgentTargetSync: (id: string) => {
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
  messageAgent: agentMocks.messageAgent,
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
    );
  });

  it('prefixes bare issue IDs with agent-', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-123', 'hello');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('agent-pan-123', 'hello', 'pan-tell');
  });

  it('can resolve an issue ID to its registered strike agent', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('PAN-1820', 'hello strike');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('strike-pan-1820', 'hello strike', 'pan-tell');
  });

  it('preserves known agent prefixes like planning-', async () => {
    const { tellCommand } = await import('../tell.js');
    await tellCommand('planning-pan-123', 'hello');
    expect(agentMocks.messageAgent).toHaveBeenCalledWith('planning-pan-123', 'hello', 'pan-tell');
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
