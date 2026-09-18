import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ledger, list } = vi.hoisted(() => ({ ledger: vi.fn(), list: vi.fn() }));
vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: ledger }));
vi.mock('../conversations.js', () => ({
  listConversations: list, listFavoritedIds: () => ['favorite'], markConversationRunning: vi.fn(),
}));
vi.mock('../../tmux.js', () => ({ listSessionNames: () => Effect.succeed([]), isHarnessProcessAlive: vi.fn() }));
vi.mock('../conversation-reads.js', () => ({
  resolveSessionFile: async () => null,
  conversationTranscriptMissing: () => true,
  conversationNeedsTerminal: async () => false,
  askUserQuestionSnapshotFromScan: vi.fn(),
}));
vi.mock('../conversation-delivery.js', () => ({ codexConversationPendingInput: async () => ({ kinds: [] }) }));
vi.mock('../../../dashboard/server/services/git-info.js', () => ({
  resolveConversationGitInfo: async () => ({ branch: 'feature/example', isWorktree: true }),
}));
import { getEnrichedConversationList, invalidateConversationListEnrichmentCache } from '../conversation-list.js';

beforeEach(() => {
  vi.clearAllMocks();
  invalidateConversationListEnrichmentCache();
});

describe('conversation list worker costs', () => {
  it('matches string ledger IDs, preserves zero costs, falls back for old rows and retains enrichment fields', async () => {
    const rows = [1, 2, 3].map(id => ({ id, name: id === 1 ? 'favorite' : `conv-${id}`,
      tmuxSession: `conv-${id}`, status: 'ended', harness: 'pi', cwd: '/fixture', projectKey: 'project',
      title: 'Conversation', totalCost: 9, totalTokens: 90 }));
    list.mockReturnValue(rows);
    ledger.mockResolvedValue([['1', { cost: 7, tokens: 70 }], ['2', { cost: 0, tokens: 0 }]]);
    const first = getEnrichedConversationList(500, 0);
    expect(getEnrichedConversationList(500, 0)).toBe(first);
    expect(await first).toEqual(rows.map((row, index) => ({
      ...row, totalCost: [7, 0, 9][index], totalTokens: [70, 0, 90][index],
      sessionAlive: false, isWorking: false, currentTool: null, isFavorited: index === 0,
      compacting: false, contextUsage: null, lastActivityAt: null, branch: 'feature/example',
      isWorktree: true, pendingInputCount: 0, pendingInputKinds: [], pendingAskUserQuestion: undefined,
      transcriptMissing: true, needsTerminal: false,
    })));
    expect(ledger).toHaveBeenCalledOnce();
    expect(list).toHaveBeenCalledWith({ limit: 500, offset: 0 });
  });
});
