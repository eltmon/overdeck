/**
 * PAN-4223 WI-2: startConversationRuntime is the one launch path shared by
 * POST /api/conversations and the lane door (D16). With injected spawn and
 * delivery fakes: a successful start delivers the message once; a spawn
 * failure records spawn_error and tears down harnesses that own a native
 * identity (opencode).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `runtime-start-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;
mkdirSync(TEST_HOME, { recursive: true });

const emitOnlyMock = vi.fn();
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: emitOnlyMock })),
}));

const { closeOverdeckDatabase } = await import('../infra.js');
const { createConversation, getConversationByName } = await import('../conversations.js');
const { startConversationRuntime } = await import('../conversation-runtime.js');

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

beforeEach(() => {
  emitOnlyMock.mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function fakes() {
  return {
    spawn: vi.fn(async () => undefined),
    waitReady: vi.fn(async () => undefined),
    deliver: vi.fn(async () => ({ ok: true as const, method: 'tmux' as const })),
    stop: vi.fn(async () => undefined),
  };
}

describe('startConversationRuntime (PAN-4223 WI-2)', () => {
  it('spawns, waits for readiness and delivers the initial message once', async () => {
    const conv = createConversation({ name: 'rt-start-ok', tmuxSession: 'conv-rt-start-ok', cwd: TEST_HOME, harness: 'claude-code', workspaceId: null });
    const deps = fakes();

    await startConversationRuntime({
      conv,
      tmuxSession: 'conv-rt-start-ok',
      cwd: TEST_HOME,
      claudeSessionId: 'sess-ok',
      model: 'opus',
      harness: 'claude-code',
      launchContext: { bareContext: false, skipClaudeMd: false },
      message: 'hello lane',
    }, deps as never);

    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith('conv-rt-start-ok', TEST_HOME, 'sess-ok', 'opus', undefined, undefined, false, 'claude-code', false, { bareContext: false, skipClaudeMd: false });
    expect(deps.waitReady).toHaveBeenCalledWith('conv-rt-start-ok', 'claude-code', 'spawn');
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledWith('conv-rt-start-ok', 'hello lane', 'conversation-message', expect.any(String));
    expect(deps.stop).not.toHaveBeenCalled();
    expect(getConversationByName('rt-start-ok')?.spawnError).toBeNull();
    expect(emitOnlyMock).not.toHaveBeenCalled();
  });

  it('sends nothing when the message is empty', async () => {
    const conv = createConversation({ name: 'rt-start-empty', tmuxSession: 'conv-rt-start-empty', cwd: TEST_HOME, harness: 'claude-code', workspaceId: null });
    const deps = fakes();

    await startConversationRuntime({
      conv, tmuxSession: 'conv-rt-start-empty', cwd: TEST_HOME, claudeSessionId: 'sess-empty',
      harness: 'claude-code', launchContext: { bareContext: false, skipClaudeMd: false }, message: '',
    }, deps as never);

    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('records spawn_error, tears down opencode and re-emits conversation.created on a spawn failure', async () => {
    const conv = createConversation({ name: 'rt-start-fail', tmuxSession: 'conv-rt-start-fail', cwd: TEST_HOME, harness: 'opencode', workspaceId: null });
    const deps = fakes();
    deps.spawn.mockRejectedValueOnce(new Error('opencode binary missing'));

    await expect(startConversationRuntime({
      conv, tmuxSession: 'conv-rt-start-fail', cwd: TEST_HOME, claudeSessionId: 'sess-fail',
      harness: 'opencode', launchContext: { bareContext: false, skipClaudeMd: false }, message: 'go',
    }, deps as never)).resolves.toBeUndefined();

    expect(deps.deliver).not.toHaveBeenCalled();
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(deps.stop).toHaveBeenCalledWith(conv, 'rt-start-fail');
    expect(getConversationByName('rt-start-fail')?.spawnError).toBe('opencode binary missing');
    expect(emitOnlyMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'conversation.created', payload: { conversationName: 'rt-start-fail' } }));
  });

  it('does not tear down claude-code on a spawn failure but still records the error', async () => {
    const conv = createConversation({ name: 'rt-start-fail-cc', tmuxSession: 'conv-rt-start-fail-cc', cwd: TEST_HOME, harness: 'claude-code', workspaceId: null });
    const deps = fakes();
    deps.waitReady.mockRejectedValueOnce(new Error('never ready'));

    await startConversationRuntime({
      conv, tmuxSession: 'conv-rt-start-fail-cc', cwd: TEST_HOME, claudeSessionId: 'sess-fail-cc',
      harness: 'claude-code', launchContext: { bareContext: false, skipClaudeMd: false }, message: 'go',
    }, deps as never);

    expect(deps.stop).not.toHaveBeenCalled();
    expect(getConversationByName('rt-start-fail-cc')?.spawnError).toBe('never ready');
  });
});
