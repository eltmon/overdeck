import { describe, expect, it, vi } from 'vitest';
import type { ConversationSessionFeedEntry, GauntletRunSessionFeedEntry, SessionFeedEntry } from '../types';
import { filterSessionFeedEntriesForTab, mergeSessionFeedEntries, useMergedFeed } from '../useMergedFeed';

const hookSources = vi.hoisted(() => ({
  conversations: { entries: [] as SessionFeedEntry[], isLoading: false, error: null as Error | null },
  observations: [] as SessionFeedEntry[],
  activityEntries: [] as SessionFeedEntry[],
}));

vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('../useConversationFeed', () => ({
  useConversationFeed: () => hookSources.conversations,
}));

vi.mock('../useObservationFeed', () => ({
  useObservationFeed: () => hookSources.observations,
}));

vi.mock('../useActivityEntryFeed', () => ({
  useActivityEntryFeed: () => hookSources.activityEntries,
}));

function entry(kind: SessionFeedEntry['kind'], id: string, timestamp: string): SessionFeedEntry {
  const base = { id, timestamp, workspaceId: null, issueId: null };
  switch (kind) {
    case 'conversation':
      return {
        ...base,
        kind,
        conversationId: 1,
        conversationName: id,
        agent: 'claude_code',
        lastMessageDate: timestamp,
        lastMessageSnippet: 'Snippet',
        recencyAt: timestamp,
        timestampLabel: 'started',
        sessionAlive: false,
        agentState: 'idle',
        projectKey: null,
      };
    case 'activity':
      return { ...base, kind, headline: 'Working', summary: 'Summary' };
    case 'gauntlet_run':
      return {
        ...base,
        kind,
        run: id,
        projectKey: 'lexerra',
        orchestratorName: null,
        orchestratorTitle: null,
        countsLine: '1 builder · 1 stopped',
        state: 'stopped',
        latest: { text: 'alpha builder launched', at: timestamp },
        lanes: [],
        laneConversationIds: [],
        anyAlive: false,
      };
    case 'git':
      return { ...base, kind, source: 'git', level: 'info', message: 'Commit' };
    case 'file_change':
      return { ...base, kind, path: 'src/file.ts' };
    case 'comment':
      return { ...base, kind, body: 'Comment' };
    case 'placeholder':
      return { ...base, kind, tab: 'files', label: 'Coming soon', description: 'Stub entry' };
  }
}

