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
const { createConversation, getConversationByName } = await import('../conversations.js');

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
