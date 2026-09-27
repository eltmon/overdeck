/**
 * PAN-4223 WI-20 step 2: the conversation list enrichment carries lane
 * verdicts and critic pairing, with one lane query per run on the page.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, lanes, reports } = vi.hoisted(() => ({ list: vi.fn(), lanes: vi.fn(), reports: new Map<string, unknown>() }));
vi.mock('../../../dashboard/server/services/dashboard-poll-snapshots.js', () => ({ getConversationLedgerCostsSnapshot: async () => [] }));
vi.mock('../conversations.js', () => ({
  listConversations: list, listFavoritedIds: () => [], markConversationRunning: vi.fn(), listLaneConversations: lanes,
}));
vi.mock('../../agents/worker/report.js', () => ({ latestWorkerReport: async (id: string) => reports.get(id) ?? null }));
vi.mock('../../tmux.js', () => ({ listSessionNames: () => Effect.succeed([]), isHarnessProcessAlive: vi.fn() }));
vi.mock('../conversation-reads.js', () => ({
  resolveSessionFile: async () => null,
  conversationTranscriptMissing: () => false,
  conversationNeedsTerminal: async () => false,
  askUserQuestionSnapshotFromScan: vi.fn(),
}));
vi.mock('../conversation-delivery.js', () => ({ codexConversationPendingInput: async () => ({ kinds: [] }) }));
vi.mock('../conversation-pull-requests.js', () => ({ listPullRequestLinksForConversations: () => new Map() }));
vi.mock('../../../dashboard/server/services/git-info.js', () => ({ resolveConversationGitInfo: async () => ({ branch: null, isWorktree: false }) }));

import { getEnrichedConversationList, invalidateConversationListEnrichmentCache } from '../conversation-list.js';

const base = { status: 'ended', harness: 'claude-code', projectKey: 'lexerra', title: 't', totalCost: 0, totalTokens: 0, gauntletRun: 'hotel', laneKey: '663' };
const BUILDER = { ...base, id: 1, name: 'b1', tmuxSession: 'conv-b1', cwd: '/l/hotel-663', createdAt: '2026-09-26T10:00:00.000Z', laneRole: 'builder', criticOfConversationId: null };
const CRITIC = { ...base, id: 2, name: 'c1', tmuxSession: 'conv-c1', cwd: '/l/hotel-663-critic-i1', createdAt: '2026-09-26T11:00:00.000Z', laneRole: 'critic', criticOfConversationId: 1, criticOfConversationName: 'b1' };
const ROOT = { ...base, id: 3, name: 'root', tmuxSession: 'conv-root', cwd: '/p', createdAt: '2026-09-26T09:00:00.000Z', gauntletRun: null, laneKey: null, laneRole: null };

async function enriched(): Promise<Array<Record<string, unknown>>> {
  invalidateConversationListEnrichmentCache();
  return (await getEnrichedConversationList(500, 0)) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  reports.clear();
  list.mockReturnValue([ROOT, BUILDER, CRITIC]);
  lanes.mockReturnValue([BUILDER, CRITIC]);
});

describe('conversation list lane pairing (PAN-4223 WI-20)', () => {
  it('marks a critic pending before its report and gives its builder no verdict yet', async () => {
    const [root, builder, critic] = await enriched();
    expect(root).not.toHaveProperty('laneReport');
    expect(critic).toMatchObject({ laneIteration: 1, laneReport: null, laneVerdict: { value: 'pending', defects: null }, criticOfConversationName: 'b1' });
    expect(builder).toMatchObject({ laneIteration: 1, laneLatestVerdict: { value: 'pending', defects: null, criticId: 2 } });
    expect(lanes).toHaveBeenCalledTimes(1);
    expect(lanes).toHaveBeenCalledWith({ run: 'hotel' });
  });

  it('carries the critic verdict to the critic row and its builder after the report', async () => {
    reports.set('conv-c1', { seq: 1, at: '2026-09-26T12:00:00.000Z', status: 'done', body: 'x', verdict: { value: 'NOT_YET', defects: 5, file: null } });
    const [, builder, critic] = await enriched();
    expect(critic).toMatchObject({
      laneReport: { seq: 1, status: 'done', verdict: 'NOT_YET' },
      laneVerdict: { value: 'NOT_YET', defects: 5 },
    });
    expect(builder).toMatchObject({ laneLatestVerdict: { value: 'NOT_YET', defects: 5, criticId: 2 } });
    expect(builder).not.toHaveProperty('laneVerdict');
  });
});
