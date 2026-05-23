import { useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { mapConversationsToFeedEntries, useConversationFeed, type ConversationFeedRow } from '../useConversationFeed';

vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

const useQueryMock = vi.mocked(useQuery);

function conversation(overrides: Partial<ConversationFeedRow>): ConversationFeedRow {
  return {
    name: 'conv-a',
    createdAt: '2026-05-23T01:00:00.000Z',
    lastAttachedAt: null,
    issueId: 'PAN-1389',
    cwd: '/workspace/a',
    title: 'Conversation title',
    harness: 'claude-code',
    archivedAt: null,
    ...overrides,
  };
}

describe('mapConversationsToFeedEntries', () => {
  it('returns one entry per non-archived conversation row', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ name: 'active-a' }),
      conversation({ name: 'archived', archivedAt: '2026-05-23T02:00:00.000Z' }),
      conversation({ name: 'active-b' }),
    ]);

    expect(entries.map((entry) => entry.conversationName)).toEqual(['active-a', 'active-b']);
  });

  it('prefers lastAttachedAt for lastMessageDate and timestamp', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({
        createdAt: '2026-05-23T01:00:00.000Z',
        lastAttachedAt: '2026-05-23T03:00:00.000Z',
      }),
    ]);

    expect(entries[0]).toMatchObject({
      lastMessageDate: '2026-05-23T03:00:00.000Z',
      timestamp: '2026-05-23T03:00:00.000Z',
    });
  });

  it('falls back to createdAt when lastAttachedAt is null', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ createdAt: '2026-05-23T01:00:00.000Z', lastAttachedAt: null }),
    ]);

    expect(entries[0]).toMatchObject({
      lastMessageDate: '2026-05-23T01:00:00.000Z',
      timestamp: '2026-05-23T01:00:00.000Z',
    });
  });

  it('falls back to No messages yet when title is null', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ title: null }),
    ]);

    expect(entries[0]?.lastMessageSnippet).toBe('No messages yet');
  });

  it('maps harness values to feed agents', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ name: 'claude', harness: 'claude-code' }),
      conversation({ name: 'pi', harness: 'pi' }),
      conversation({ name: 'unknown', harness: null }),
    ]);

    expect(entries.map((entry) => entry.agent)).toEqual(['claude_code', 'pi', 'unknown']);
  });
});

describe('useConversationFeed', () => {
  it('reads the conversations react-query result and exposes mapped feed entries', () => {
    useQueryMock.mockReturnValue({
      data: [conversation({ name: 'conv-a', messageCount: 3 })],
      isLoading: false,
      error: null,
    } as ReturnType<typeof useQuery>);

    expect(useConversationFeed()).toEqual({
      entries: [expect.objectContaining({
        kind: 'conversation',
        id: 'conversation:conv-a',
        conversationName: 'conv-a',
        messageCount: 3,
      })],
      isLoading: false,
      error: null,
    });
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['conversations'],
      refetchInterval: 30_000,
      staleTime: 5_000,
    }));
  });
});
