/**
 * Tests for ActivityPanel pure logic helpers (PAN-653)
 *
 * Covers:
 *   - inferCategory(): source → category mapping
 *   - mergeActivitiesById(): dedup from multiple sources, newest-first sort
 *   - applyPinWarnings(): warn/error pinned to top
 */

import { describe, it, expect } from 'vitest';
import { inferCategory, mergeActivitiesById, applyPinWarnings } from './ActivityPanel';
import type { ActivityEntry } from './ActivityPanel';

function makeEntry(partial: Partial<ActivityEntry> & { id: string }): ActivityEntry {
  return {
    timestamp: '2026-04-01T00:00:00.000Z',
    source: 'dashboard',
    level: 'info',
    message: 'test message',
    ...partial,
  };
}

// ─── inferCategory ────────────────────────────────────────────────────────────

describe('inferCategory', () => {
  it('returns explicit category if set', () => {
    const entry = makeEntry({ id: '1', source: 'anything', category: 'git' });
    expect(inferCategory(entry)).toBe('git');
  });

  it('returns "git" for source === "git"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'git' }))).toBe('git');
  });

  it('returns "specialist" for source containing "specialist"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'test-specialist' }))).toBe('specialist');
  });

  it('returns "specialist" for source containing "merge-agent"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'merge-agent' }))).toBe('specialist');
  });

  it('returns "specialist" for source containing "review"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'review-specialist' }))).toBe('specialist');
  });

  it('returns "specialist" for source containing "test" (not specialist)', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'test-runner' }))).toBe('specialist');
  });

  it('returns "sync" for source containing "sync"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'auto-sync' }))).toBe('sync');
  });

  it('returns "sync" for source containing "pull"', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'pull-watcher' }))).toBe('sync');
  });

  it('returns "other" for unrecognized sources', () => {
    expect(inferCategory(makeEntry({ id: '1', source: 'dashboard' }))).toBe('other');
    expect(inferCategory(makeEntry({ id: '1', source: 'cloister' }))).toBe('other');
  });

  it('returns "other" for empty source', () => {
    expect(inferCategory(makeEntry({ id: '1', source: '' }))).toBe('other');
  });
});

// ─── mergeActivitiesById ──────────────────────────────────────────────────────

describe('mergeActivitiesById', () => {
  it('deduplicates entries with the same id across sources', () => {
    const a1 = makeEntry({ id: 'x', source: 'first', message: 'first version' });
    const a2 = makeEntry({ id: 'x', source: 'second', message: 'second version' });
    const result = mergeActivitiesById([a1], [a2]);
    expect(result).toHaveLength(1);
    // Last write wins (git-activity source overwrites REST)
    expect(result[0].source).toBe('second');
  });

  it('merges distinct entries from multiple sources', () => {
    const store = [makeEntry({ id: '1', timestamp: '2026-04-01T10:00:00.000Z' })];
    const rest  = [makeEntry({ id: '2', timestamp: '2026-04-01T09:00:00.000Z' })];
    const git   = [makeEntry({ id: '3', timestamp: '2026-04-01T08:00:00.000Z' })];
    const result = mergeActivitiesById(store, rest, git);
    expect(result).toHaveLength(3);
    expect(result.map(e => e.id)).toEqual(['1', '2', '3']);
  });

  it('sorts newest-first by timestamp', () => {
    const older = makeEntry({ id: 'a', timestamp: '2026-04-01T08:00:00.000Z' });
    const newer = makeEntry({ id: 'b', timestamp: '2026-04-01T10:00:00.000Z' });
    const result = mergeActivitiesById([older, newer]);
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });

  it('handles empty arrays without throwing', () => {
    const result = mergeActivitiesById([], [], []);
    expect(result).toHaveLength(0);
  });

  it('handles a single source', () => {
    const entries = [makeEntry({ id: '1' }), makeEntry({ id: '2' })];
    expect(mergeActivitiesById(entries)).toHaveLength(2);
  });
});

// ─── applyPinWarnings ─────────────────────────────────────────────────────────

describe('applyPinWarnings', () => {
  it('returns list unchanged when pinWarnings is false', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'warn' }),
      makeEntry({ id: '3', level: 'success' }),
    ];
    const result = applyPinWarnings(entries, false);
    expect(result.map(e => e.id)).toEqual(['1', '2', '3']);
  });

  it('moves warn entries to the front when pinWarnings is true', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'warn' }),
      makeEntry({ id: '3', level: 'success' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result[0].id).toBe('2');
    expect(result.slice(1).map(e => e.id)).toEqual(['1', '3']);
  });

  it('moves error entries to the front when pinWarnings is true', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'error' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result[0].id).toBe('2');
    expect(result[1].id).toBe('1');
  });

  it('preserves relative order within pinned group and non-pinned group', () => {
    const entries = [
      makeEntry({ id: 'i1', level: 'info' }),
      makeEntry({ id: 'w1', level: 'warn' }),
      makeEntry({ id: 'i2', level: 'success' }),
      makeEntry({ id: 'w2', level: 'error' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result.map(e => e.id)).toEqual(['w1', 'w2', 'i1', 'i2']);
  });

  it('returns empty list for empty input', () => {
    expect(applyPinWarnings([], true)).toHaveLength(0);
    expect(applyPinWarnings([], false)).toHaveLength(0);
  });

  it('works when all entries are warn/error', () => {
    const entries = [
      makeEntry({ id: '1', level: 'warn' }),
      makeEntry({ id: '2', level: 'error' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result.map(e => e.id)).toEqual(['1', '2']);
  });

  it('works when no entries are warn/error', () => {
    const entries = [
      makeEntry({ id: '1', level: 'info' }),
      makeEntry({ id: '2', level: 'success' }),
    ];
    const result = applyPinWarnings(entries, true);
    expect(result.map(e => e.id)).toEqual(['1', '2']);
  });
});
