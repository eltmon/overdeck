/**
 * PAN-4485: the pending-input feed never scans or returns a superseded
 * /clear row — only the chain head's prompts matter.
 */
import { describe, expect, it, vi } from 'vitest';

const { listConversations } = vi.hoisted(() => ({ listConversations: vi.fn() }));
vi.mock('../conversations.js', () => ({ listConversations }));
vi.mock('../conversation-delivery.js', () => ({ codexConversationPendingInput: async () => ({}) }));
vi.mock('../conversation-pane-choice.js', () => ({ claudeConversationPaneChoice: async () => null }));
vi.mock('../conversation-permission.js', () => ({
  readConversationPermission: async () => ({
    pendingPermission: {
      signature: 'sig', answerable: true, agentLabel: 'Main agent', agentKey: null,
      toolName: 'Bash', header: null, clipped: false,
    },
    tmuxPaneText: null,
  }),
  conversationPendingPermission: async () => null,
}));

import { getConversationsPendingInputFeed } from '../conversation-reads.js';

function row(partial: Record<string, unknown> & { name: string; tmuxSession: string }) {
  return { forkStatus: null, clearedToConvId: null, harness: 'claude-code', title: null, issueId: null, ...partial };
}

describe('getConversationsPendingInputFeed clear-chain skip', () => {
  it('scans only the sibling, never the superseded parent', async () => {
    listConversations.mockReturnValue([
      row({ name: 'feed-parent', tmuxSession: 'conv-feed-p', clearedToConvId: 2 }),
      row({ name: 'feed-parent-post-clear', tmuxSession: 'conv-feed-p' }),
    ]);
    const resolveSessionFile = vi.fn().mockResolvedValue(null);

    const response = await getConversationsPendingInputFeed({
      resolveSessionFile,
      listSessionNames: async () => ['conv-feed-p'],
    });
    const rows = response.body as Array<{ name: string }>;

    expect(resolveSessionFile).toHaveBeenCalledTimes(1);
    expect(resolveSessionFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'feed-parent-post-clear' }));
    expect(rows.some((r) => r.name === 'feed-parent')).toBe(false);
    expect(rows.some((r) => r.name === 'feed-parent-post-clear')).toBe(true);
  });
});
