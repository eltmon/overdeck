/** PAN-5611 WI-4: FR-1, resurfacing an idle settle after an accepted message. */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  testHome = join(tmpdir(), `pan-5611-idle-resurface-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  process.env.HOME = testHome;
  process.env.OVERDECK_HOME = testHome;
  mkdirSync(testHome, { recursive: true });
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../../../../lib/overdeck/infra.js');
  closeOverdeckDatabase();
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function create(name: string, parentName?: string) {
  const { createConversation } = await import('../../../../lib/overdeck/conversations.js');
  createConversation({ name, tmuxSession: name, cwd: testHome, harness: 'claude-code', parentName });
}

describe('resurfaceIdleSettleAfterMessage', () => {
  it('resurfaces an idle-settled conversation on a 2xx status', async () => {
    const { settleIdleConversation, getConversationTriage, EMPTY_CONVERSATION_TRIAGE, resurfaceIdleSettledConversation } =
      await import('../../../../lib/overdeck/conversation-triage-store.js');
    const { listConversations } = await import('../../../../lib/overdeck/conversations.js');
    const { resurfaceIdleSettleAfterMessage } = await import('../conversation-idle-resurface.js');
    await create('conv-a');
    settleIdleConversation('conv-a', 0, 1_000);
    const emitChanged = vi.fn();
    const invalidate = vi.fn();
    const result = resurfaceIdleSettleAfterMessage('conv-a', 200, {
      listRows: listConversations,
      resurface: (name) => resurfaceIdleSettledConversation(name),
      invalidate,
      emitChanged,
    });
    expect(result).toEqual(['conv-a']);
    expect(getConversationTriage('conv-a')).toEqual(EMPTY_CONVERSATION_TRIAGE);
    expect(emitChanged).toHaveBeenCalledWith('conv-a');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('leaves a manually settled conversation and emits nothing', async () => {
    const { settleConversation, getConversationTriage, resurfaceIdleSettledConversation } = await import(
      '../../../../lib/overdeck/conversation-triage-store.js'
    );
    const { listConversations } = await import('../../../../lib/overdeck/conversations.js');
    const { resurfaceIdleSettleAfterMessage } = await import('../conversation-idle-resurface.js');
    await create('conv-b');
    settleConversation('conv-b', 'manual', 1_000);
    const emitChanged = vi.fn();
    const result = resurfaceIdleSettleAfterMessage('conv-b', 200, {
      listRows: listConversations,
      resurface: (name) => resurfaceIdleSettledConversation(name),
      invalidate: vi.fn(),
      emitChanged,
    });
    expect(result).toEqual([]);
    expect(getConversationTriage('conv-b')?.settleReason).toBe('manual');
    expect(emitChanged).not.toHaveBeenCalled();
  });

  it('leaves a merge settled conversation', async () => {
    const { settleConversation, getConversationTriage, resurfaceIdleSettledConversation } = await import(
      '../../../../lib/overdeck/conversation-triage-store.js'
    );
    const { listConversations } = await import('../../../../lib/overdeck/conversations.js');
    const { resurfaceIdleSettleAfterMessage } = await import('../conversation-idle-resurface.js');
    await create('conv-c');
    settleConversation('conv-c', 'merge', 1_000);
    const result = resurfaceIdleSettleAfterMessage('conv-c', 200, {
      listRows: listConversations,
      resurface: (name) => resurfaceIdleSettledConversation(name),
      invalidate: vi.fn(),
      emitChanged: vi.fn(),
    });
    expect(result).toEqual([]);
    expect(getConversationTriage('conv-c')?.settleReason).toBe('merge');
  });

  it('does nothing for a non-2xx status and never calls listRows', async () => {
    const { settleIdleConversation, getConversationTriage, resurfaceIdleSettledConversation } = await import(
      '../../../../lib/overdeck/conversation-triage-store.js'
    );
    const { resurfaceIdleSettleAfterMessage } = await import('../conversation-idle-resurface.js');
    await create('conv-d');
    settleIdleConversation('conv-d', 0, 1_000);
    const listRows = vi.fn(() => []);
    const result = resurfaceIdleSettleAfterMessage('conv-d', 409, {
      listRows,
      resurface: (name) => resurfaceIdleSettledConversation(name),
      invalidate: vi.fn(),
      emitChanged: vi.fn(),
    });
    expect(result).toEqual([]);
    expect(getConversationTriage('conv-d')?.settleReason).toBe('idle');
    expect(listRows).not.toHaveBeenCalled();
  });

  it('resurfaces the display root when the messaged row is a successor', async () => {
    const { settleIdleConversation, getConversationTriage, EMPTY_CONVERSATION_TRIAGE, resurfaceIdleSettledConversation } =
      await import('../../../../lib/overdeck/conversation-triage-store.js');
    const { listConversations } = await import('../../../../lib/overdeck/conversations.js');
    const { resurfaceIdleSettleAfterMessage } = await import('../conversation-idle-resurface.js');
    await create('conv-root');
    await create('conv-successor', 'conv-root');
    settleIdleConversation('conv-root', 0, 1_000);
    const result = resurfaceIdleSettleAfterMessage('conv-successor', 200, {
      listRows: listConversations,
      resurface: (name) => resurfaceIdleSettledConversation(name),
      invalidate: vi.fn(),
      emitChanged: vi.fn(),
    });
    expect(result).toEqual(['conv-root']);
    expect(getConversationTriage('conv-root')).toEqual(EMPTY_CONVERSATION_TRIAGE);
  });

  it('returns [] and does not throw when the resurface door throws', async () => {
    const { resurfaceIdleSettleAfterMessage } = await import('../conversation-idle-resurface.js');
    await create('conv-e');
    const result = resurfaceIdleSettleAfterMessage('conv-e', 200, {
      listRows: () => [],
      resurface: () => {
        throw new Error('boom');
      },
      invalidate: vi.fn(),
      emitChanged: vi.fn(),
    });
    expect(result).toEqual([]);
  });
});
