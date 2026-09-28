/**
 * PAN-4278 — the composer route refuses to paste while the conversation's pane
 * shows a permission prompt (409 `permission-pending`), checked before
 * ensure-main whose keys would answer the prompt. A hook-registry entry with no
 * prompt on screen never holds a message.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnsureMainResult } from '../../agents/input-target.js';

const pane = vi.hoisted(() => ({ text: '' }));
vi.mock('../../terminal-backends/agent-pane-io.js', () => ({
  resolveAgentPaneIo: vi.fn(async () => ({ backend: 'herdr', read: async () => pane.text, sendKey: vi.fn() })),
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

function fixture(name: string): string {
  return readFileSync(new URL(`../../agents/__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'pan-conv-message-permission-hold-'));
  process.env.OVERDECK_HOME = testHome;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  const { closeOverdeckDatabase } = await import('../infra.js');
  const { resetPermissionRegistryForTests } = await import('../conversation-permission-registry.js');
  closeOverdeckDatabase();
  resetPermissionRegistryForTests();
  delete process.env.OVERDECK_HOME;
  rmSync(testHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function send() {
  const { createConversation, getConversationByName } = await import('../conversations.js');
  const { handleConversationMessage } = await import('../conversation-message.js');
  if (!getConversationByName('hold-conv')) createConversation({
    name: 'hold-conv',
    tmuxSession: 'conv-hold',
    cwd: '/tmp',
    harness: 'claude-code',
    status: 'active',
    titleSource: 'manual',
    title: 'Manual',
  });
  const ensure = vi.fn(async (): Promise<EnsureMainResult> => ({ ok: true, inputTarget: 'main' }));
  const deliver = vi.fn(async () => ({ ok: true as const, path: 'herdr' as const }));
  const response = (await handleConversationMessage('hold-conv', { message: 'Look like a lot of stuff has been merged?' }, {
    resolveSessionFile: async () => null,
    generateAiTitle: async () => {},
    ensureMainInputTarget: ensure,
    deliverAgentMessage: deliver,
  })) as unknown as { status: number; body: Record<string, unknown> };
  return { response, ensure, deliver };
}

describe('handleConversationMessage permission hold', () => {
  it('a fixture pane with a permission prompt returns 409 permission-pending', async () => {
    pane.text = fixture('permission-subagent.txt');
    const { response } = await send();
    expect(response).toEqual({
      status: 409,
      body: {
        error: 'Waiting: the agent needs a permission answer first',
        code: 'permission-pending',
        deliveryUnknown: false,
        retryable: true,
      },
    });
  });

  it('ensureMainInputTarget is not called while a prompt is up', async () => {
    pane.text = fixture('permission-bash.txt');
    const { ensure } = await send();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('deliverAgentMessage is not called while a prompt is up', async () => {
    pane.text = fixture('permission-dangerous-rm.txt');
    const { deliver } = await send();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('a registry-only entry with no prompt on the pane still delivers', async () => {
    const { recordPermissionRequest } = await import('../conversation-permission-registry.js');
    recordPermissionRequest('hold-conv', {
      agentKey: 'main', agentId: null, agentType: null, agentDescription: null,
      toolName: 'Bash', toolInputPreview: 'rm -f queue/*', requestedAt: '2026-09-27T15:32:21.000Z',
    });
    pane.text = fixture('permission-answered.txt');
    const { response, deliver } = await send();
    expect(response.status).toBe(200);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('the same message delivers once the fixture pane shows no prompt', async () => {
    pane.text = fixture('permission-bash.txt');
    expect((await send()).response.status).toBe(409);

    pane.text = fixture('permission-answered.txt');
    const { response, ensure, deliver } = await send();
    expect(response.status).toBe(200);
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith('conv-hold', 'Look like a lot of stuff has been merged?', 'conversation-message', expect.anything());
  });
});
