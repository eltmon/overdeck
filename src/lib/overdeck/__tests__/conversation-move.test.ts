import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// PAN-1577: PATCH /api/conversations/:name/move reassigns a conversation's
// project via the project_key override, without ever touching cwd, the tmux
// session, or the backing session file (the JSONL is sacred).

const TEST_HOME = join(tmpdir(), `conv-move-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const KRUX_PATH = join(TEST_HOME, 'projects', 'krux');
const MYN_PATH = join(TEST_HOME, 'projects', 'myn');

const emitOnlyMock = vi.fn();
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: emitOnlyMock })),
}));

const { handleConversationMove } = await import('../conversation-reads.js');
const { createConversation, getConversationByName, setConversationClaudeSessionId } = await import('../conversations.js');

async function resetDb() {
  const { closeOverdeckDatabaseSync } = await import('../infra.js');
  closeOverdeckDatabaseSync();
}

beforeAll(() => {
  mkdirSync(KRUX_PATH, { recursive: true });
  mkdirSync(MYN_PATH, { recursive: true });
  writeFileSync(
    join(TEST_HOME, 'projects.yaml'),
    [
      'projects:',
      '  krux:',
      '    name: Krux',
      `    path: ${KRUX_PATH}`,
      '  myn:',
      '    name: MYN',
      `    path: ${MYN_PATH}`,
      '  ghost:',
      '    name: Ghost',
      `    path: ${join(TEST_HOME, 'projects', 'does-not-exist')}`,
      '',
    ].join('\n'),
    'utf-8',
  );
});

afterAll(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

beforeEach(async () => {
  await resetDb();
  emitOnlyMock.mockClear();
});

describe('handleConversationMove', () => {
  it('sets the project_key override and returns the updated conversation (ac1)', () => {
    createConversation({
      name: 'conv-move-ac1',
      tmuxSession: 'conv-move-ac1',
      cwd: KRUX_PATH,
      claudeSessionId: 'sess-move-ac1',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    const result = handleConversationMove('conv-move-ac1', { projectKey: 'myn' });

    expect(result.status).toBe(200);
    expect('error' in result.body).toBe(false);
    expect((result.body as { projectKey: string | null }).projectKey).toBe('myn');
    expect(getConversationByName('conv-move-ac1')?.projectKey).toBe('myn');
  });

  it('returns 400 Unknown project for an unregistered project key (ac2)', () => {
    createConversation({
      name: 'conv-move-ac2-unknown',
      tmuxSession: 'conv-move-ac2-unknown',
      cwd: KRUX_PATH,
      claudeSessionId: 'sess-move-ac2-unknown',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    const result = handleConversationMove('conv-move-ac2-unknown', { projectKey: 'nope' });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Unknown project: nope' });
  });

  it('returns 400 Unknown project when the registered path is missing on disk (ac2)', () => {
    createConversation({
      name: 'conv-move-ac2-ghost',
      tmuxSession: 'conv-move-ac2-ghost',
      cwd: KRUX_PATH,
      claudeSessionId: 'sess-move-ac2-ghost',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    const result = handleConversationMove('conv-move-ac2-ghost', { projectKey: 'ghost' });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Unknown project: ghost' });
  });

  it('returns 404 for an unknown conversation name (ac2)', () => {
    const result = handleConversationMove('conv-move-does-not-exist', { projectKey: 'myn' });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Conversation not found' });
  });

  it('no-ops with 200 and does not emit when already in the target project (ac3)', () => {
    createConversation({
      name: 'conv-move-ac3',
      tmuxSession: 'conv-move-ac3',
      cwd: KRUX_PATH,
      claudeSessionId: 'sess-move-ac3',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });
    handleConversationMove('conv-move-ac3', { projectKey: 'myn' });
    emitOnlyMock.mockClear();

    const result = handleConversationMove('conv-move-ac3', { projectKey: 'myn' });

    expect(result.status).toBe(200);
    expect(emitOnlyMock).not.toHaveBeenCalled();
  });

  it('emits conversation.moved with {conversationName, projectKey} on a real move (ac4)', () => {
    createConversation({
      name: 'conv-move-ac4',
      tmuxSession: 'conv-move-ac4',
      cwd: KRUX_PATH,
      claudeSessionId: 'sess-move-ac4',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });

    handleConversationMove('conv-move-ac4', { projectKey: 'myn' });

    expect(emitOnlyMock).toHaveBeenCalledTimes(1);
    expect(emitOnlyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'conversation.moved',
        payload: { conversationName: 'conv-move-ac4', projectKey: 'myn' },
      }),
    );
  });

  it('leaves cwd and the on-disk JSONL pointer unchanged after a move (ac5, JSONL sacred)', () => {
    createConversation({
      name: 'conv-move-ac5',
      tmuxSession: 'conv-move-ac5',
      cwd: KRUX_PATH,
      claudeSessionId: 'sess-move-ac5',
      title: 'New conversation',
      harness: 'pi',
      model: 'glm-5.2',
    });
    setConversationClaudeSessionId('conv-move-ac5', 'sess-move-ac5');
    const before = getConversationByName('conv-move-ac5');

    const result = handleConversationMove('conv-move-ac5', { projectKey: 'myn' });

    expect(result.status).toBe(200);
    const after = getConversationByName('conv-move-ac5');
    expect(after?.cwd).toBe(before?.cwd);
    expect(after?.claudeSessionId).toBe(before?.claudeSessionId);
  });
});
