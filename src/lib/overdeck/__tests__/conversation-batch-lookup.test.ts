import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// OVERDECK_HOME is captured when infra.js loads, so set it before the first
// dynamic import of the overdeck modules.
const TEST_HOME = join(tmpdir(), `batch-lookup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { getOverdeckDatabase, closeOverdeckDatabase } = await import('../infra.js');
const { createConversation } = await import('../conversations.js');
const { resolveConversationsByClaudeSessionIds } = await import('../conversation-batch-lookup.js');

beforeAll(() => {
  createConversation({
    name: 'conv-a',
    tmuxSession: 'conv-conv-a',
    cwd: TEST_HOME,
    claudeSessionId: 'session-a',
    projectKey: 'proj-key',
    title: 'Title A',
  });
  createConversation({
    name: 'conv-b',
    tmuxSession: 'conv-conv-b',
    cwd: TEST_HOME,
    claudeSessionId: 'session-b',
  });
  getOverdeckDatabase()
    .prepare('UPDATE conversations SET archived_at = ? WHERE name = ?')
    .run(Date.now(), 'conv-b');
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

describe('resolveConversationsByClaudeSessionIds', () => {
  it('returns an empty map for an empty input without querying', () => {
    expect(resolveConversationsByClaudeSessionIds([])).toEqual(new Map());
  });

  it('resolves multiple session ids in one call', () => {
    const results = resolveConversationsByClaudeSessionIds(['session-a', 'session-b', 'session-missing']);
    expect(results.get('session-a')).toEqual({ name: 'conv-a', projectKey: 'proj-key', title: 'Title A', archived: false });
    expect(results.get('session-b')).toEqual({ name: 'conv-b', projectKey: null, title: null, archived: true });
    expect(results.has('session-missing')).toBe(false);
  });

  it('dedupes repeated session ids', () => {
    const results = resolveConversationsByClaudeSessionIds(['session-a', 'session-a']);
    expect(results.size).toBe(1);
  });
});
