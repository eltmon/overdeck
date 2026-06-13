/**
 * Tests for conversations-db.ts favorites functions (PAN-662).
 * Uses an in-memory SQLite database injected via vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { initSchema } from '../../../../src/lib/database/schema.js';

// ============== In-memory DB injection ==============

let testDb: SqliteDatabase;

vi.mock('../../../../src/lib/database/index.js', () => ({
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
  createConversation,
  getConversationByName,
  getStuckForks,
  incrementForkRetryCount,
  listFavoritedIds,
  removeFavorite,
  setFavorite,
  setForkRequest,
} from '../../../../src/lib/database/conversations-db.js';

// ============== Tests ==============

describe('fork recovery metadata', () => {
  it('round-trips fork requests, retry counts, and stuck fork filtering', () => {
    createConversation({ name: 'conv-summary', tmuxSession: 'tmux-summary', cwd: '/tmp', forkStatus: 'summarizing' });
    createConversation({ name: 'conv-failed', tmuxSession: 'tmux-failed', cwd: '/tmp', forkStatus: 'failed' });
    createConversation({ name: 'conv-regular', tmuxSession: 'tmux-regular', cwd: '/tmp' });

    const request = JSON.stringify({
      parentConversationName: 'conv-parent',
      sessionId: 'session-summary',
      forkMode: 'summary',
      localSummaryOnly: false,
      handoffAuthor: 'external',
    });
    setForkRequest('conv-summary', request);

    expect(incrementForkRetryCount('conv-summary')).toBe(1);
    expect(incrementForkRetryCount('conv-summary')).toBe(2);

    const conversation = getConversationByName('conv-summary');
    expect(conversation?.forkRequest).toBe(request);
    expect(conversation?.forkRetryCount).toBe(2);

    expect(getStuckForks().map((fork) => fork.name)).toEqual(['conv-summary']);
  });
});

describe('favorites — listFavoritedIds', () => {
  it('returns an empty array when no favorites exist', () => {
    expect(listFavoritedIds('conversation')).toEqual([]);
  });

  it('returns the IDs of all favorited conversations', () => {
    testDb
      .prepare(`INSERT INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)`)
      .run('conversation', 'conv-1', '2026-01-01T00:00:00.000Z');
    testDb
      .prepare(`INSERT INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)`)
      .run('conversation', 'conv-2', '2026-01-01T00:00:00.000Z');

    const ids = listFavoritedIds('conversation');
    expect(ids).toHaveLength(2);
    expect(ids).toContain('conv-1');
    expect(ids).toContain('conv-2');
  });
});

describe('favorites — setFavorite', () => {
  it('adds a favorite', () => {
    setFavorite('conversation', 'conv-abc');

    const ids = listFavoritedIds('conversation');
    expect(ids).toContain('conv-abc');
  });

  it('is idempotent — calling twice does not throw and does not create duplicates', () => {
    setFavorite('conversation', 'conv-dup');
    setFavorite('conversation', 'conv-dup');

    const ids = listFavoritedIds('conversation');
    expect(ids.filter((id) => id === 'conv-dup')).toHaveLength(1);
  });
});

describe('favorites — removeFavorite', () => {
  it('removes an existing favorite', () => {
    setFavorite('conversation', 'conv-to-remove');
    removeFavorite('conversation', 'conv-to-remove');

    expect(listFavoritedIds('conversation')).not.toContain('conv-to-remove');
  });

  it('is idempotent — removing a non-existent favorite does not throw', () => {
    expect(() => removeFavorite('conversation', 'does-not-exist')).not.toThrow();
  });

  it('only removes the targeted favorite, not others', () => {
    setFavorite('conversation', 'keep');
    setFavorite('conversation', 'remove-me');

    removeFavorite('conversation', 'remove-me');

    const ids = listFavoritedIds('conversation');
    expect(ids).toContain('keep');
    expect(ids).not.toContain('remove-me');
  });
});
