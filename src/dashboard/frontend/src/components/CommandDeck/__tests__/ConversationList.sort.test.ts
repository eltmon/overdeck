import { describe, it, expect } from 'vitest';
import {
  getSortKey,
  sortConversations,
  type Conversation,
  type SortOption,
} from '../ConversationList';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConv(overrides: Partial<Conversation> & { name: string }): Conversation {
  return {
    id: 1,
    name: overrides.name,
    tmuxSession: overrides.name,
    status: 'ended',
    cwd: '/tmp',
    issueId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    lastAttachedAt: null,
    sessionAlive: false,
    title: null,
    isFavorited: false,
    ...overrides,
  };
}

// ─── getSortKey ───────────────────────────────────────────────────────────────

describe('getSortKey', () => {
  it('lastActivity — returns lastAttachedAt when present', () => {
    const conv = makeConv({ name: 'a', lastAttachedAt: '2026-04-10T00:00:00.000Z' });
    expect(getSortKey(conv, 'lastActivity')).toBe('2026-04-10T00:00:00.000Z');
  });

  it('lastActivity — falls back to createdAt when lastAttachedAt is null', () => {
    const conv = makeConv({ name: 'a', lastAttachedAt: null, createdAt: '2026-03-01T00:00:00.000Z' });
    expect(getSortKey(conv, 'lastActivity')).toBe('2026-03-01T00:00:00.000Z');
  });

  it('lastAccessed — returns lastAttachedAt when present', () => {
    const conv = makeConv({ name: 'a', lastAttachedAt: '2026-04-11T00:00:00.000Z' });
    expect(getSortKey(conv, 'lastAccessed')).toBe('2026-04-11T00:00:00.000Z');
  });

  it('lastAccessed — returns empty string when lastAttachedAt is null', () => {
    const conv = makeConv({ name: 'a', lastAttachedAt: null });
    expect(getSortKey(conv, 'lastAccessed')).toBe('');
  });

  it('created — returns createdAt', () => {
    const conv = makeConv({ name: 'a', createdAt: '2026-02-15T00:00:00.000Z' });
    expect(getSortKey(conv, 'created')).toBe('2026-02-15T00:00:00.000Z');
  });

  it('alphabetical — returns lowercased title when present', () => {
    const conv = makeConv({ name: 'a', title: 'Hello World' });
    expect(getSortKey(conv, 'alphabetical')).toBe('hello world');
  });

  it('alphabetical — falls back to lowercased name when title is null', () => {
    const conv = makeConv({ name: 'My-Conv', title: null });
    expect(getSortKey(conv, 'alphabetical')).toBe('my-conv');
  });
});

// ─── sortConversations ────────────────────────────────────────────────────────

describe('sortConversations', () => {
  it('lastActivity — sorts newest-first', () => {
    const convs = [
      makeConv({ name: 'old', lastAttachedAt: '2026-01-01T00:00:00.000Z' }),
      makeConv({ name: 'new', lastAttachedAt: '2026-04-12T00:00:00.000Z' }),
      makeConv({ name: 'mid', lastAttachedAt: '2026-03-01T00:00:00.000Z' }),
    ];
    const sorted = sortConversations(convs, 'lastActivity');
    expect(sorted.map((c) => c.name)).toEqual(['new', 'mid', 'old']);
  });

  it('created — sorts newest-first', () => {
    const convs = [
      makeConv({ name: 'first', createdAt: '2026-01-01T00:00:00.000Z' }),
      makeConv({ name: 'third', createdAt: '2026-04-01T00:00:00.000Z' }),
      makeConv({ name: 'second', createdAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const sorted = sortConversations(convs, 'created');
    expect(sorted.map((c) => c.name)).toEqual(['third', 'second', 'first']);
  });

  it('alphabetical — sorts A-Z by title', () => {
    const convs = [
      makeConv({ name: 'c', title: 'Zebra' }),
      makeConv({ name: 'a', title: 'Apple' }),
      makeConv({ name: 'b', title: 'Mango' }),
    ];
    const sorted = sortConversations(convs, 'alphabetical');
    expect(sorted.map((c) => c.name)).toEqual(['a', 'b', 'c']);
  });

  it('alphabetical — case-insensitive', () => {
    const convs = [
      makeConv({ name: 'b', title: 'banana' }),
      makeConv({ name: 'a', title: 'Apple' }),
    ];
    const sorted = sortConversations(convs, 'alphabetical');
    expect(sorted.map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('lastAccessed — null lastAttachedAt sorts to end', () => {
    const convs = [
      makeConv({ name: 'never', lastAttachedAt: null }),
      makeConv({ name: 'recent', lastAttachedAt: '2026-04-12T00:00:00.000Z' }),
    ];
    const sorted = sortConversations(convs, 'lastAccessed');
    expect(sorted[0].name).toBe('recent');
    expect(sorted[1].name).toBe('never');
  });

  it('does not mutate the input array', () => {
    const convs = [
      makeConv({ name: 'b', createdAt: '2026-01-02T00:00:00.000Z' }),
      makeConv({ name: 'a', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const original = [...convs];
    sortConversations(convs, 'created');
    expect(convs[0].name).toBe(original[0].name);
    expect(convs[1].name).toBe(original[1].name);
  });
});
