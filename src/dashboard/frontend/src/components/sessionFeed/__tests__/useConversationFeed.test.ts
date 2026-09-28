import { useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { mapConversationsToFeedEntries, useConversationFeed, type ConversationFeedRow } from '../useConversationFeed';
import type { ConversationSessionFeedEntry, SessionFeedEntry } from '../types';

vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

const useQueryMock = vi.mocked(useQuery);

const NOW = Date.parse('2026-05-23T12:00:00.000Z');

function conversationEntries(entries: readonly SessionFeedEntry[]): ConversationSessionFeedEntry[] {
  return entries.filter((entry): entry is ConversationSessionFeedEntry => entry.kind === 'conversation');
}

function conversation(overrides: Partial<ConversationFeedRow>): ConversationFeedRow {
  return {
    id: 1,
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

    expect(conversationEntries(entries).map((entry) => entry.conversationName)).toEqual(['active-a', 'active-b']);
  });

  it('keeps lastActivityAt precedence for recencyAt but dates timestamp by createdAt — PAN-1556, PAN-4301 FR-1', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({
        createdAt: '2026-05-23T01:00:00.000Z',
        lastAttachedAt: '2026-05-23T03:00:00.000Z',
        lastActivityAt: '2026-05-23T05:00:00.000Z',
      }),
    ]);

    expect(entries[0]).toMatchObject({
      recencyAt: '2026-05-23T05:00:00.000Z',
      lastMessageDate: '2026-05-23T05:00:00.000Z',
      timestamp: '2026-05-23T01:00:00.000Z',
      timestampLabel: 'started',
    });
  });

  it('prefers lastAttachedAt for recencyAt when lastActivityAt is absent', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({
        createdAt: '2026-05-23T01:00:00.000Z',
        lastAttachedAt: '2026-05-23T03:00:00.000Z',
      }),
    ]);

    expect(entries[0]).toMatchObject({
      recencyAt: '2026-05-23T03:00:00.000Z',
      lastMessageDate: '2026-05-23T03:00:00.000Z',
      timestamp: '2026-05-23T01:00:00.000Z',
    });
  });

  it('falls back to createdAt when lastAttachedAt is null', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ createdAt: '2026-05-23T01:00:00.000Z', lastAttachedAt: null }),
    ]);

    expect(entries[0]).toMatchObject({
      recencyAt: '2026-05-23T01:00:00.000Z',
      lastMessageDate: '2026-05-23T01:00:00.000Z',
      timestamp: '2026-05-23T01:00:00.000Z',
    });
  });

  it('dates an ended row by endedAt and labels it ended — PAN-4301 FR-1', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({
        createdAt: '2026-05-23T01:00:00.000Z',
        lastActivityAt: '2026-05-23T05:00:00.000Z',
        status: 'ended',
        endedAt: '2026-05-23T04:00:00.000Z',
      }),
    ], NOW);

    expect(entries[0]).toMatchObject({
      timestamp: '2026-05-23T04:00:00.000Z',
      timestampLabel: 'ended',
      recencyAt: '2026-05-23T05:00:00.000Z',
    });
  });

  it('labels a live row started even when lastActivityAt is newer', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ status: 'active', sessionAlive: true, lastActivityAt: '2026-05-23T05:00:00.000Z' }),
    ], NOW);

    expect(entries[0]).toMatchObject({ timestamp: '2026-05-23T01:00:00.000Z', timestampLabel: 'started', sessionAlive: true });
  });

  it('drops singleton runner rows by name or issue id — PAN-4301 FR-4', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ name: 'sequencer-runner', title: null, issueId: null, sessionAlive: true }),
      conversation({ name: 'conv-singleton', issueId: 'FLYWHEEL-ORCHESTRATOR' }),
      conversation({ name: 'conv-foo' }),
    ], NOW);

    expect(conversationEntries(entries).map((entry) => entry.conversationName)).toEqual(['conv-foo']);
  });

  it.each([
    [{ sessionAlive: true, isWorking: true, pendingInputCount: 1 }, 'waiting'],
    [{ sessionAlive: true, isWorking: true, pendingInputCount: 0 }, 'active'],
    [{ sessionAlive: true, isWorking: false }, 'idle'],
    [{ sessionAlive: false, isWorking: true, pendingInputCount: 1 }, 'idle'],
  ] as const)('derives agentState from %o as %s — PAN-4301 FR-5', (fields, agentState) => {
    const entries = mapConversationsToFeedEntries([conversation(fields)], NOW);

    expect(entries[0]).toMatchObject({ agentState });
  });

  it('folds six lane rows of one run into one gauntlet_run entry — PAN-4301 FR-6', () => {
    const lanes = [1, 2, 3, 4, 5, 6].map((id) => conversation({
      id: 100 + id,
      name: `conv-lane-${id}`,
      issueId: null,
      projectKey: 'lexerra',
      gauntletRun: 'india',
      laneKey: `key-${id}`,
      laneRole: 'builder',
      status: 'active',
      sessionAlive: true,
      isWorking: true,
    }));

    const entries = mapConversationsToFeedEntries([conversation({ name: 'root' }), ...lanes], NOW);

    expect(conversationEntries(entries).map((entry) => entry.conversationName)).toEqual(['root']);
    expect(entries.filter((entry) => entry.kind === 'gauntlet_run')).toEqual([
      expect.objectContaining({ id: 'gauntlet-run:lexerra:india', countsLine: '6 builders · 6 working' }),
    ]);
  });

  it('falls back to No messages yet when title is null', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ title: null }),
    ]);

    expect(conversationEntries(entries)[0]?.lastMessageSnippet).toBe('No messages yet');
  });

  it('maps harness values to feed agents through their registered behavior', () => {
    const entries = mapConversationsToFeedEntries([
      conversation({ name: 'claude', harness: 'claude-code' }),
      conversation({ name: 'pi', harness: 'ohmypi' }),
      conversation({ name: 'codex', harness: 'codex' }),
      conversation({ name: 'acp', harness: 'acp' }),
      conversation({ name: 'unknown', harness: null }),
    ]);

    expect(conversationEntries(entries).map((entry) => entry.agent)).toEqual([
      'claude_code',
      'pi',
      'codex',
      'acp',
      'unknown',
    ]);
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
        conversationId: 1,
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
