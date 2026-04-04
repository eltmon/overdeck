import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Must set PANOPTICON_HOME before importing DB modules so they use a temp path
let TEST_HOME: string;

// Helper to reset the DB singleton between tests
async function resetDb() {
  const { resetDatabase } = await import('../index.js');
  resetDatabase();
}

beforeEach(() => {
  TEST_HOME = join(tmpdir(), `pan-416-conv-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.PANOPTICON_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.PANOPTICON_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('conversations-db', () => {
  it('createConversation inserts a row and returns it', async () => {
    const { createConversation } = await import('../conversations-db.js');
    const conv = createConversation('test-session', 'conv-test-session', '/home/user/Projects');
    expect(conv.name).toBe('test-session');
    expect(conv.tmuxSession).toBe('conv-test-session');
    expect(conv.status).toBe('active');
    expect(conv.cwd).toBe('/home/user/Projects');
    expect(conv.issueId).toBeNull();
    expect(conv.id).toBeGreaterThan(0);
    expect(conv.createdAt).toBeTruthy();
    expect(conv.endedAt).toBeNull();
    expect(conv.lastAttachedAt).toBeNull();
  });

  it('createConversation stores issueId when provided', async () => {
    const { createConversation } = await import('../conversations-db.js');
    const conv = createConversation('with-issue', 'conv-with-issue', '/cwd', 'PAN-123');
    expect(conv.issueId).toBe('PAN-123');
  });

  it('listConversations returns all rows newest first', async () => {
    const { createConversation, listConversations } = await import('../conversations-db.js');
    createConversation('a', 'conv-a', '/cwd');
    createConversation('b', 'conv-b', '/cwd');
    const list = listConversations();
    expect(list).toHaveLength(2);
    // Ordered by created_at DESC — 'b' was created after 'a'
    expect(list[0].name).toBe('b');
    expect(list[1].name).toBe('a');
  });

  it('getConversationByName returns the matching row', async () => {
    const { createConversation, getConversationByName } = await import('../conversations-db.js');
    createConversation('lookup-me', 'conv-lookup-me', '/cwd');
    const conv = getConversationByName('lookup-me');
    expect(conv).not.toBeNull();
    expect(conv!.name).toBe('lookup-me');
  });

  it('getConversationByName returns null for unknown name', async () => {
    const { getConversationByName } = await import('../conversations-db.js');
    expect(getConversationByName('nonexistent')).toBeNull();
  });

  it('markConversationEnded updates status and ended_at', async () => {
    const { createConversation, markConversationEnded, getConversationByName } = await import('../conversations-db.js');
    createConversation('end-me', 'conv-end-me', '/cwd');
    markConversationEnded('end-me');
    const conv = getConversationByName('end-me');
    expect(conv!.status).toBe('ended');
    expect(conv!.endedAt).toBeTruthy();
  });

  it('markConversationActive sets status to active and updates last_attached_at', async () => {
    const { createConversation, markConversationEnded, markConversationActive, getConversationByName } = await import('../conversations-db.js');
    createConversation('cycle', 'conv-cycle', '/cwd');
    markConversationEnded('cycle');
    markConversationActive('cycle');
    const conv = getConversationByName('cycle');
    expect(conv!.status).toBe('active');
    expect(conv!.lastAttachedAt).toBeTruthy();
  });

  it('updateLastAttached sets last_attached_at without changing status', async () => {
    const { createConversation, updateLastAttached, getConversationByName } = await import('../conversations-db.js');
    createConversation('attach', 'conv-attach', '/cwd');
    updateLastAttached('attach');
    const conv = getConversationByName('attach');
    expect(conv!.status).toBe('active');
    expect(conv!.lastAttachedAt).toBeTruthy();
  });

  it('markAllEndedOnStartup marks all active conversations as ended', async () => {
    const { createConversation, markAllEndedOnStartup, listConversations } = await import('../conversations-db.js');
    createConversation('x', 'conv-x', '/cwd');
    createConversation('y', 'conv-y', '/cwd');
    markAllEndedOnStartup();
    const list = listConversations();
    expect(list.every(c => c.status === 'ended')).toBe(true);
  });

  it('name has UNIQUE constraint — duplicate throws', async () => {
    const { createConversation } = await import('../conversations-db.js');
    createConversation('unique-name', 'conv-unique-name', '/cwd');
    expect(() => createConversation('unique-name', 'conv-unique-name-2', '/cwd')).toThrow();
  });
});
