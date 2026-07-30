import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const conversationMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(() => null),
  getConversationByName: vi.fn(() => null),
}));

const forkMocks = vi.hoisted(() => ({
  forkConversationViaServer: vi.fn(),
  isForkResultInProgress: vi.fn(() => false),
}));

vi.mock('../../../lib/overdeck/conversations.js', () => conversationMocks);

vi.mock('../../../lib/conversations/current.js', () => ({
  resolveCurrentConversation: vi.fn(async () => null),
}));

vi.mock('../fork-client.js', () => ({
  forkConversationViaServer: forkMocks.forkConversationViaServer,
  ForkServerError: class ForkServerError extends Error {},
  isForkResultInProgress: forkMocks.isForkResultInProgress,
}));

// The shared per-harness resolver, not the claude-only sessionFilePath(): a
// kimi-code/codex/pi conversation has no claudeSessionId to build a path from.
const readsMocks = vi.hoisted(() => ({
  resolveSessionFile: vi.fn(async () => '/tmp/session.jsonl' as string | null),
}));
vi.mock('../../../lib/overdeck/conversation-reads.js', () => readsMocks);

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

describe('handoffCommand', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('explains how to pass bare focus text for the current conversation', async () => {
    const { handoffCommand } = await import('../handoff.js');

    await expect(handoffCommand('Implement', ['PAN-1790'], {})).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Conversation not found: Implement');
    expect(output).toContain('If that was focus text for the current conversation');
    expect(output).toContain('pan handoff self "Implement PAN-1790"');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('hands off a kimi-code conversation, which has no claudeSessionId', async () => {
    readsMocks.resolveSessionFile.mockResolvedValue('/home/u/.kimi-code/sessions/wd_x/session_y/agents/main/wire.jsonl');
    const conv = {
      id: 1706,
      name: 'source-kimi',
      title: 'Kimi conversation',
      cwd: '/workspace',
      harness: 'kimi-code',
      claudeSessionId: null,
    };
    conversationMocks.getConversationById.mockReturnValue(conv);
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 1712, name: 'new-conv', tmuxSession: 'conv-new', model: 'k3[1m]',
      harness: 'kimi-code', forkStatus: null, sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('1706', ['carry', 'on'], {});

    expect(readsMocks.resolveSessionFile).toHaveBeenCalledWith(conv);
    expect(forkMocks.forkConversationViaServer).toHaveBeenCalled();
  });

  it('prints an ignored notice for --harness and does not forward it to the fork server', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 456,
      name: 'new-conv',
      tmuxSession: 'conv-new',
      model: 'glm-5.2',
      harness: 'ohmypi',
      forkStatus: null,
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', ['ship', 'it'], { model: 'glm-5.2', harness: 'claude-code' });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('--harness is provider-default-only (PAN-1984); ignoring "claude-code".');
    expect(forkMocks.forkConversationViaServer).toHaveBeenCalledWith('source-conv', {
      model: 'glm-5.2',
      cwd: undefined,
      forkMode: 'handoff',
      focus: 'ship it',
      handoffAuthor: 'external',
      handoffAuthorModel: undefined,
    });
  });

  it('validates and forwards --issue to the fork server', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 789,
      name: 'new-conv',
      tmuxSession: 'conv-new',
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', ['continue'], { issue: 'PAN-9004' });

    expect(forkMocks.forkConversationViaServer).toHaveBeenCalledWith(
      'source-conv',
      expect.objectContaining({ issueId: 'PAN-9004', focus: 'continue' }),
    );
  });

  it('rejects an invalid --issue and does not fork', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    const { handoffCommand } = await import('../handoff.js');

    await expect(handoffCommand('123', [], { issue: 'not-an-issue' })).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Invalid --issue: not-an-issue. Expected an issue ID like PAN-123.');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(forkMocks.forkConversationViaServer).not.toHaveBeenCalled();
  });

  it('prints the issue association returned by the fork server', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 789,
      name: 'new-conv',
      tmuxSession: 'conv-new',
      issueId: 'PAN-9005',
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', [], {});

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Issue: PAN-9005');
  });

  it('annotates an explicit --issue in the handoff output', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 789,
      name: 'new-conv',
      tmuxSession: 'conv-new',
      issueId: 'PAN-9004',
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', [], { issue: 'PAN-9004' });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Issue: PAN-9004 (from --issue)');
  });
});
