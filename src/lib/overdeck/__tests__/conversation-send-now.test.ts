/**
 * PAN-5353: sendNowToConversation refuses in order — unknown name, released
 * copy, ended conversation, unsupported harness, an answerable permission
 * prompt, an ensure-main refusal — and only presses the send-now chord once
 * every check passes. A non-answerable pending permission does not refuse.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ConversationSendNowDeps } from '../conversation-send-now.js';
import { sendNowToConversation } from '../conversation-send-now.js';
import type { LegacyConversation as Conversation } from '../conversations.js';

const conv = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    name: 'conv-1',
    tmuxSession: 'conv-conv-1',
    harness: 'claude-code',
    status: 'active',
    origin: 'local',
    vaultOwnerLabel: null,
    releasedTo: null,
    ...overrides,
  }) as Conversation;

function makeDeps(overrides: Partial<ConversationSendNowDeps> = {}): ConversationSendNowDeps {
  return {
    getConversation: vi.fn(() => conv()),
    pendingPermission: vi.fn(async () => null),
    ensureMain: vi.fn(async () => ({ ok: true as const, check: 'no-selector' as const })),
    press: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('sendNowToConversation', () => {
  it('refuses an unknown conversation', async () => {
    const deps = makeDeps({ getConversation: vi.fn(() => null) });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: false, status: 404, code: 'not-found', error: 'Conversation not found' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a released copy', async () => {
    const deps = makeDeps({ getConversation: vi.fn(() => conv({ releasedTo: 'env-abc12345' })) });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'conversation-released' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses an ended conversation', async () => {
    const deps = makeDeps({ getConversation: vi.fn(() => conv({ status: 'ended' })) });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: false, status: 409, code: 'not-running', error: 'The conversation has ended — resume it first' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses a non-Claude-Code harness', async () => {
    const deps = makeDeps({ getConversation: vi.fn(() => conv({ harness: 'codex' })) });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toMatchObject({ ok: false, status: 422, code: 'steer-unsupported' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('refuses while an answerable permission prompt is pending', async () => {
    const deps = makeDeps({
      pendingPermission: vi.fn(async () => ({
        signature: 's1', answerable: true, agentLabel: 'Main agent', agentKey: null, toolName: null, header: null, clipped: false,
      })),
    });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: false, status: 409, code: 'permission-pending', error: 'Waiting: the agent needs a permission answer first' });
    expect(deps.ensureMain).not.toHaveBeenCalled();
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('does not refuse on a non-answerable pending permission, and still presses', async () => {
    const deps = makeDeps({
      pendingPermission: vi.fn(async () => ({
        signature: null, answerable: false, agentLabel: 'Unknown agent', agentKey: null, toolName: null, header: null, clipped: false,
      })),
    });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: true });
    expect(deps.press).toHaveBeenCalledTimes(1);
  });

  it('refuses when ensure-main cannot reach the main agent', async () => {
    const deps = makeDeps({
      ensureMain: vi.fn(async () => ({ ok: false as const, reason: 'stuck on the selector', inputTarget: 'subagent' as never })),
    });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: false, status: 409, code: 'input-target-not-main', error: 'stuck on the selector' });
    expect(deps.press).not.toHaveBeenCalled();
  });

  it('reports a press failure', async () => {
    const deps = makeDeps({ press: vi.fn(async () => { throw new Error('herdr call failed'); }) });
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: false, status: 502, code: 'press-failed', error: "Could not press send-now in conv-conv-1's pane: herdr call failed" });
    expect(deps.press).toHaveBeenCalledTimes(1);
  });

  it('presses once with conv.tmuxSession on the happy path', async () => {
    const deps = makeDeps();
    const result = await sendNowToConversation('conv-1', deps);
    expect(result).toEqual({ ok: true });
    expect(deps.press).toHaveBeenCalledTimes(1);
    expect(deps.press).toHaveBeenCalledWith('conv-conv-1');
  });
});
