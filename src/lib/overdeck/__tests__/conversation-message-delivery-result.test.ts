/**
 * PAN-4278 — the composer route inspects deliverAgentMessage's DeliveryResult:
 * a returned failure is a 502 `not-delivered` with a log line, never a silent
 * `ok: true`; a success logs which path delivered it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeliveryResult } from '../../agents/delivery.js';

vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'tmux' })),
  injectPiConversationMemory: vi.fn(async (_ctx: unknown, message: string) => message),
}));
vi.mock('../../../dashboard/server/http-helpers.js', () => ({
  jsonResponse: vi.fn((body: unknown, options?: number | { status?: number }) => {
    const status = typeof options === 'number' ? options : options?.status ?? 200;
    return { status, body };
  }),
}));

const { controlChannelMock } = vi.hoisted(() => ({ controlChannelMock: vi.fn(async () => undefined) }));
vi.mock('../conversation-delivery.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deliverConversationViaControlChannel: controlChannelMock,
}));

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-conv-message-delivery-result-'));
  process.env.OVERDECK_HOME = testHome;
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function send(result: DeliveryResult) {
  const { createConversation } = await import('../conversations.js');
  const { handleConversationMessage } = await import('../conversation-message.js');
  createConversation({
    name: 'delivery-conv',
    tmuxSession: 'conv-delivery',
    cwd: '/tmp',
    harness: 'claude-code',
    status: 'active',
    titleSource: 'manual',
    title: 'Manual',
  });
  const deliver = vi.fn(async () => result);
  const response = (await handleConversationMessage('delivery-conv', { message: 'BTW How can I launch Orca?' }, {
    resolveSessionFile: async () => null,
    generateAiTitle: async () => {},
    ensureMainInputTarget: async () => ({ ok: true, inputTarget: 'main' }),
    conversationPendingPermission: async () => null,
    deliverAgentMessage: deliver,
  })) as unknown as { status: number; body: Record<string, unknown> };
  return { response, deliver };
}

describe('handleConversationMessage delivery result', () => {
  it('a Herdr refusal result returns 502 not-delivered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { response, deliver } = await send({ ok: false, path: 'herdr', failure: 'refused: agent_blocked' });
    expect(deliver).toHaveBeenCalledWith('conv-delivery', 'BTW How can I launch Orca?', 'conversation-message', expect.anything());
    expect(response).toEqual({
      status: 502,
      body: {
        error: 'Not delivered: refused: agent_blocked',
        code: 'not-delivered',
        deliveryUnknown: false,
        retryable: true,
      },
    });
    expect(warn).toHaveBeenCalledWith('[conversations] delivery-conv: not delivered via herdr: refused: agent_blocked');
  });

  it('a thrown Herdr error surfaced as ok:false returns 502 not-delivered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { response } = await send({ ok: false, path: 'herdr', failure: 'herdr socket closed' });
    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ code: 'not-delivered', error: 'Not delivered: herdr socket closed' });
  });

  it('success logs delivered via herdr', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { response } = await send({ ok: true, path: 'herdr' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, inputTarget: 'main' });
    expect(log).toHaveBeenCalledWith('[conversations] delivery-conv: delivered via herdr');
  });

  it('a deduplicated delivery logs it and succeeds', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { response } = await send({ ok: true, path: 'herdr', deduplicated: true, failure: 'dropped: duplicate message id' });
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith('[conversations] delivery-conv: delivered via herdr (deduplicated)');
  });
});

describe('handleConversationMessage steer delivery (PAN-4292)', () => {
  async function sendAs(harness: 'claude-code' | 'codex' | 'ohmypi', body: Record<string, unknown>, result: DeliveryResult = { ok: true, path: 'tmux', steered: true }) {
    const { createConversation } = await import('../conversations.js');
    const { handleConversationMessage } = await import('../conversation-message.js');
    createConversation({
      name: `steer-${harness}`,
      tmuxSession: `conv-steer-${harness}`,
      cwd: '/tmp',
      harness,
      status: 'active',
      titleSource: 'manual',
      title: 'Manual',
    });
    const deliver = vi.fn(async () => result);
    const response = (await handleConversationMessage(`steer-${harness}`, { message: 'change course now', ...body }, {
      resolveSessionFile: async () => null,
      generateAiTitle: async () => {},
      ensureMainInputTarget: async () => ({ ok: true, inputTarget: 'main' }),
      conversationPendingPermission: async () => null,
      deliverAgentMessage: deliver,
    })) as unknown as { status: number; body: Record<string, unknown> };
    return { response, deliver };
  }

  beforeEach(() => {
    controlChannelMock.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('a Claude Code steer delivers with submit steer', async () => {
    const { response, deliver } = await sendAs('claude-code', { deliverAs: 'steer' });
    expect(response.status).toBe(200);
    expect(deliver).toHaveBeenCalledWith('conv-steer-claude-code', 'change course now', 'conversation-message', expect.anything(), { submit: 'steer' });
  });

  it('a Claude Code message without deliverAs delivers without a submit option', async () => {
    const { response, deliver } = await sendAs('claude-code', {}, { ok: true, path: 'tmux' });
    expect(response.status).toBe(200);
    expect(deliver).toHaveBeenCalledWith('conv-steer-claude-code', 'change course now', 'conversation-message', expect.anything());
    expect(deliver.mock.calls[0]).toHaveLength(4);
  });

  it('reports steerDegraded when the delivery fell back to a normal submit', async () => {
    const { response } = await sendAs('claude-code', { deliverAs: 'steer' }, {
      ok: true,
      path: 'supervisor',
      steered: false,
      failure: 'supervisor predates steer; delivered as a normal submit',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, steerDegraded: 'supervisor predates steer; delivered as a normal submit' });
  });

  it('a Codex steer is refused with 422 steer-unsupported and nothing is delivered', async () => {
    const { response, deliver } = await sendAs('codex', { deliverAs: 'steer' });
    expect(response).toEqual({
      status: 422,
      body: { error: 'Codex has no steer delivery', code: 'steer-unsupported', deliveryUnknown: false, retryable: false },
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a Claude Code follow-up is refused with 422 steer-unsupported', async () => {
    const { response, deliver } = await sendAs('claude-code', { deliverAs: 'follow_up' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'steer-unsupported', error: 'Claude Code has no follow-up delivery' });
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a Pi steer still goes over the control channel', async () => {
    const { response, deliver } = await sendAs('ohmypi', { deliverAs: 'steer' });
    expect(response.status).toBe(200);
    expect(deliver).not.toHaveBeenCalled();
    expect(controlChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'steer-ohmypi' }),
      'change course now',
      { source: 'operator', deliverAs: 'steer' },
    );
  });
});
