import { describe, expect, it, vi } from 'vitest';

import { conversationNeedsTerminal } from '../conversation-reads.js';
import type { LegacyConversation as Conversation } from '../conversations.js';

const conv = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    name: 'conv-20260714-4261',
    tmuxSession: 'conv-20260714-4261',
    harness: 'claude-code',
    ...overrides,
  }) as Conversation;

const ONBOARDING_PANE =
  'Welcome to Claude Code v2.1.209\n Select login method:\n ❯ 1. Claude account with subscription';

describe('conversationNeedsTerminal', () => {
  it('flags an alive claude-code session with no transcript parked on onboarding', async () => {
    const capture = vi.fn(async () => ONBOARDING_PANE);
    await expect(conversationNeedsTerminal(conv(), true, null, capture)).resolves.toBe(true);
    expect(capture).toHaveBeenCalledWith('conv-20260714-4261');
  });

  it('treats a null harness as claude-code (the storage default)', async () => {
    const capture = vi.fn(async () => ONBOARDING_PANE);
    await expect(conversationNeedsTerminal(conv({ harness: null }), true, null, capture)).resolves.toBe(true);
  });

  it('never captures for dead sessions, non-claude harnesses, or existing transcripts', async () => {
    const capture = vi.fn(async () => ONBOARDING_PANE);
    await expect(conversationNeedsTerminal(conv(), false, null, capture)).resolves.toBe(false);
    await expect(conversationNeedsTerminal(conv({ harness: 'codex' }), true, null, capture)).resolves.toBe(false);
    // This test file exists on disk, so the transcript-present branch short-circuits.
    await expect(conversationNeedsTerminal(conv(), true, import.meta.filename, capture)).resolves.toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });

  it('stays false on a normal REPL pane and on capture failure', async () => {
    await expect(conversationNeedsTerminal(conv(), true, null, async () => '❯ ready')).resolves.toBe(false);
    await expect(conversationNeedsTerminal(conv(), true, null, async () => {
      throw new Error('no such session');
    })).resolves.toBe(false);
  });
});
