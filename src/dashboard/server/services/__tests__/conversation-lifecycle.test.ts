import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the conversations-db module
const mockListConversations = vi.fn();
const mockMarkConversationEnded = vi.fn();
const mockCleanupUnreferencedConversationAttachments = vi.fn();

vi.mock('../../../../lib/database/conversations-db.js', () => ({
  listConversations: mockListConversations,
  markConversationEnded: mockMarkConversationEnded,
}));

vi.mock('../conversation-attachments.js', () => ({
  cleanupUnreferencedConversationAttachments: mockCleanupUnreferencedConversationAttachments,
}));

// Mock node:child_process so no real tmux processes are spawned
vi.mock('node:child_process', () => ({ exec: vi.fn(), execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: vi.fn((fn: unknown) => fn) }));

describe('ConversationLifecycleService — pollConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks active conversations as ended when session checker returns false', async () => {
    mockListConversations.mockReturnValue([
      { name: 'gone-session', tmuxSession: 'conv-gone-session', status: 'active' },
    ]);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    const checker = vi.fn().mockResolvedValue(false); // session is gone

    await pollConversations(checker);

    expect(checker).toHaveBeenCalledWith('conv-gone-session');
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('gone-session');
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gone-session' }),
    );
  });

  it('does NOT mark conversations as ended when session checker returns true', async () => {
    mockListConversations.mockReturnValue([
      { name: 'alive-session', tmuxSession: 'conv-alive-session', status: 'active' },
    ]);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    const checker = vi.fn().mockResolvedValue(true); // session is alive

    await pollConversations(checker);

    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
    expect(mockCleanupUnreferencedConversationAttachments).not.toHaveBeenCalled();
  });

  it('skips conversations with status "ended"', async () => {
    mockListConversations.mockReturnValue([
      { name: 'old-session', tmuxSession: 'conv-old-session', status: 'ended' },
    ]);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    const checker = vi.fn().mockResolvedValue(false);

    await pollConversations(checker);

    // checker should not be called — ended sessions are skipped
    expect(checker).not.toHaveBeenCalled();
    expect(mockMarkConversationEnded).not.toHaveBeenCalled();
    expect(mockCleanupUnreferencedConversationAttachments).not.toHaveBeenCalled();
  });

  it('handles empty conversation list without errors', async () => {
    mockListConversations.mockReturnValue([]);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    const checker = vi.fn();

    await expect(pollConversations(checker)).resolves.toBeUndefined();
    expect(checker).not.toHaveBeenCalled();
  });

  it('marks only gone sessions when multiple active conversations', async () => {
    mockListConversations.mockReturnValue([
      { name: 'alive', tmuxSession: 'conv-alive', status: 'active' },
      { name: 'gone', tmuxSession: 'conv-gone', status: 'active' },
    ]);

    const { pollConversations } = await import('../conversation-lifecycle.js');
    const checker = vi.fn().mockImplementation(
      async (name: string) => name === 'conv-alive',
    );

    await pollConversations(checker);

    expect(mockMarkConversationEnded).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationEnded).toHaveBeenCalledWith('gone');
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledTimes(1);
    expect(mockCleanupUnreferencedConversationAttachments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gone' }),
    );
  });

  it('does not throw when listConversations errors', async () => {
    mockListConversations.mockImplementation(() => { throw new Error('DB error'); });

    const { pollConversations } = await import('../conversation-lifecycle.js');
    await expect(pollConversations()).resolves.toBeUndefined();
  });
});
