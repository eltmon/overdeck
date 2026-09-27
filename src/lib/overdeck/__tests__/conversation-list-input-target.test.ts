/**
 * PAN-4268: list enrichment carries inputTarget only when the read-model
 * helper returned a value for the row.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, readInputTarget } = vi.hoisted(() => ({ list: vi.fn(), readInputTarget: vi.fn() }));
vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: async () => [] }));
vi.mock('../conversations.js', () => ({
  listConversations: list, listFavoritedIds: () => [], markConversationRunning: vi.fn(),
}));
vi.mock('../../tmux.js', () => ({ listSessionNames: () => Effect.succeed([]), isHarnessProcessAlive: vi.fn() }));
vi.mock('../conversation-reads.js', () => ({
  resolveSessionFile: async () => null,
  conversationTranscriptMissing: () => true,
  conversationNeedsTerminal: async () => false,
  askUserQuestionSnapshotFromScan: vi.fn(),
}));
vi.mock('../conversation-delivery.js', () => ({ codexConversationPendingInput: async () => ({ kinds: [] }) }));
vi.mock('../conversation-pull-requests.js', () => ({ listPullRequestLinksForConversations: () => new Map() }));
vi.mock('../../../dashboard/server/services/git-info.js', () => ({
  resolveConversationGitInfo: async () => ({ branch: 'main', isWorktree: false }),
}));
vi.mock('../conversation-input-target.js', () => ({ readConversationInputTarget: readInputTarget }));
import { getEnrichedConversationList, invalidateConversationListEnrichmentCache } from '../conversation-list.js';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateConversationListEnrichmentCache();
});

describe('conversation list inputTarget', () => {
  it('adds inputTarget only to rows the helper answered for', async () => {
    list.mockReturnValue(['with-target', 'without-target'].map((name, index) => ({
      id: index + 1, name, tmuxSession: `conv-${name}`, status: 'ended', harness: 'claude-code', cwd: '/fixture',
      projectKey: 'project', title: name, totalCost: 0, totalTokens: 0,
    })));
    readInputTarget.mockImplementation(async (row: { name: string }) =>
      (row.name === 'with-target' ? { subagent: 'Counter run' } : undefined));

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    expect(rows[0].inputTarget).toEqual({ subagent: 'Counter run' });
    expect(rows[1]).not.toHaveProperty('inputTarget');
    expect(readInputTarget).toHaveBeenCalledTimes(2);
  });
});
