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

  it('reports failure and exits non-zero when the fork pipeline failed instead of printing a conv id as if it launched (PAN-3860)', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 2743,
      name: 'conv-20260917-351b',
      tmuxSession: 'conv-20260917-351b',
      forkStatus: 'failed',
      forkError: 'Timed out waiting for tmux session conv-20260917-351b',
    });
    const { handoffCommand } = await import('../handoff.js');

    await expect(handoffCommand('123', ['ship', 'it'], {})).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Handoff failed: Timed out waiting for tmux session conv-20260917-351b');
    expect(output).not.toContain('Handoff forked conversation');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('reports still-in-progress and exits non-zero when the fork pipeline times out before spawning (PAN-3860)', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    forkMocks.forkConversationViaServer.mockResolvedValue({
      id: 2742,
      name: 'conv-20260917-ed92',
      tmuxSession: 'conv-20260917-ed92',
      forkStatus: 'handoff',
      timedOut: true,
      sessionAlive: false,
    });
    forkMocks.isForkResultInProgress.mockReturnValueOnce(true);
    const { handoffCommand } = await import('../handoff.js');

    await expect(handoffCommand('123', ['ship', 'it'], {})).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Handoff is still in progress');
    expect(output).not.toContain('Handoff forked conversation');
    expect(exitSpy).toHaveBeenCalledWith(1);
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
      projectKey: undefined,
      forkMode: 'handoff',
      focus: 'ship it',
      handoffAuthor: 'external',
      handoffAuthorModel: undefined,
    });
  });

  it('forwards --title as the new conversation title and echoes it', async () => {
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
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      forkStatus: null,
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', ['wire', 'it'], { title: 'Checkout webhook repair' });

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Title: Checkout webhook repair (--title)');
    expect(forkMocks.forkConversationViaServer).toHaveBeenCalledWith(
      'source-conv',
      expect.objectContaining({ title: 'Checkout webhook repair', focus: 'wire it' }),
    );
  });

  it('sends no title when --title is blank, letting the server pick the default', async () => {
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
      model: 'claude-sonnet-5',
      harness: 'claude-code',
      forkStatus: null,
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', [], { title: '   ' });

    expect(forkMocks.forkConversationViaServer).toHaveBeenCalledWith(
      'source-conv',
      expect.objectContaining({ title: undefined }),
    );
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

  it('forwards --project to the fork server and prints the canonical project key', async () => {
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
      projectKey: 'mind-your-now',
      sessionAlive: true,
    });
    const { handoffCommand } = await import('../handoff.js');

    await handoffCommand('123', ['continue'], { project: 'Mind Your Now' });

    expect(forkMocks.forkConversationViaServer).toHaveBeenCalledWith(
      'source-conv',
      expect.objectContaining({ projectKey: 'Mind Your Now', focus: 'continue' }),
    );
    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Project: mind-your-now');
  });

  it('forwards --role to the fork server and prints it (PAN-3921)', async () => {
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

    await handoffCommand('123', ['review the PR'], { issue: 'PAN-1', role: 'review' });

    expect(forkMocks.forkConversationViaServer).toHaveBeenCalledWith(
      'source-conv',
      expect.objectContaining({ issueId: 'PAN-1', role: 'review' }),
    );
    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Role: review');
  });

  it('sends no role without --role (PAN-3921)', async () => {
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

    await handoffCommand('123', ['continue'], { issue: 'PAN-1' });

    const opts = forkMocks.forkConversationViaServer.mock.calls[0]![1] as Record<string, unknown>;
    expect(opts).not.toHaveProperty('role');
  });

  it('rejects an invalid --role and does not fork (PAN-3921)', async () => {
    conversationMocks.getConversationById.mockReturnValue({
      id: 123,
      name: 'source-conv',
      title: 'Source conversation',
      cwd: '/workspace',
      claudeSessionId: 'session-id',
    });
    const { handoffCommand } = await import('../handoff.js');

    await expect(handoffCommand('123', [], { role: 'bogus' })).rejects.toThrow('process.exit');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('Invalid --role: bogus. Expected one of conversation, work, review, test, plan.');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(forkMocks.forkConversationViaServer).not.toHaveBeenCalled();
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
