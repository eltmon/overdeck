/**
 * Route logic tests for POST/DELETE /api/conversations/:name/favorite (PAN-662).
 *
 * The Effect HTTP routes delegate entirely to these DB functions:
 *   - getConversationByName() → 404 if null
 *   - setFavorite() / removeFavorite() → success path
 *
 * Tests verify both paths with a real in-memory DB (same pattern as other route tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: SqliteDatabase;

vi.mock('../../../../../src/lib/database/index.js', () => ({
  getDatabase: () => testDb,
}));

beforeEach(() => {
  testDb = openDatabase(':memory:');
  testDb.pragma('foreign_keys = ON');
  initSchema(testDb);
});

afterEach(() => {
  testDb.close();
});

// ============== Imports (after mock is set up) ==============

import {
  getConversationByName,
  createConversation,
  listFavoritedIds,
  setFavorite,
  removeFavorite,
} from '../../../../../src/lib/database/conversations-db.js';

// ============== Helpers ==============

function makeConversation(name: string) {
  return createConversation({ name, tmuxSession: `tmux-${name}`, cwd: '/tmp' });
}

// ============== POST /api/conversations/:name/favorite ==============

describe('POST /api/conversations/:name/favorite', () => {
  it('404 path — returns null for non-existent conversation', () => {
    // Route: const conv = getConversationByName(name); if (!conv) → 404
    const conv = getConversationByName('does-not-exist');
    expect(conv).toBeNull();
  });

  it('success path — conversation exists, setFavorite adds it to favorites', () => {
    makeConversation('conv-post-test');

    // Route: const conv = getConversationByName(name); (not null, no 404)
    const conv = getConversationByName('conv-post-test');
    expect(conv).not.toBeNull();

    // Route: setFavorite('conversation', name);
    setFavorite('conversation', 'conv-post-test');

    expect(listFavoritedIds('conversation')).toContain('conv-post-test');
  });

  it('success path — re-favoriting is idempotent (no 500)', () => {
    makeConversation('conv-re-fav');
    setFavorite('conversation', 'conv-re-fav');

    // Second call to setFavorite should not throw
    expect(() => setFavorite('conversation', 'conv-re-fav')).not.toThrow();
    expect(listFavoritedIds('conversation').filter((id) => id === 'conv-re-fav')).toHaveLength(1);
  });
});

// ============== DELETE /api/conversations/:name/favorite ==============

describe('DELETE /api/conversations/:name/favorite', () => {
  it('404 path — returns null for non-existent conversation', () => {
    // Route: const conv = getConversationByName(name); if (!conv) → 404
    const conv = getConversationByName('no-such-conv');
    expect(conv).toBeNull();
  });

  it('success path — conversation exists, removeFavorite removes it', () => {
    makeConversation('conv-del-test');
    setFavorite('conversation', 'conv-del-test');

    // Route: const conv = getConversationByName(name); (not null, no 404)
    const conv = getConversationByName('conv-del-test');
    expect(conv).not.toBeNull();

    // Route: removeFavorite('conversation', name);
    removeFavorite('conversation', 'conv-del-test');

    expect(listFavoritedIds('conversation')).not.toContain('conv-del-test');
  });

  it('success path — un-favoriting when not favorited is idempotent (no 500)', () => {
    makeConversation('conv-not-fav');

    // removeFavorite on a conversation that isn't favorited should not throw
    expect(() => removeFavorite('conversation', 'conv-not-fav')).not.toThrow();
  });
});
