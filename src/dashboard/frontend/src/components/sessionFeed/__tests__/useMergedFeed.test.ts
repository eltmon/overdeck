import { describe, expect, it, vi } from 'vitest';
import type { SessionFeedEntry } from '../types';
import { filterSessionFeedEntriesForTab, mergeSessionFeedEntries, useMergedFeed } from '../useMergedFeed';

const hookSources = vi.hoisted(() => ({
  conversations: { entries: [] as SessionFeedEntry[], isLoading: false, error: null as Error | null },
  observations: [] as SessionFeedEntry[],
  git: { entries: [] as SessionFeedEntry[], isLoading: false, error: null as Error | null },
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

vi.mock('../useGitFeed', () => ({
  useGitFeed: () => hookSources.git,
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
      };
    case 'activity':
      return { ...base, kind, headline: 'Working', summary: 'Summary' };
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
  const entries = [
    entry('conversation', 'conversation-1', '2026-05-23T03:00:00.000Z'),
    entry('activity', 'activity-1', '2026-05-23T02:00:00.000Z'),
    entry('git', 'git-1', '2026-05-23T01:00:00.000Z'),
  ];

  it('returns all entries for the all tab', () => {
    expect(filterSessionFeedEntriesForTab(entries, 'all')).toEqual(entries);
  });

  it('returns tab-specific entries for chats, activity, and git', () => {
    expect(filterSessionFeedEntriesForTab(entries, 'chats').map((item) => item.kind)).toEqual(['conversation']);
    expect(filterSessionFeedEntriesForTab(entries, 'activity').map((item) => item.kind)).toEqual(['activity']);
    expect(filterSessionFeedEntriesForTab(entries, 'git').map((item) => item.kind)).toEqual(['git']);
  });

  it('returns an empty array for files and comments tabs', () => {
    expect(filterSessionFeedEntriesForTab(entries, 'files')).toEqual([]);
    expect(filterSessionFeedEntriesForTab(entries, 'comments')).toEqual([]);
  });
});

describe('useMergedFeed', () => {
  it('consumes all three source hooks and returns the selected tab feed with loading and error state', () => {
    hookSources.conversations = {
      entries: [entry('conversation', 'conversation-1', '2026-05-23T01:00:00.000Z')],
      isLoading: true,
      error: null,
    };
    hookSources.observations = [entry('activity', 'activity-1', '2026-05-23T03:00:00.000Z')];
    hookSources.git = {
      entries: [entry('git', 'git-1', '2026-05-23T02:00:00.000Z')],
      isLoading: false,
      error: new Error('git failed'),
    };

    const result = useMergedFeed('activity');

    expect(result.entries.map((item) => item.id)).toEqual(['activity-1']);
    expect(result.allEntries.map((item) => item.id)).toEqual(['activity-1', 'git-1', 'conversation-1']);
    expect(result.isLoading).toBe(true);
    expect(result.error?.message).toBe('git failed');
  });
});