describe('mergeSessionFeedEntries', () => {
  it('merges entries from all sources and deduplicates by id with first occurrence winning', () => {
    const first = entry('conversation', 'shared', '2026-05-23T01:00:00.000Z');
    const duplicate = entry('git', 'shared', '2026-05-23T03:00:00.000Z');
    const unique = entry('activity', 'activity-1', '2026-05-23T02:00:00.000Z');

    const merged = mergeSessionFeedEntries([first], [unique], [duplicate]);

    expect(merged).toHaveLength(2);
    expect(merged.find((item) => item.id === 'shared')).toBe(first);
  });

  it('sorts output newest-first by timestamp', () => {
    const merged = mergeSessionFeedEntries([
      entry('conversation', 'old', '2026-05-23T01:00:00.000Z'),
    ], [
      entry('activity', 'new', '2026-05-23T03:00:00.000Z'),
      entry('activity', 'mid', '2026-05-23T02:00:00.000Z'),
    ]);

    expect(merged.map((item) => item.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('filterSessionFeedEntriesForTab', () => {
  const NOW = Date.parse('2026-05-23T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

  function conversation(id: string, overrides: Partial<ConversationSessionFeedEntry>): ConversationSessionFeedEntry {
    return { ...(entry('conversation', id, hoursAgo(1)) as ConversationSessionFeedEntry), ...overrides };
  }

  function run(id: string, overrides: Partial<GauntletRunSessionFeedEntry>): GauntletRunSessionFeedEntry {
    return { ...(entry('gauntlet_run', id, hoursAgo(1)) as GauntletRunSessionFeedEntry), ...overrides };
  }

  it('keeps conversations in All only when their lifecycle timestamp is inside 24 h', () => {
    const entries = [
      conversation('recent', { timestamp: hoursAgo(23), recencyAt: hoursAgo(0.1) }),
      conversation('stale', { timestamp: hoursAgo(25), recencyAt: hoursAgo(0.1), sessionAlive: true }),
      entry('activity', 'activity-1', hoursAgo(72)),
    ];

    expect(filterSessionFeedEntriesForTab(entries, 'all', NOW).map((item) => item.id)).toEqual(['recent', 'activity-1']);
  });

  it('keeps a run in All while any lane is alive, and drops a stopped run outside the window', () => {
    const entries = [
      run('alive', { anyAlive: true, latest: { text: 'x', at: hoursAgo(72) }, timestamp: hoursAgo(72) }),
      run('stopped', { anyAlive: false, latest: { text: 'x', at: hoursAgo(72) }, timestamp: hoursAgo(72) }),
      run('recent', { anyAlive: false, latest: { text: 'x', at: hoursAgo(2) }, timestamp: hoursAgo(2) }),
    ];

    expect(filterSessionFeedEntriesForTab(entries, 'all', NOW).map((item) => item.id)).toEqual(['alive', 'recent']);
  });

  it('makes Chats a windowed recency index, re-dated to recencyAt and sorted newest first', () => {
    const entries = [
      conversation('alive-old', { timestamp: hoursAgo(80), recencyAt: hoursAgo(72), sessionAlive: true }),
      conversation('ended-stale', { timestamp: hoursAgo(26), recencyAt: hoursAgo(25), sessionAlive: false }),
      conversation('recent', { timestamp: hoursAgo(30), recencyAt: hoursAgo(1), sessionAlive: false }),
      run('run', { anyAlive: true, latest: { text: 'x', at: hoursAgo(5) }, timestamp: hoursAgo(5) }),
      entry('activity', 'activity-1', hoursAgo(1)),
    ];

    const chats = filterSessionFeedEntriesForTab(entries, 'chats', NOW);

    expect(chats.map((item) => item.id)).toEqual(['recent', 'run', 'alive-old']);
    expect(chats[2]).toMatchObject({ timestamp: hoursAgo(72), timestampLabel: 'active' });
  });

  it('keeps only activity in the Activity tab and nothing in the git, files and comments tabs', () => {
    const entries = [
      conversation('conversation-1', {}),
      entry('activity', 'activity-1', hoursAgo(2)),
      entry('git', 'git-1', hoursAgo(3)),
    ];

    expect(filterSessionFeedEntriesForTab(entries, 'activity', NOW).map((item) => item.kind)).toEqual(['activity']);
    expect(filterSessionFeedEntriesForTab(entries, 'git', NOW)).toEqual([]);
    expect(filterSessionFeedEntriesForTab(entries, 'files', NOW)).toEqual([]);
    expect(filterSessionFeedEntriesForTab(entries, 'comments', NOW)).toEqual([]);
  });
});

describe('useMergedFeed', () => {
  it('merges conversations, observations and activity entries (no git source) and takes loading and error from conversations', () => {
    hookSources.conversations = {
      entries: [entry('conversation', 'conversation-1', '2026-05-23T01:00:00.000Z')],
      isLoading: true,
      error: new Error('conversations failed'),
    };
    hookSources.observations = [entry('activity', 'activity-1', '2026-05-23T03:00:00.000Z')];
    hookSources.activityEntries = [entry('activity', 'activity-2', '2026-05-23T02:00:00.000Z')];

    const result = useMergedFeed('activity', Date.parse('2026-05-23T04:00:00.000Z'));

    expect(result.entries.map((item) => item.id)).toEqual(['activity-1', 'activity-2']);
    expect(result.allEntries.map((item) => item.id)).toEqual(['activity-1', 'activity-2', 'conversation-1']);
    expect(result.isLoading).toBe(true);
    expect(result.error?.message).toBe('conversations failed');
  });
});
