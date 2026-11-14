/** PAN-5211 D20: counter-form Codex bookmark ids move to offset ids. */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-5211-bookmarks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  const { resetCodexBookmarkMigrationForTests } = await import('../codex-bookmark-migration.js');
  resetCodexBookmarkMigrationForTests();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

const event = (payload: object) => JSON.stringify({ type: 'event_msg', timestamp: '2026-11-13T00:00:00.000Z', payload });
const item = (payload: object) => JSON.stringify({ type: 'response_item', timestamp: '2026-11-13T00:00:00.000Z', payload });

/** Three user messages; the second one comes after a tool call, so its counter id is codex-user-3. */
function writeTranscript(): string {
  const file = join(testHome, 'rollout-2026-11-13T00-00-00-thread.jsonl');
  writeFileSync(file, [
    event({ type: 'user_message', message: 'first' }),
    item({ type: 'function_call', name: 'exec_command', arguments: '{"cmd":"ls"}', call_id: 'call_1' }),
    event({ type: 'user_message', message: 'second' }),
    event({ type: 'user_message', message: 'third' }),
  ].join('\n') + '\n');
  return file;
}

async function setup() {
  const { createConversation } = await import('../conversations.js');
  const { upsertConversationBookmark } = await import('../conversation-bookmarks.js');
  createConversation({ name: 'codex-conv', tmuxSession: 'conv-codex-conv', cwd: testHome, harness: 'codex' });
  upsertConversationBookmark('codex-conv', { messageId: 'codex-user-3', label: 'Second', messageCreatedAt: null }, 1000);
  upsertConversationBookmark('codex-conv', { messageId: 'codex-user-99', label: 'Gone', messageCreatedAt: null }, 1000);
  const file = writeTranscript();
  return { file, deps: { resolveSessionFile: async () => file } };
}

async function offsetIdOf(file: string, text: string): Promise<string> {
  const { parseCodexConversationMessages } = await import('../../../dashboard/server/services/codex-conversation-parser.js');
  const parsed = await parseCodexConversationMessages(file);
  return parsed.messages.find((m) => m.text === text)!.id;
}

describe('migrateCodexCounterBookmarks', () => {
  it('rewrites a counter-form bookmark to the offset id of the same message', async () => {
    const { file, deps } = await setup();
    const { migrateCodexCounterBookmarks } = await import('../codex-bookmark-migration.js');
    const { listConversationBookmarks } = await import('../conversation-bookmarks.js');

    await migrateCodexCounterBookmarks('codex-conv', deps);

    const expected = await offsetIdOf(file, 'second');
    expect(expected).toMatch(/^codex-user-@\d+$/);
    expect(listConversationBookmarks('codex-conv').find((b) => b.label === 'Second')?.messageId).toBe(expected);
  });

  it('changes nothing on a second run', async () => {
    const { deps } = await setup();
    const { migrateCodexCounterBookmarks, resetCodexBookmarkMigrationForTests } = await import('../codex-bookmark-migration.js');
    const { listConversationBookmarks } = await import('../conversation-bookmarks.js');
    await migrateCodexCounterBookmarks('codex-conv', deps);
    const after = listConversationBookmarks('codex-conv');

    resetCodexBookmarkMigrationForTests();
    await migrateCodexCounterBookmarks('codex-conv', deps);

    expect(listConversationBookmarks('codex-conv')).toEqual(after);
  });

  it('leaves a counter id with no matching row unchanged', async () => {
    const { deps } = await setup();
    const { migrateCodexCounterBookmarks } = await import('../codex-bookmark-migration.js');
    const { listConversationBookmarks } = await import('../conversation-bookmarks.js');

    await migrateCodexCounterBookmarks('codex-conv', deps);

    expect(listConversationBookmarks('codex-conv').find((b) => b.label === 'Gone')?.messageId).toBe('codex-user-99');
  });
});

describe('migrateCodexCounterBookmarks — pre-PAN-5211 counting rules', () => {
  it('counts an oversized message the way the old parser did', async () => {
    const { createConversation } = await import('../conversations.js');
    const { upsertConversationBookmark, listConversationBookmarks } = await import('../conversation-bookmarks.js');
    const { migrateCodexCounterBookmarks } = await import('../codex-bookmark-migration.js');
    createConversation({ name: 'codex-big', tmuxSession: 'conv-codex-big', cwd: testHome, harness: 'codex' });
    // Counter ids: first = 1, the 9 MB message = 2, the call = 3, target = 4.
    upsertConversationBookmark('codex-big', { messageId: 'codex-user-4', label: 'Target', messageCreatedAt: null }, 1000);
    const lines = [
      event({ type: 'user_message', message: 'first' }),
      event({ type: 'user_message', message: 'b'.repeat(9 * 1024 * 1024) }),
      item({ type: 'function_call', name: 'exec_command', arguments: '{}', call_id: 'call_1' }),
      event({ type: 'user_message', message: 'target' }),
    ];
    const file = join(testHome, 'rollout-2026-11-13T00-00-00-big.jsonl');
    writeFileSync(file, lines.join('\n') + '\n');
    const targetOffset = lines.slice(0, 3).reduce((sum, l) => sum + Buffer.byteLength(l) + 1, 0);

    await migrateCodexCounterBookmarks('codex-big', { resolveSessionFile: async () => file });

    expect(listConversationBookmarks('codex-big')[0]?.messageId).toBe(`codex-user-@${targetOffset}`);
  });

  it('tries again after the transcript could not be resolved', async () => {
    const { file } = await setup();
    const { migrateCodexCounterBookmarks } = await import('../codex-bookmark-migration.js');
    const { listConversationBookmarks } = await import('../conversation-bookmarks.js');

    await migrateCodexCounterBookmarks('codex-conv', { resolveSessionFile: async () => null });
    expect(listConversationBookmarks('codex-conv').find((b) => b.label === 'Second')?.messageId).toBe('codex-user-3');

    await migrateCodexCounterBookmarks('codex-conv', { resolveSessionFile: async () => file });
    expect(listConversationBookmarks('codex-conv').find((b) => b.label === 'Second')?.messageId).toBe(await offsetIdOf(file, 'second'));
  });
});

