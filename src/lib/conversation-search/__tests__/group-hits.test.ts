import { describe, expect, it } from 'vitest';

import { groupConversationHits } from '../group-hits.js';
import type { ConversationIdentity, TitleMatchedConversation } from '../group-hits.js';
import type { ConversationSearchHit } from '../ranker.js';

function hit(overrides: Partial<ConversationSearchHit> & { rowid: number }): ConversationSearchHit {
  return {
    sessionId: 'sess',
    projectId: 'project',
    role: 'assistant',
    ts: '2026-06-02T01:00:00.000Z',
    byteOffset: overrides.rowid * 100,
    charLength: 20,
    text: `chunk ${overrides.rowid}`,
    rank: overrides.rowid,
    rrfScore: 1 / overrides.rowid,
    excerpt: '',
    excerptSegments: [],
    ...overrides,
  };
}

function identity(overrides: Partial<ConversationIdentity> & { conversationId: string }): ConversationIdentity {
  return { projectKey: null, title: null, archived: false, ...overrides };
}

function titleMatch(overrides: Partial<TitleMatchedConversation> & { conversationId: string; title: string }): TitleMatchedConversation {
  return {
    projectKey: null,
    archived: false,
    sessionId: null,
    cwd: '/home/eltmon',
    lastActivityAt: null,
    ...overrides,
  };
}

function resolveBySessionId(map: Record<string, ConversationIdentity>) {
  return (rootSessionId: string): ConversationIdentity => {
    const found = map[rootSessionId];
    if (!found) throw new Error(`no identity for ${rootSessionId}`);
    return found;
  };
}

describe('groupConversationHits', () => {
  it('groups three chunks from one session into one row', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-a', text: 'first prose match needle' }),
      hit({ rowid: 2, sessionId: 'sess-a', text: 'second prose match needle' }),
      hit({ rowid: 3, sessionId: 'sess-a', text: 'third prose match needle' }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({ 'sess-a': identity({ conversationId: 'conv-a' }) }),
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hitCount).toBe(3);
    expect(rows[0].bestHit?.rowid).toBe(1);
  });

  it('folds a subagent chunk into its parent conversation, keeping the higher-scored subagent as bestHit', () => {
    // hits arrive RRF-descending, as fuseRankedRows() produces them — the higher-scored subagent chunk comes first.
    const hits = [
      hit({ rowid: 2, sessionId: 'sub', parentSessionId: 'parent', text: 'subagent prose needle', rrfScore: 0.9 }),
      hit({ rowid: 1, sessionId: 'parent', text: 'parent prose needle', rrfScore: 0.1 }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({ parent: identity({ conversationId: 'conv-parent' }) }),
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].identity.conversationId).toBe('conv-parent');
    expect(rows[0].bestHit?.sessionId).toBe('sub');
  });

  it('groups two sessions resolving to the same conversation name into one row', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-a', text: 'needle in prose' }),
      hit({ rowid: 2, sessionId: 'sess-b', text: 'needle in prose too' }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({
        'sess-a': identity({ conversationId: 'conv-shared' }),
        'sess-b': identity({ conversationId: 'conv-shared' }),
      }),
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].hitCount).toBe(2);
  });

  it('ranks a title-only match above a higher-scored text row, with no bestHit and zero hitCount', () => {
    const hits = [hit({ rowid: 1, sessionId: 'sess-a', text: 'portfolio in prose', rrfScore: 0.9 })];
    const rows = groupConversationHits({
      hits,
      titleMatches: [titleMatch({ conversationId: 'conv-title', title: 'Personal portfolio deployment' })],
      query: 'portfolio',
      resolve: resolveBySessionId({ 'sess-a': identity({ conversationId: 'conv-text' }) }),
      limit: 10,
    });

    expect(rows.map((row) => row.identity.conversationId)).toEqual(['conv-title', 'conv-text']);
    expect(rows[0].bestHit).toBeNull();
    expect(rows[0].hitCount).toBe(0);
    expect(rows[0].tier).toBe('title');
  });

  it('keeps hitCount and bestHit, tier title, when a title match also has chunk hits', () => {
    const hits = [hit({ rowid: 1, sessionId: 'sess-a', text: 'portfolio in prose' })];
    const rows = groupConversationHits({
      hits,
      titleMatches: [titleMatch({ conversationId: 'conv-a', title: 'Personal portfolio deployment' })],
      query: 'portfolio',
      resolve: resolveBySessionId({ 'sess-a': identity({ conversationId: 'conv-a' }) }),
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe('title');
    expect(rows[0].hitCount).toBe(1);
    expect(rows[0].bestHit?.rowid).toBe(1);
  });

  it('ranks a path-only conversation with the higher RRF score below a text conversation', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-path', text: '/home/eltmon/needle/x', rrfScore: 0.9 }),
      hit({ rowid: 2, sessionId: 'sess-text', text: 'we saw needle in the logs', rrfScore: 0.1 }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({
        'sess-path': identity({ conversationId: 'conv-path' }),
        'sess-text': identity({ conversationId: 'conv-text' }),
      }),
      limit: 10,
    });

    expect(rows.map((row) => row.identity.conversationId)).toEqual(['conv-text', 'conv-path']);
    expect(rows[1].tier).toBe('path');
  });

  it('picks the prose chunk as bestHit over a higher-RRF path chunk in the same group', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-a', text: '/home/eltmon/needle/x', rrfScore: 0.9 }),
      hit({ rowid: 2, sessionId: 'sess-a', text: 'we saw needle in the logs', rrfScore: 0.1 }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({ 'sess-a': identity({ conversationId: 'conv-a' }) }),
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].bestHit?.rowid).toBe(2);
  });

  it('limit counts conversations, not chunks', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-a', text: 'needle a' }),
      hit({ rowid: 2, sessionId: 'sess-b', text: 'needle b' }),
      hit({ rowid: 3, sessionId: 'sess-c', text: 'needle c' }),
      hit({ rowid: 4, sessionId: 'sess-d', text: 'needle d' }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({
        'sess-a': identity({ conversationId: 'conv-a' }),
        'sess-b': identity({ conversationId: 'conv-b' }),
        'sess-c': identity({ conversationId: 'conv-c' }),
        'sess-d': identity({ conversationId: 'conv-d' }),
      }),
      limit: 2,
    });

    expect(rows).toHaveLength(2);
  });

  it('carries archived: true from resolve() and from a title match', () => {
    const hits = [hit({ rowid: 1, sessionId: 'sess-a', text: 'needle in prose' })];
    const rows = groupConversationHits({
      hits,
      titleMatches: [titleMatch({ conversationId: 'conv-title', title: 'Archived title needle', archived: true })],
      query: 'needle',
      resolve: resolveBySessionId({ 'sess-a': identity({ conversationId: 'conv-a', archived: true }) }),
      limit: 10,
    });

    const archivedFromHit = rows.find((row) => row.identity.conversationId === 'conv-a');
    const archivedFromTitle = rows.find((row) => row.identity.conversationId === 'conv-title');
    expect(archivedFromHit?.identity.archived).toBe(true);
    expect(archivedFromTitle?.identity.archived).toBe(true);
  });
});
