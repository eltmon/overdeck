import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const conversationMocks = vi.hoisted(() => ({
  getConversationById: vi.fn(() => null),
  getConversationByName: vi.fn(() => null),
}));

vi.mock('../../../lib/overdeck/conversations.js', () => conversationMocks);

vi.mock('../../../lib/conversations/current.js', () => ({
  resolveCurrentConversation: vi.fn(async () => null),
}));

vi.mock('../fork-client.js', () => ({
  forkConversationViaServer: vi.fn(),
  ForkServerError: class ForkServerError extends Error {},
  isForkResultInProgress: vi.fn(() => false),
}));

vi.mock('../../../lib/paths.js', () => ({
  sessionFilePath: vi.fn(() => '/tmp/session.jsonl'),
}));

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
});
