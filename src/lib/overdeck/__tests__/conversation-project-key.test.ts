import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// PAN-1577: a conversation is grouped under a project by its cwd, set once at
// creation. setConversationProjectKey persists an explicit override so a
// conversation can be moved to a different project without relocating its
// backing session file or its cwd.

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../infra.js');
  closeOverdeckDatabaseSync();
}

let TEST_HOME: string;

beforeEach(async () => {
  await resetDb();
  TEST_HOME = join(tmpdir(), `project-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_HOME, { recursive: true });
  process.env.OVERDECK_HOME = TEST_HOME;
});

afterEach(async () => {
  await resetDb();
  delete process.env.OVERDECK_HOME;
});

describe('setConversationProjectKey (overdeck store)', () => {
  it('defaults to null (falls back to cwd-derived grouping) for a new conversation', async () => {
    const { createConversation, getConversationByName } = await import('../conversations.js');

    createConversation({
      name: 'conv-project-key-default',
      tmuxSession: 'conv-project-key-default',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-project-key-default',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    expect(getConversationByName('conv-project-key-default')?.projectKey).toBeNull();
  });

  it('sets the project assignment override', async () => {
    const { createConversation, setConversationProjectKey, getConversationByName } = await import('../conversations.js');

    createConversation({
      name: 'conv-project-key-set',
      tmuxSession: 'conv-project-key-set',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-project-key-set',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    setConversationProjectKey('conv-project-key-set', 'krux');
    expect(getConversationByName('conv-project-key-set')?.projectKey).toBe('krux');
  });

  it('overwrites an existing project assignment override', async () => {
    const { createConversation, setConversationProjectKey, getConversationByName } = await import('../conversations.js');

    createConversation({
      name: 'conv-project-key-overwrite',
      tmuxSession: 'conv-project-key-overwrite',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-project-key-overwrite',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    setConversationProjectKey('conv-project-key-overwrite', 'krux');
    expect(getConversationByName('conv-project-key-overwrite')?.projectKey).toBe('krux');

    setConversationProjectKey('conv-project-key-overwrite', 'mind-your-now');
    expect(getConversationByName('conv-project-key-overwrite')?.projectKey).toBe('mind-your-now');
  });

  it('clears the project assignment override when passed null', async () => {
    const { createConversation, setConversationProjectKey, getConversationByName } = await import('../conversations.js');

    createConversation({
      name: 'conv-project-key-clear',
      tmuxSession: 'conv-project-key-clear',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-project-key-clear',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    setConversationProjectKey('conv-project-key-clear', 'krux');
    expect(getConversationByName('conv-project-key-clear')?.projectKey).toBe('krux');

    setConversationProjectKey('conv-project-key-clear', null);
    expect(getConversationByName('conv-project-key-clear')?.projectKey).toBeNull();
  });
});
