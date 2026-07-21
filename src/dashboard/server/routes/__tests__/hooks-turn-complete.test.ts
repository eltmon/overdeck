/**
 * Tests for workspace-iv027 — POST /api/hooks/turn-complete.
 *
 * AC1: Valid token + known session_id invokes handleTurnComplete and returns {ok:true}
 *      without awaiting the model.
 * AC2: Missing token returns 401; unknown session_id returns {ok:true} and invokes nothing.
 * AC3: The old polling refinement scheduler is removed from the codebase.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createConversation,
  getConversationByName,
} from '../../../../lib/overdeck/conversations.js';

vi.setConfig({ testTimeout: 15_000 });

const emittedEvents: unknown[] = [];
const handleTurnCompleteMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../lib/dashboard/server/event-store.js', () => ({
  getEventStore: () => ({
    emitOnly: (event: unknown) => {
      emittedEvents.push(event);
    },
  }),
}));

vi.mock('../../../../lib/overdeck/title-refinement.js', () => ({
  handleTurnComplete: (...args: unknown[]) => handleTurnCompleteMock(...args),
}));

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-hooks-turn-complete-test-'));
  process.env.OVERDECK_HOME = testHome;
  emittedEvents.length = 0;
  handleTurnCompleteMock.mockClear();
});

afterEach(async () => {
  const { closeOverdeckDatabaseSync } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabaseSync();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

const { handleTurnCompleteBody } = await import('../../../server/routes/hooks.js');

describe('handleTurnCompleteBody', () => {
  it('invokes handleTurnComplete for a known session and returns ok', async () => {
    createConversation({
      name: 'turn-complete-known',
      tmuxSession: 'tmux-turn-complete-known',
      cwd: '/tmp',
      claudeSessionId: 'session-turn-complete-known',
      title: 'AI Title',
      titleSource: 'ai',
    });

    const result = await handleTurnCompleteBody({ session_id: 'session-turn-complete-known' });

    expect(result).toEqual({ ok: true, conversationName: 'turn-complete-known' });
    expect(handleTurnCompleteMock).toHaveBeenCalledTimes(1);
    const [convArg, depsArg] = handleTurnCompleteMock.mock.calls[0];
    expect(convArg.name).toBe('turn-complete-known');
    expect(depsArg).toHaveProperty('resolveSessionFile');
  });

  it('returns ok without invoking for unknown session_id', async () => {
    const result = await handleTurnCompleteBody({ session_id: 'session-unknown' });

    expect(result).toEqual({ ok: true });
    expect(handleTurnCompleteMock).not.toHaveBeenCalled();
  });

  it('returns ok without invoking when session_id is missing', async () => {
    const result = await handleTurnCompleteBody({});

    expect(result).toEqual({ ok: true });
    expect(handleTurnCompleteMock).not.toHaveBeenCalled();
  });
});
