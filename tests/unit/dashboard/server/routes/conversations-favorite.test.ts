/**
 * Route logic tests for POST/DELETE /api/conversations/:name/favorite (PAN-662).
 *
 * The Effect HTTP routes delegate entirely to these DB functions:
 *   - getConversationByName() → 404 if null
 *   - setFavorite() / removeFavorite() → success path
 *
 * Tests verify both paths against a real overdeck DB (same pattern as other route tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  type OverdeckTestDb,
} from '../../../../helpers/overdeck-test-db.js';
import {
  getConversationByName,
  createConversation,
  listFavoritedIds,
  setFavorite,
  removeFavorite,
} from '../../../../../src/lib/overdeck/conversations.js';

// PAN-3917: conversations and favourites live in the overdeck DB — the
// panopticon schema that backed conversations-db is gone.
let testDb: OverdeckTestDb;

beforeEach(() => {
  testDb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(testDb);
});

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
