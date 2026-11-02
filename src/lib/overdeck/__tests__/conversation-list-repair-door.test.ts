/**
 * PAN-4739: the list route's repair resurrects an ended row only on the
 * conversation-liveness door's `true`. The lifecycle patrol ends a row only on
 * the same door's `false`, so the two writers cannot flap a row between them.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  invalidateConversationListEnrichmentCache();
});

describe('conversation list repair door contract (PAN-4739)', () => {
  it('does not resurrect an ended row when conversationHarnessAlive reports the harness dead (PAN-4739 door contract)', async () => {
    list.mockReturnValue([row({ id: 1, name: 'flap', tmuxSession: 'conv-p', status: 'ended' })]);
    conversationHarnessAlive.mockResolvedValue(false);

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    expect(conversationHarnessAlive).toHaveBeenCalledWith('conv-p');
    expect(markConversationRunning).not.toHaveBeenCalled();
    expect(rows.find((r) => r.name === 'flap')?.status).toBe('ended');
  });

  it('resurrects that row when conversationHarnessAlive reports the harness alive', async () => {
    list.mockReturnValue([row({ id: 1, name: 'flap', tmuxSession: 'conv-p', status: 'ended' })]);
    conversationHarnessAlive.mockResolvedValue(true);

    const rows = (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;

    expect(markConversationRunning).toHaveBeenCalledWith('flap');
    expect(rows.find((r) => r.name === 'flap')?.status).toBe('active');
  });
});
