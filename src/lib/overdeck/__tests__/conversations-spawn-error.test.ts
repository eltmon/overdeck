import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Regression guard: a background conversation spawn that fails (e.g. Z.AI
// returns HTTP 529 "overloaded" during the pre-flight provider health check)
// must persist the reason to `spawn_error` so the dashboard can render it.
// The overdeck writer was previously a no-op stub, so the error was logged but
// never surfaced — the conversation appeared as a silently stopped agent.

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../infra.js');
  closeOverdeckDatabaseSync();
}

let TEST_HOME: string;

beforeEach(async () => {
  await resetDb();
  TEST_HOME = join(tmpdir(), `spawn-error-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
});

describe('updateSpawnError (overdeck store)', () => {
  it('persists a spawn error so the reader surfaces it as spawnError', async () => {
    const { createConversation, updateSpawnError, getConversationByName } = await import('../conversations.js');

    createConversation({
      name: 'conv-spawn-fail',
      tmuxSession: 'conv-spawn-fail',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-spawn-fail',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    const reason = 'Z.AI (glm-5.2): provider returned 529 server error — try again later or switch models';
    updateSpawnError('conv-spawn-fail', reason);

    expect(getConversationByName('conv-spawn-fail')?.spawnError).toBe(reason);
  });

  it('clears the spawn error when passed null', async () => {
    const { createConversation, updateSpawnError, getConversationByName } = await import('../conversations.js');

    createConversation({
      name: 'conv-spawn-clear',
      tmuxSession: 'conv-spawn-clear',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-spawn-clear',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    updateSpawnError('conv-spawn-clear', 'boom');
    expect(getConversationByName('conv-spawn-clear')?.spawnError).toBe('boom');

    updateSpawnError('conv-spawn-clear', null);
    expect(getConversationByName('conv-spawn-clear')?.spawnError).toBeNull();
  });
});
