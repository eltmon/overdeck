/**
 * PAN-4485: the list path never revives a superseded /clear row and
 * re-ends one stored stale-active.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationNeedsRunningRepair } from '../conversation-runtime.js';

const { list, markConversationRunning, markConversationEnded, conversationHarnessAlive } = vi.hoisted(() => ({
  list: vi.fn(),
  markConversationRunning: vi.fn(),
  markConversationEnded: vi.fn(),
  conversationHarnessAlive: vi.fn(),
}));
vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: async () => [] }));
vi.mock('../conversations.js', () => ({
  listConversations: list, listFavoritedIds: () => [], markConversationRunning, markConversationEnded,
}));
vi.mock('../../tmux.js', () => ({ listSessionNames: () => Effect.succeed([]), isHarnessProcessAlive: vi.fn() }));
vi.mock('../conversation-liveness.js', () => ({
  listLiveConversationSessions: async () => new Set(['conv-p']),
  conversationHarnessAlive,
}));
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
vi.mock('../conversation-input-target.js', () => ({ readConversationInputTarget: async () => undefined }));
import { getEnrichedConversationList, invalidateConversationListEnrichmentCache } from '../conversation-list.js';

function row(partial: Record<string, unknown> & { id: number; name: string; tmuxSession: string }) {
  return {
    status: 'ended', harness: 'claude-code', cwd: '/fixture', projectKey: 'project',
    title: partial.name, totalCost: 0, totalTokens: 0, forkStatus: null, clearedToConvId: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  conversationHarnessAlive.mockResolvedValue(true);
  invalidateConversationListEnrichmentCache();
});

describe('conversation list clear-chain repair', () => {
  it('never revives a superseded parent and does not probe its harness', async () => {
    list.mockReturnValue([
      row({ id: 1, name: 'parent', tmuxSession: 'conv-p', status: 'ended', clearedToConvId: 2 }),
      row({ id: 2, name: 'parent-post-clear-1', tmuxSession: 'conv-p', status: 'active' }),
    ]);

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    const parent = rows.find((r) => r.name === 'parent')!;
    const sibling = rows.find((r) => r.name === 'parent-post-clear-1')!;
    expect(parent.status).toBe('ended');
    expect(parent.sessionAlive).toBe(false);
    expect(sibling.sessionAlive).toBe(true);
    expect(markConversationRunning).not.toHaveBeenCalled();
    expect(conversationHarnessAlive).not.toHaveBeenCalledWith('conv-p');
  });

  it('re-ends a superseded row stored as active', async () => {
    list.mockReturnValue([
      row({ id: 1, name: 'parent', tmuxSession: 'conv-p', status: 'active', clearedToConvId: 2 }),
      row({ id: 2, name: 'parent-post-clear-1', tmuxSession: 'conv-p', status: 'active' }),
    ]);

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    const parent = rows.find((r) => r.name === 'parent')!;
    expect(markConversationEnded).toHaveBeenCalledWith('parent');
    expect(parent.status).toBe('ended');
    expect(parent.sessionAlive).toBe(false);
  });
});

describe('conversationNeedsRunningRepair', () => {
  it('refuses to repair a superseded row', () => {
    expect(conversationNeedsRunningRepair({ status: 'ended', forkStatus: null, clearedToConvId: 7 }, true, true)).toBe(false);
  });
});
