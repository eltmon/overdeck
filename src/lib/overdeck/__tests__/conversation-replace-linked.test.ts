/**
 * Re-creating a conversation under a name whose old row other conversations
 * link to: the old row is kept under a retired name instead of deleted, so the
 * foreign keys hold. `pan flywheel start --fresh` failed with "FOREIGN KEY
 * constraint failed" once the old flywheel conversation had a successor.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `replace-linked-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { closeOverdeckDatabase } = await import('../infra.js');
const {
  createConversation,
  getConversationByClaudeSessionId,
  getConversationByName,
  listRetiredConversations,
  retireConversation,
} = await import('../conversations.js');

const CWD = join(TEST_HOME, 'projects', 'overdeck');

function conv(name: string, extra: Partial<Parameters<typeof createConversation>[0]> = {}) {
  return createConversation({ name, tmuxSession: name, cwd: CWD, workspaceId: null, ...extra });
}

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('createConversation over a linked same-name row', () => {
  it('keeps the old row under a retired name, archived, and still linked from its successor', () => {
    const old = conv('conv-flywheel');
    conv('successor', { parentName: 'conv-flywheel' });

    const fresh = conv('conv-flywheel');

    expect(fresh.id).not.toBe(old.id);
    expect(getConversationByName('conv-flywheel')?.id).toBe(fresh.id);
    const successor = getConversationByName('successor');
    expect(successor?.parentConversationId).toBe(old.id);
    const retired = getConversationByName(successor?.parentConversationName ?? '');
    expect(retired?.name).toMatch(/^conv-flywheel~/);
    expect(retired?.archivedAt).toBeTruthy();
    expect(retired?.tmuxSession).not.toBe('conv-flywheel');
  });

  it('still replaces an unlinked same-name row outright', () => {
    conv('plain', { title: 'old' });
    const fresh = conv('plain', { title: 'new' });
    expect(getConversationByName('plain')).toMatchObject({ id: fresh.id, title: 'new' });
  });
});

describe('retireConversation (PAN-5666)', () => {
  it('keeps the previous row, its session id and its files under a retired name when a new row takes the name', () => {
    const old = conv('conv-wheel', { claudeSessionId: 'aaaaaaaa-1111-4111-8111-111111111111' });

    const retiredName = retireConversation('conv-wheel');
    const fresh = conv('conv-wheel', { claudeSessionId: 'bbbbbbbb-2222-4222-8222-222222222222' });

    expect(retiredName).toMatch(/^conv-wheel~/);
    expect(getConversationByName('conv-wheel')?.id).toBe(fresh.id);
    const retired = getConversationByName(retiredName ?? '');
    expect(retired).toMatchObject({ id: old.id, status: 'ended', claudeSessionId: 'aaaaaaaa-1111-4111-8111-111111111111' });
    expect(retired?.archivedAt).toBeTruthy();
    expect(retired?.tmuxSession).not.toBe('conv-wheel');
    // The conversation_files locator survives, so the transcript still resolves.
    expect(getConversationByClaudeSessionId('aaaaaaaa-1111-4111-8111-111111111111')?.id).toBe(old.id);
    expect(listRetiredConversations('conv-wheel').map((row) => row.id)).toEqual([old.id]);
  });

  it('lists retired rows newest first and returns null when no row holds the name', () => {
    expect(retireConversation('conv-none')).toBeNull();
    const first = conv('conv-many');
    retireConversation('conv-many');
    const second = conv('conv-many');
    retireConversation('conv-many');
    conv('conv-many');
    expect(listRetiredConversations('conv-many').map((row) => row.id)).toEqual([second.id, first.id]);
    // `conv-many~…` only: a different name sharing the prefix is not retired from it.
    conv('conv-many-other');
    expect(listRetiredConversations('conv-many')).toHaveLength(2);
  });
});
