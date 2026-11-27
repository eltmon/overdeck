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

describe('recent sort (PAN-5677)', () => {
  it('old-best/new-mention: recent mode returns the recently-mentioned conversation first; relevance mode returns the higher-scored one first', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-a', text: 'needle best match', ts: '2026-01-01T00:00:00.000Z', rrfScore: 0.9 }),
      hit({ rowid: 2, sessionId: 'sess-b', text: 'needle higher score', ts: '2026-11-20T00:00:00.000Z', rrfScore: 0.95 }),
      hit({ rowid: 3, sessionId: 'sess-a', text: 'needle weaker but newer', ts: '2026-11-24T00:00:00.000Z', rrfScore: 0.1 }),
    ];
    const resolve = resolveBySessionId({
      'sess-a': identity({ conversationId: 'conv-a' }),
      'sess-b': identity({ conversationId: 'conv-b' }),
    });

    const relevanceRows = groupConversationHits({ hits, titleMatches: [], query: 'needle', resolve, limit: 10 });
    expect(relevanceRows.map((row) => row.identity.conversationId)).toEqual(['conv-b', 'conv-a']);

    const recentRows = groupConversationHits({ hits, titleMatches: [], query: 'needle', resolve, limit: 10, sort: 'recent' });
    expect(recentRows.map((row) => row.identity.conversationId)).toEqual(['conv-a', 'conv-b']);
    expect(recentRows[0]?.latestMatchAt).toBe('2026-11-24T00:00:00.000Z');
  });

  it('truncation: recent mode includes the newest, lowest-scored conversation inside the limit; relevance mode excludes it', () => {
    const olderHits: ConversationSearchHit[] = [];
    const identities: Record<string, ConversationIdentity> = {};
    for (let i = 1; i <= 20; i++) {
      const sessionId = `sess-${i}`;
      olderHits.push(hit({
        rowid: i,
        sessionId,
        text: `needle older ${i}`,
        ts: `2025-01-${String(i).padStart(2, '0')}T00:00:00.000Z`,
        rrfScore: 1 / i,
      }));
      identities[sessionId] = identity({ conversationId: `conv-older-${i}` });
    }
    const newestHit = hit({ rowid: 100, sessionId: 'sess-newest', text: 'needle newest', ts: '2026-11-26T00:00:00.000Z', rrfScore: 0.0001 });
    identities['sess-newest'] = identity({ conversationId: 'conv-newest' });
    const hits = [...olderHits, newestHit];
    const resolve = resolveBySessionId(identities);

    const relevanceRows = groupConversationHits({ hits, titleMatches: [], query: 'needle', resolve, limit: 15 });
    expect(relevanceRows.map((row) => row.identity.conversationId)).not.toContain('conv-newest');

    const recentRows = groupConversationHits({ hits, titleMatches: [], query: 'needle', resolve, limit: 15, sort: 'recent' });
    expect(recentRows[0]?.identity.conversationId).toBe('conv-newest');
  });

  it('tier still wins: a title match from 2026-01 sorts above a text match from 2026-11 in recent mode', () => {
    const hits = [hit({ rowid: 1, sessionId: 'sess-text', text: 'needle in prose', ts: '2026-11-20T00:00:00.000Z' })];
    const rows = groupConversationHits({
      hits,
      titleMatches: [titleMatch({ conversationId: 'conv-title', title: 'Old needle title', lastActivityAt: '2026-01-01T00:00:00.000Z' })],
      query: 'needle',
      resolve: resolveBySessionId({ 'sess-text': identity({ conversationId: 'conv-text' }) }),
      limit: 10,
      sort: 'recent',
    });

    expect(rows.map((row) => row.identity.conversationId)).toEqual(['conv-title', 'conv-text']);
  });

  it('null last: a row with no valid timestamp sorts after a timestamped row of the same tier in recent mode', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-null', text: 'needle without a timestamp', ts: null }),
      hit({ rowid: 2, sessionId: 'sess-ts', text: 'needle with a timestamp', ts: '2026-01-01T00:00:00.000Z' }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({
        'sess-null': identity({ conversationId: 'conv-null' }),
        'sess-ts': identity({ conversationId: 'conv-ts' }),
      }),
      limit: 10,
      sort: 'recent',
    });

    expect(rows.map((row) => row.identity.conversationId)).toEqual(['conv-ts', 'conv-null']);
  });

  it('a title match with chunk hits takes latestMatchAt from the later of its newest chunk and its lastActivityAt', () => {
    const hits = [hit({ rowid: 1, sessionId: 'sess-a', text: 'needle in prose', ts: '2026-11-20T00:00:00.000Z' })];
    const rows = groupConversationHits({
      hits,
      titleMatches: [titleMatch({ conversationId: 'conv-a', title: 'Needle title', lastActivityAt: '2026-01-01T00:00:00.000Z' })],
      query: 'needle',
      resolve: resolveBySessionId({ 'sess-a': identity({ conversationId: 'conv-a' }) }),
      limit: 10,
    });

    expect(rows[0]?.latestMatchAt).toBe('2026-11-20T00:00:00.000Z');
  });

  it('existing relevance-mode tests pass unchanged: no sort argument defaults to relevance order', () => {
    const hits = [
      hit({ rowid: 1, sessionId: 'sess-a', text: '/home/eltmon/needle/x', rrfScore: 0.9 }),
      hit({ rowid: 2, sessionId: 'sess-b', text: 'we saw needle in the logs', rrfScore: 0.1 }),
    ];
    const rows = groupConversationHits({
      hits,
      titleMatches: [],
      query: 'needle',
      resolve: resolveBySessionId({
        'sess-a': identity({ conversationId: 'conv-path' }),
        'sess-b': identity({ conversationId: 'conv-text' }),
      }),
      limit: 10,
    });

    expect(rows.map((row) => row.identity.conversationId)).toEqual(['conv-text', 'conv-path']);
  });
});
