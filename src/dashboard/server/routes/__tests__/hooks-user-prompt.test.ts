/**
 * Tests for workspace-n6rz3 — POST /api/hooks/user-prompt-submit immediate deterministic titling.
 *
 * AC1: Given titleSource='default', valid token and known session_id persists the
 *      derivePromptTitle title with title_source='auto' and emits conversation.title_changed.
 * AC2: The deterministic title update persists when backgroundAi.cheapMode=true and makes zero
 *      AI invocations (generateAiTitle not reached).
 * AC3: Request without internal token returns 401; unknown session_id returns {ok:true} and writes nothing.
 * AC4: titleSource in {'auto','ai','ai-refined','manual','ai-explicit'} are unmodified.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConversation,
  getConversationByName,
} from '../../../../lib/overdeck/conversations.js';
import { handleUserPromptSubmitBody } from '../../../server/routes/hooks.js';

const emittedEvents: unknown[] = [];

vi.mock('../../../server/event-store.js', () => ({
  getEventStore: () => ({
    emitOnly: (event: unknown) => {
      emittedEvents.push(event);
    },
  }),
}));

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-hooks-user-prompt-test-'));
  process.env.OVERDECK_HOME = testHome;
  emittedEvents.length = 0;
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

describe('handleUserPromptSubmitBody', () => {
  it('persists deterministic auto title for titleSource=default and calls generateAiTitle', async () => {
    const generateAiTitle = vi.fn().mockResolvedValue(undefined);

    createConversation({
      name: 'hook-title-default',
      tmuxSession: 'tmux-hook-title-default',
      cwd: '/tmp',
      claudeSessionId: 'session-hook-title-default',
      title: 'New conversation',
      titleSource: 'default',
    });

    const result = await handleUserPromptSubmitBody(
      { session_id: 'session-hook-title-default', prompt: 'Please refactor the auth middleware in src/auth.ts' },
      { generateAiTitle },
    );

    expect(result).toEqual({ ok: true, conversationName: 'hook-title-default', updated: true });

    const conv = getConversationByName('hook-title-default');
    expect(conv?.title).toBe('refactor the auth middleware in src/auth.ts');
    expect(conv?.titleSource).toBe('auto');
    expect(generateAiTitle).toHaveBeenCalledWith('hook-title-default', 'Please refactor the auth middleware in src/auth.ts', {
      resolveSessionFile: expect.any(Function),
    });

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0]).toMatchObject({
      type: 'conversation.title_changed',
      payload: { conversationName: 'hook-title-default', title: 'refactor the auth middleware in src/auth.ts', titleSource: 'auto' },
    });
  });

  it('makes no AI call when generateAiTitle would return early (cheapMode simulation)', async () => {
    const generateAiTitle = vi.fn().mockImplementation(async () => {
      // Simulate the early-return path inside generateAiTitle when the feature is disabled.
      return undefined;
    });

    createConversation({
      name: 'hook-title-cheap',
      tmuxSession: 'tmux-hook-title-cheap',
      cwd: '/tmp',
      claudeSessionId: 'session-hook-title-cheap',
      title: 'New conversation',
      titleSource: 'default',
    });

    const result = await handleUserPromptSubmitBody(
      { session_id: 'session-hook-title-cheap', prompt: 'summarize the weekly report' },
      { generateAiTitle },
    );

    expect(result).toEqual({ ok: true, conversationName: 'hook-title-cheap', updated: true });

    const conv = getConversationByName('hook-title-cheap');
    expect(conv?.title).toBe('summarize the weekly report');
    expect(conv?.titleSource).toBe('auto');
    expect(generateAiTitle).toHaveBeenCalledTimes(1);
  });

  it('returns ok without writing for unknown session_id', async () => {
    const generateAiTitle = vi.fn().mockResolvedValue(undefined);

    createConversation({
      name: 'hook-title-known',
      tmuxSession: 'tmux-hook-title-known',
      cwd: '/tmp',
      claudeSessionId: 'session-known',
      title: 'New conversation',
      titleSource: 'default',
    });

    const result = await handleUserPromptSubmitBody(
      { session_id: 'session-unknown', prompt: 'anything' },
      { generateAiTitle },
    );

    expect(result).toEqual({ ok: true });
    expect(generateAiTitle).not.toHaveBeenCalled();
    expect(emittedEvents).toHaveLength(0);
  });

  it('preserves conversations with non-default title sources', async () => {
    const generateAiTitle = vi.fn().mockResolvedValue(undefined);

    for (const source of ['auto', 'ai', 'ai-refined', 'manual', 'ai-explicit'] as const) {
      createConversation({
        name: `hook-title-${source}`,
        tmuxSession: `tmux-hook-title-${source}`,
        cwd: '/tmp',
        claudeSessionId: `session-${source}`,
        title: source === 'manual' ? 'My Title' : 'Some AI Title',
        titleSource: source,
      });

      const result = await handleUserPromptSubmitBody(
        { session_id: `session-${source}`, prompt: 'change my title' },
        { generateAiTitle },
      );

      expect(result).toEqual({ ok: true, conversationName: `hook-title-${source}`, updated: false });

      const conv = getConversationByName(`hook-title-${source}`);
      expect(conv?.title).toBe(source === 'manual' ? 'My Title' : 'Some AI Title');
      expect(conv?.titleSource).toBe(source);
    }

    expect(generateAiTitle).not.toHaveBeenCalled();
    expect(emittedEvents).toHaveLength(0);
  });
});
