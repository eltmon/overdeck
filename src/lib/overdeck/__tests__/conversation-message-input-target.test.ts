/**
 * PAN-4268: the composer route moves Claude Code's typed input to the main
 * agent before pasting, and refuses with 409 `input-target-not-main` when it
 * cannot confirm the switch.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnsureMainResult } from '../../agents/input-target.js';

const deliverAgentMessage = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const callOrder = vi.hoisted(() => [] as string[]);

vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn(async (...args: unknown[]) => {
    callOrder.push('deliver');
    return deliverAgentMessage(...args);
  }),
  injectPiConversationMemory: vi.fn(async (_ctx: unknown, message: string) => message),
}));
vi.mock('../../../dashboard/server/http-helpers.js', () => ({
  jsonResponse: vi.fn((body: unknown, options?: number | { status?: number }) => {
    const status = typeof options === 'number' ? options : options?.status ?? 200;
    return { status, body };
  }),
}));

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-conv-message-input-target-'));
  process.env.OVERDECK_HOME = testHome;
  deliverAgentMessage.mockClear();
  callOrder.length = 0;
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
});

async function send(harness: 'claude-code' | 'codex', ensure: (agentId: string) => Promise<EnsureMainResult>) {
  const { createConversation } = await import('../conversations.js');
  const { handleConversationMessage } = await import('../conversation-message.js');
  createConversation({
    name: `${harness}-conv`,
    tmuxSession: `conv-${harness}`,
    cwd: '/tmp',
    harness,
    status: 'active',
    titleSource: 'manual',
    title: 'Manual',
  });
  return (await handleConversationMessage(`${harness}-conv`, { message: 'hello' }, {
    resolveSessionFile: async () => null,
    generateAiTitle: async () => {},
    ensureMainInputTarget: ensure,
  })) as unknown as { status: number; body: Record<string, unknown> };
}

describe('handleConversationMessage input-target check', () => {
  it('answers 409 input-target-not-main and pastes nothing when ensure refuses', async () => {
    const ensure = vi.fn(async (): Promise<EnsureMainResult> => ({
      ok: false,
      reason: "Could not move keyboard focus into Claude Code's agent selector.",
      inputTarget: { subagent: 'Counter run' },
    }));
    const response = await send('claude-code', ensure);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Could not move keyboard focus into Claude Code's agent selector.",
      code: 'input-target-not-main',
      inputTarget: { subagent: 'Counter run' },
      deliveryUnknown: false,
      retryable: true,
    });
    expect(ensure).toHaveBeenCalledWith('conv-claude-code');
    expect(deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('switches before delivering and reports the subagent it switched from', async () => {
    const ensure = vi.fn(async (): Promise<EnsureMainResult> => {
      callOrder.push('ensure');
      return { ok: true, check: 'switched', switchedFromSubagent: 'Counter run' };
    });
    const response = await send('claude-code', ensure);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, inputTarget: 'main', switchedFromSubagent: 'Counter run' });
    expect(deliverAgentMessage).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['ensure', 'deliver']);
  });

  it('never runs the check for a codex conversation', async () => {
    const ensure = vi.fn(async (): Promise<EnsureMainResult> => ({ ok: true, check: 'already-main' }));
    const response = await send('codex', ensure);
    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('inputTarget');
    expect(ensure).not.toHaveBeenCalled();
    expect(deliverAgentMessage).toHaveBeenCalledTimes(1);
  });
});
