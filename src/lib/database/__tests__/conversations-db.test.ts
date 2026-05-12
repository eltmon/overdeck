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
    const conv = createConversation({ name: 'test-session', tmuxSession: 'conv-test-session', cwd: '/home/user/Projects' });
    expect(conv.name).toBe('test-session');
    expect(conv.tmuxSession).toBe('conv-test-session');
    expect(conv.status).toBe('active');
    expect(conv.cwd).toBe('/home/user/Projects');
    expect(conv.issueId).toBeNull();
    expect(conv.id).toBeGreaterThan(0);
    expect(conv.createdAt).toBeTruthy();
    expect(conv.endedAt).toBeNull();
    expect(conv.lastAttachedAt).toBeNull();
    expect(conv.titleSource).toBeNull();
    expect(conv.titleSeed).toBeNull();
  });

  it('createConversation stores issueId when provided', async () => {
    const { createConversation } = await import('../conversations-db.js');
    const conv = createConversation({ name: 'with-issue', tmuxSession: 'conv-with-issue', cwd: '/cwd', issueId: 'PAN-123' });
    expect(conv.issueId).toBe('PAN-123');
  });

  it('createConversation stores title metadata', async () => {
    const { createConversation } = await import('../conversations-db.js');
    const conv = createConversation({
      name: 'titled',
      tmuxSession: 'conv-titled',
      cwd: '/cwd',
      title: 'Fix the bug',
      titleSource: 'auto',
      titleSeed: 'Fix the bug',
    });
    expect(conv.title).toBe('Fix the bug');
    expect(conv.titleSource).toBe('auto');
    expect(conv.titleSeed).toBe('Fix the bug');
  });

  it('listConversations returns all rows newest first', async () => {
    const { createConversation, listConversations } = await import('../conversations-db.js');
    createConversation({ name: 'a', tmuxSession: 'conv-a', cwd: '/cwd' });
    createConversation({ name: 'b', tmuxSession: 'conv-b', cwd: '/cwd' });
    const list = listConversations();
    expect(list).toHaveLength(2);
    // Ordered by created_at DESC — 'b' was created after 'a'
    expect(list[0].name).toBe('b');
    expect(list[1].name).toBe('a');
  });

  it('listConversations excludes agent orchestrator conversations', async () => {
    const { createConversation, listConversations } = await import('../conversations-db.js');
    createConversation({ name: 'user-chat', tmuxSession: 'conv-user', cwd: '/cwd' });
    createConversation({ name: 'agent-pan-123-ship', tmuxSession: 'agent-pan-123-ship', cwd: '/cwd' });
    createConversation({ name: 'agent-pan-123-review-correctness', tmuxSession: 'agent-pan-123-review-correctness', cwd: '/cwd' });
    createConversation({ name: 'planning-pan-456', tmuxSession: 'planning-pan-456', cwd: '/cwd' });
    createConversation({ name: 'specialist-pan-789-review-security', tmuxSession: 'specialist-pan-789-review-security', cwd: '/cwd' });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('user-chat');
  });

  it('getConversationByName returns the matching row', async () => {
    const { createConversation, getConversationByName } = await import('../conversations-db.js');
    createConversation({ name: 'lookup-me', tmuxSession: 'conv-lookup-me', cwd: '/cwd' });
    const conv = getConversationByName('lookup-me');
    expect(conv).not.toBeNull();
    expect(conv!.name).toBe('lookup-me');
  });

  it('getConversationByName returns null for unknown name', async () => {
    const { getConversationByName } = await import('../conversations-db.js');
    expect(getConversationByName('nonexistent')).toBeNull();
  });

  it('getConversationById returns the matching row by id', async () => {
    const { createConversation, getConversationById } = await import('../conversations-db.js');
    const created = createConversation({ name: 'lookup-by-id', tmuxSession: 'conv-lookup-by-id', cwd: '/cwd' });
    const conv = getConversationById(created.id);
    expect(conv).not.toBeNull();
    expect(conv!.name).toBe('lookup-by-id');
  });

  it('getConversationById returns null for unknown id', async () => {
    const { getConversationById } = await import('../conversations-db.js');
    expect(getConversationById(99999)).toBeNull();
  });

  it('markConversationEnded updates status and ended_at', async () => {
    const { createConversation, markConversationEnded, getConversationByName } = await import('../conversations-db.js');
    createConversation({ name: 'end-me', tmuxSession: 'conv-end-me', cwd: '/cwd' });
    markConversationEnded('end-me');
    const conv = getConversationByName('end-me');
    expect(conv!.status).toBe('ended');
    expect(conv!.endedAt).toBeTruthy();
  });

  it('markConversationActive sets status to active and updates last_attached_at', async () => {
    const { createConversation, markConversationEnded, markConversationActive, getConversationByName } = await import('../conversations-db.js');
    createConversation({ name: 'cycle', tmuxSession: 'conv-cycle', cwd: '/cwd' });
    markConversationEnded('cycle');
    markConversationActive('cycle');
    const conv = getConversationByName('cycle');
    expect(conv!.status).toBe('active');
    expect(conv!.lastAttachedAt).toBeTruthy();
  });

  it('updateLastAttached sets last_attached_at without changing status', async () => {
    const { createConversation, updateLastAttached, getConversationByName } = await import('../conversations-db.js');
    createConversation({ name: 'attach', tmuxSession: 'conv-attach', cwd: '/cwd' });
    updateLastAttached('attach');
    const conv = getConversationByName('attach');
    expect(conv!.status).toBe('active');
    expect(conv!.lastAttachedAt).toBeTruthy();
  });

  it('markAllEndedOnStartup marks all active conversations as ended', async () => {
    const { createConversation, markAllEndedOnStartup, listConversations } = await import('../conversations-db.js');
    createConversation({ name: 'x', tmuxSession: 'conv-x', cwd: '/cwd' });
    createConversation({ name: 'y', tmuxSession: 'conv-y', cwd: '/cwd' });
    markAllEndedOnStartup();
    const list = listConversations();
    expect(list.every(c => c.status === 'ended')).toBe(true);
  });

  it('name has UNIQUE constraint — duplicate throws', async () => {
    const { createConversation } = await import('../conversations-db.js');
    createConversation({ name: 'unique-name', tmuxSession: 'conv-unique-name', cwd: '/cwd' });
    expect(() => createConversation({ name: 'unique-name', tmuxSession: 'conv-unique-name-2', cwd: '/cwd' })).toThrow();
  });

  it('canReplaceTitle returns true only for auto titles', async () => {
    const { createConversation, canReplaceTitle, updateConversationTitle, getConversationByName } = await import('../conversations-db.js');
    createConversation({ name: 'replaceable', tmuxSession: 'conv-replaceable', cwd: '/cwd', title: 'Fix bug', titleSource: 'auto', titleSeed: 'Fix bug' });
    const conv = getConversationByName('replaceable')!;
    expect(canReplaceTitle(conv)).toBe(true);

    // After AI update, no longer replaceable
    updateConversationTitle('replaceable', 'AI generated title', 'ai');
    const updated = getConversationByName('replaceable')!;
    expect(canReplaceTitle(updated)).toBe(false);

    // Manual is never replaceable
    updateConversationTitle('replaceable', 'User title', 'manual');
    const manual = getConversationByName('replaceable')!;
    expect(canReplaceTitle(manual)).toBe(false);
  });
});
