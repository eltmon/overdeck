import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the conversations-db module
const mockListActiveConversations = vi.fn();
const mockMarkConversationEnded = vi.fn();
const mockCleanupUnreferencedConversationAttachments = vi.fn();
const mockListSessionNames = vi.fn();

vi.mock('../../../../lib/database/conversations-db.js', () => ({
  listActiveConversations: mockListActiveConversations,
  markConversationEnded: mockMarkConversationEnded,
}));

vi.mock('../conversation-attachments.js', () => ({
  cleanupUnreferencedConversationAttachments: mockCleanupUnreferencedConversationAttachments,
  runInBatches: async (
    items: unknown[],
    _batchSize: number,
    fn: (item: unknown) => Promise<unknown>,
  ) => {
    for (const item of items) {
      await fn(item);
    }
  },
}));

vi.mock('../../../../lib/tmux.js', () => ({
  listSessionNames: mockListSessionNames,
}));

// Mock node:child_process so no real tmux processes are spawned
vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: vi.fn((fn: unknown) => fn) }));

describe('ConversationLifecycleService — pollConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks active conversations as ended when session is not in tmux list', async () => {
    // No claudeSessionId on the conversation → sessionFile should resolve to null
    // (production computes sessionFile via sessionFilePath(cwd, claudeSessionId)
    // and falls back to null when claudeSessionId is missing).
    mockListActiveConversations.mockReturnValue([
      { name: 'gone-session', tmuxSession: 'conv-gone-session', status: 'active', cwd: '/tmp/work', claudeSessionId: null },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed([])); // no sessions alive

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListSessionNames).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('gone-session');
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gone-session', sessionFile: null }),
    );
  });

  it('does NOT mark conversations as ended when session is in tmux list', async () => {
    mockListActiveConversations.mockReturnValue([
      { name: 'alive-session', tmuxSession: 'conv-alive-session', status: 'active' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-alive-session']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
    expect(mockCleanupUnreferencedConversationAttachments).not.toHaveBeenCalled();
  });

  it('uses listActiveConversations so ended sessions are already filtered out', async () => {
    mockListActiveConversations.mockReturnValue([
      // listActiveConversations only returns active conversations
      { name: 'active-session', tmuxSession: 'conv-active-session', status: 'active' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-active-session']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListActiveConversations).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
  });

  it('handles empty conversation list without errors', async () => {
    mockListActiveConversations.mockReturnValue([]);

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await expect(pollConversations()).resolves.toBeUndefined();
    expect(mockListSessionNames).not.toHaveBeenCalled();
  });

  it('marks only gone sessions when multiple active conversations', async () => {
    mockListActiveConversations.mockReturnValue([
      { name: 'alive', tmuxSession: 'conv-alive', status: 'active', sessionFile: '/tmp/alive.jsonl' },
      { name: 'gone', tmuxSession: 'conv-gone', status: 'active', sessionFile: '/tmp/gone.jsonl' },
    ]);
    mockListSessionNames.mockReturnValue(Effect.succeed(['conv-alive']));

    const { pollConversations } = await import('../conversation-lifecycle.js');

    await pollConversations();

    expect(mockListSessionNames).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('gone');
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledTimes(1);
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gone' }),
    );
  });

  it('does not throw when listActiveConversations errors', async () => {
    mockListActiveConversations.mockImplementation(() => { throw new Error('DB error'); });

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await expect(pollConversations()).resolves.toBeUndefined();
  });
});
