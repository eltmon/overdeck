/**
 * PAN-5169: `readConversationPermission`'s `legacyTmuxFallback` deps option
 * passes straight through to `resolveAgentPaneIo`'s third argument.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-5169-conv-permission-strict-'));
process.env.OVERDECK_HOME = TEST_HOME;

const resolveSpy = vi.hoisted(() => vi.fn());
vi.mock('../../terminal-backends/agent-pane-io.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../terminal-backends/agent-pane-io.js')>()),
  resolveAgentPaneIo: resolveSpy,
}));

const { readConversationPermission } = await import('../conversation-permission.js');
const { createConversation } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('readConversationPermission legacyTmuxFallback', () => {
  beforeEach(() => {
    resolveSpy.mockReset();
  });

  it('resolves tmuxPaneText null when resolveAgentPaneIo rejects, passing legacyTmuxFallback: false through', async () => {
    const conv = createConversation({ name: 'conv-x', tmuxSession: 'conv-x', cwd: '/tmp', harness: 'claude-code' });
    resolveSpy.mockRejectedValue(new Error('herdr holds no pane for conv-x'));
    const result = await readConversationPermission(conv, { legacyTmuxFallback: false });
    expect(result.tmuxPaneText).toBeNull();
    expect(resolveSpy).toHaveBeenCalledWith('conv-x', undefined, { legacyTmuxFallback: false });
  });

  it('keeps the default fallback (not false) when no deps are passed', async () => {
    const conv = createConversation({ name: 'conv-y', tmuxSession: 'conv-y', cwd: '/tmp', harness: 'claude-code' });
    resolveSpy.mockResolvedValue({ backend: 'tmux', read: async () => 'screen', sendKey: vi.fn() });
    const result = await readConversationPermission(conv);
    expect(result.tmuxPaneText).toBe('screen');
    const thirdArg = resolveSpy.mock.calls[0]?.[2];
    expect(thirdArg?.legacyTmuxFallback).not.toBe(false);
  });
});
