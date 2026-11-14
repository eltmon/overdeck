/**
 * PAN-5237 — the composer route honours the receipt's cancel gate: a cancelled
 * send does no pane work, and `commit()` runs once, right before delivery.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnsureMainResult } from '../../agents/input-target.js';
import type { ConversationDeliveryGate } from '../../../dashboard/server/services/conversation-message-receipts.js';
import type { PendingPermission } from '../conversation-permission.js';

const router = vi.hoisted(() => ({ handleComposerCommandMessage: vi.fn(async () => null) }));
vi.mock('../../composer-commands/router.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../composer-commands/router.js')>()),
  handleComposerCommandMessage: router.handleComposerCommandMessage,
}));
vi.mock('../../agents.js', () => ({
  deliverAgentMessage: vi.fn(async () => ({ ok: true, path: 'herdr' })),
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
  testHome = mkdtempSync(join(tmpdir(), 'pan-conv-message-delivery-gate-'));
  process.env.OVERDECK_HOME = testHome;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  router.handleComposerCommandMessage.mockClear();
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function gateStub(state: { cancelled: boolean }, order: string[]): ConversationDeliveryGate & {
  isCancelled: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn>;
} {
  return {
    isCancelled: vi.fn(() => state.cancelled),
    commit: vi.fn(() => { order.push('commit'); return !state.cancelled; }),
  };
}

async function send(options: {
  message?: string;
  gate?: ConversationDeliveryGate;
  permission?: PendingPermission | null;
  order?: string[];
}) {
  const { createConversation, getConversationByName } = await import('../conversations.js');
  const { handleConversationMessage } = await import('../conversation-message.js');
  if (!getConversationByName('gate-conv')) createConversation({
    name: 'gate-conv',
    tmuxSession: 'conv-gate',
    cwd: '/tmp',
    harness: 'claude-code',
    status: 'active',
    titleSource: 'manual',
    title: 'Manual',
  });
  const order = options.order ?? [];
  const permission = vi.fn(async () => options.permission ?? null);
  const ensure = vi.fn(async (): Promise<EnsureMainResult> => { order.push('ensure'); return { ok: true, inputTarget: 'main' }; });
  const deliver = vi.fn(async () => { order.push('deliver'); return { ok: true as const, path: 'herdr' as const }; });
  const response = (await handleConversationMessage('gate-conv', { message: options.message ?? 'hello there' }, {
    resolveSessionFile: async () => null,
    generateAiTitle: async () => {},
    conversationPendingPermission: permission,
    ensureMainInputTarget: ensure,
    deliverAgentMessage: deliver,
    ...(options.gate ? { deliveryGate: options.gate } : {}),
  })) as unknown as { status: number; body: Record<string, unknown> };
  return { response, permission, ensure, deliver };
}

const CANCELLED_BODY = { error: 'Cancelled before delivery', code: 'cancelled', deliveryUnknown: false, retryable: false };

describe('handleConversationMessage delivery gate', () => {
  it('a gate whose commit() fails returns 409 cancelled and never delivers', async () => {
    const gate: ConversationDeliveryGate = { isCancelled: () => false, commit: vi.fn(() => false) };
    const { response, deliver, ensure } = await send({ gate });
    expect(response).toEqual({ status: 409, body: CANCELLED_BODY });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a cancelled gate skips the permission check and ensure-main', async () => {
    const gate = gateStub({ cancelled: true }, []);
    const { response, permission, ensure, deliver } = await send({ gate });
    expect(response).toEqual({ status: 409, body: CANCELLED_BODY });
    expect(permission).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a pending permission prompt returns 409 permission-pending without committing', async () => {
    const gate = gateStub({ cancelled: false }, []);
    const { response, deliver } = await send({
      gate,
      permission: { answerable: true, agentLabel: 'main' } as PendingPermission,
    });
    expect(response.status).toBe(409);
    expect(response.body['code']).toBe('permission-pending');
    expect(gate.commit).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('an open gate commits exactly once, after ensure-main and before delivery', async () => {
    const order: string[] = [];
    const gate = gateStub({ cancelled: false }, order);
    const { response, deliver } = await send({ gate, order });
    expect(response.status).toBe(200);
    expect(gate.commit).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['ensure', 'commit', 'deliver']);
  });

  it('a /pan command with a failed commit never reaches the command router', async () => {
    const gate = gateStub({ cancelled: true }, []);
    const { response, deliver } = await send({ gate, message: '/pan status' });
    expect(response).toEqual({ status: 409, body: CANCELLED_BODY });
    expect(router.handleComposerCommandMessage).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('without a deliveryGate dependency the message delivers as before', async () => {
    const { response, deliver } = await send({});
    expect(response.status).toBe(200);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
