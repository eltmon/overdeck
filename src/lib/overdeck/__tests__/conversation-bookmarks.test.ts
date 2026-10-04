/** PAN-4498 WI-1: the conversation bookmarks door. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-4498-bookmarks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('conversation bookmarks store', () => {
  it('upsert creates then renames without changing createdAt', async () => {
    const { createConversation } = await import('../conversations.js');
    const { upsertConversationBookmark, listConversationBookmarks } = await import('../conversation-bookmarks.js');
    createConversation({ name: 'conv-a', tmuxSession: 'conv-a', cwd: testHome, harness: 'claude-code' });

    const first = upsertConversationBookmark('conv-a', { messageId: 'msg-1', label: 'First label', messageCreatedAt: null }, 1000);
    expect(first).toEqual({ status: 'saved', bookmark: expect.objectContaining({ messageId: 'msg-1', label: 'First label' }) });
    const createdAt = first.status === 'saved' ? first.bookmark.createdAt : null;

    const second = upsertConversationBookmark('conv-a', { messageId: 'msg-1', label: 'Second label', messageCreatedAt: null }, 2000);
    expect(second.status).toBe('saved');
    if (second.status !== 'saved') throw new Error('unreachable');
    expect(second.bookmark.label).toBe('Second label');
    expect(second.bookmark.createdAt).toBe(createdAt);

    const bookmarks = listConversationBookmarks('conv-a');
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]?.label).toBe('Second label');
    expect(bookmarks[0]?.createdAt).toBe(createdAt);
  });

  it('list orders by messageCreatedAt with nulls last', async () => {
    const { createConversation } = await import('../conversations.js');
    const { upsertConversationBookmark, listConversationBookmarks } = await import('../conversation-bookmarks.js');
    createConversation({ name: 'conv-b', tmuxSession: 'conv-b', cwd: testHome, harness: 'claude-code' });

    upsertConversationBookmark('conv-b', { messageId: 'msg-null', label: 'No timestamp', messageCreatedAt: null }, 1000);
    upsertConversationBookmark('conv-b', { messageId: 'msg-later', label: 'Later', messageCreatedAt: '2026-01-02T00:00:00.000Z' }, 2000);
    upsertConversationBookmark('conv-b', { messageId: 'msg-earlier', label: 'Earlier', messageCreatedAt: '2026-01-01T00:00:00.000Z' }, 3000);

    const bookmarks = listConversationBookmarks('conv-b');
    expect(bookmarks.map((b) => b.messageId)).toEqual(['msg-earlier', 'msg-later', 'msg-null']);
  });

  it('remove returns true once and false after', async () => {
    const { createConversation } = await import('../conversations.js');
    const { upsertConversationBookmark, removeConversationBookmark } = await import('../conversation-bookmarks.js');
    createConversation({ name: 'conv-c', tmuxSession: 'conv-c', cwd: testHome, harness: 'claude-code' });
    upsertConversationBookmark('conv-c', { messageId: 'msg-1', label: 'Label', messageCreatedAt: null });

    expect(removeConversationBookmark('conv-c', 'msg-1')).toBe(true);
    expect(removeConversationBookmark('conv-c', 'msg-1')).toBe(false);
  });

  it('upsert returns not-found for an unknown conversation', async () => {
    const { upsertConversationBookmark } = await import('../conversation-bookmarks.js');
    const result = upsertConversationBookmark('no-such-conversation', { messageId: 'msg-1', label: 'Label', messageCreatedAt: null });
    expect(result).toEqual({ status: 'not-found' });
  });

  it('upsert returns limit at 500 bookmarks but still renames an existing one', async () => {
    const { createConversation } = await import('../conversations.js');
    const { upsertConversationBookmark, MAX_BOOKMARKS_PER_CONVERSATION } = await import('../conversation-bookmarks.js');
    createConversation({ name: 'conv-d', tmuxSession: 'conv-d', cwd: testHome, harness: 'claude-code' });

    for (let i = 0; i < MAX_BOOKMARKS_PER_CONVERSATION; i++) {
      const result = upsertConversationBookmark('conv-d', { messageId: `msg-${i}`, label: `Label ${i}`, messageCreatedAt: null });
      expect(result.status).toBe('saved');
    }

    const overflow = upsertConversationBookmark('conv-d', { messageId: 'msg-overflow', label: 'Overflow', messageCreatedAt: null });
    expect(overflow).toEqual({ status: 'limit' });

    const rename = upsertConversationBookmark('conv-d', { messageId: 'msg-0', label: 'Renamed', messageCreatedAt: null });
    expect(rename.status).toBe('saved');
    if (rename.status !== 'saved') throw new Error('unreachable');
    expect(rename.bookmark.label).toBe('Renamed');
  });

  it('deleting the conversation row cascades its bookmarks', async () => {
    const { createConversation } = await import('../conversations.js');
    const { getOverdeckDatabase } = await import('../infra.js');
    const { upsertConversationBookmark, listConversationBookmarks } = await import('../conversation-bookmarks.js');
    createConversation({ name: 'conv-e', tmuxSession: 'conv-e', cwd: testHome, harness: 'claude-code' });
    upsertConversationBookmark('conv-e', { messageId: 'msg-1', label: 'Label', messageCreatedAt: null });
    expect(listConversationBookmarks('conv-e')).toHaveLength(1);

    getOverdeckDatabase().prepare('DELETE FROM conversations WHERE name = ?').run('conv-e');

    expect(listConversationBookmarks('conv-e')).toHaveLength(0);
  });

  it('validateBookmarkInput rejects optimistic ids, empty labels, long labels, bad timestamps', async () => {
    const { validateBookmarkInput, MAX_BOOKMARK_LABEL_LENGTH } = await import('../conversation-bookmarks.js');

    expect(validateBookmarkInput({ messageId: 'optimistic-123', label: 'ok' })).toEqual({
      ok: false,
      error: 'optimistic messages cannot be bookmarked',
    });
    expect(validateBookmarkInput({ messageId: 'msg-1', label: '   ' })).toEqual({
      ok: false,
      error: 'label is required',
    });
    expect(validateBookmarkInput({ messageId: 'msg-1', label: 'x'.repeat(MAX_BOOKMARK_LABEL_LENGTH + 1) })).toEqual({
      ok: false,
      error: 'label is too long (max 200)',
    });
    expect(validateBookmarkInput({ messageId: 'msg-1', label: 'ok', messageCreatedAt: 'not-a-date' })).toEqual({
      ok: false,
      error: 'messageCreatedAt must be an ISO timestamp',
    });
    expect(validateBookmarkInput({ messageId: 'msg-1', label: '  trimmed  ' })).toEqual({
      ok: true,
      messageId: 'msg-1',
      label: 'trimmed',
      messageCreatedAt: null,
    });
  });
});
