/**
 * PAN-4278: POST /api/conversations/:id/permission — verify the on-screen
 * prompt, send arrows + Enter, confirm the prompt left the screen.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4278-conv-permission-answer-'));
process.env.OVERDECK_HOME = TEST_HOME;

vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { createConversation } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');
const { handleConversationPermissionAnswer } = await import('../conversation-permission.js');
const { parsePermissionPrompt } = await import('../../agents/permission-prompt.js');
const { listPermissionRequests, recordPermissionRequest } = await import('../conversation-permission-registry.js');

function fixture(name: string): string {
  return readFileSync(new URL(`../../agents/__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

const BASH = fixture('permission-bash.txt');
const RM = fixture('permission-dangerous-rm.txt');
const ANSWERED = fixture('permission-answered.txt');

createConversation({ name: 'perm-answer', tmuxSession: 'conv-perm-answer', cwd: TEST_HOME, title: 'Perm answer' });
createConversation({ name: 'perm-answer-codex', tmuxSession: 'conv-perm-answer-codex', cwd: TEST_HOME, title: 'Codex', harness: 'codex' });

/** Pane IO whose reads return `screens` in order (the last one repeats). */
function fakeIo(...screens: string[]) {
  const sent: string[] = [];
  let reads = 0;
  return {
    sent,
    io: {
      read: vi.fn(async () => screens[Math.min(reads++, screens.length - 1)]!),
      sendKey: vi.fn(async (key: string) => { sent.push(key); }),
    },
  };
}

const sleep = vi.fn(async () => {});
const signature = (screen: string) => parsePermissionPrompt(screen)!.signature;

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('handleConversationPermissionAnswer', () => {
  it('allow-once sends Enter only when the cursor is on Yes', async () => {
    const { io, sent } = fakeIo(BASH, ANSWERED);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'allow-once', signature: signature(BASH) }, { io, sleep });
    expect(result).toEqual({ body: { ok: true, answered: 'allow-once' } });
    expect(sent).toEqual(['Enter']);
  });

  it('clears the answered prompt\'s hook entry after a confirmed answer', async () => {
    recordPermissionRequest('perm-answer', {
      agentKey: 'main', agentId: null, agentType: null, agentDescription: null,
      toolName: 'Bash', toolInputPreview: 'touch /tmp/pan4278-probe-marker.txt', requestedAt: '2026-09-27T15:00:00.000Z',
    });
    const { io } = fakeIo(BASH, ANSWERED);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'deny', signature: signature(BASH) }, { io, sleep });
    expect(result.body).toEqual({ ok: true, answered: 'deny' });
    expect(listPermissionRequests('perm-answer')).toEqual([]);
  });

  it('deny arrows to No and presses Enter', async () => {
    const { io, sent } = fakeIo(BASH, ANSWERED);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'deny', signature: signature(BASH) }, { io, sleep });
    expect(result.body).toEqual({ ok: true, answered: 'deny' });
    expect(sent).toEqual(['Down', 'Down', 'Enter']);
  });

  it('refuses with prompt-gone and sends no keys', async () => {
    const { io, sent } = fakeIo(ANSWERED);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'deny', signature: signature(BASH) }, { io, sleep });
    expect(result).toMatchObject({ status: 409, body: { code: 'prompt-gone' } });
    expect(sent).toEqual([]);
  });

  it('refuses with prompt-changed and sends no keys', async () => {
    const { io, sent } = fakeIo(RM);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'deny', signature: signature(BASH) }, { io, sleep });
    expect(result).toMatchObject({ status: 409, body: { code: 'prompt-changed' } });
    expect(sent).toEqual([]);
  });

  it('returns delivery-unconfirmed when the prompt is still on screen', async () => {
    const { io, sent } = fakeIo(RM);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'deny', signature: signature(RM) }, { io, sleep });
    expect(result).toMatchObject({ status: 409, body: { code: 'delivery-unconfirmed' } });
    expect(sent).toEqual(['Down', 'Enter']);
  });

  it('choice-not-offered for allow-always on a 2-option prompt', async () => {
    const { io, sent } = fakeIo(RM);
    const result = await handleConversationPermissionAnswer('perm-answer', { choice: 'allow-always', signature: signature(RM) }, { io, sleep });
    expect(result).toMatchObject({ status: 400, body: { code: 'choice-not-offered' } });
    expect(sent).toEqual([]);
  });

  it('validates the body and the conversation', async () => {
    const { io } = fakeIo(BASH);
    expect((await handleConversationPermissionAnswer('perm-answer', { choice: 'maybe', signature: 'x' }, { io, sleep })).status).toBe(400);
    expect((await handleConversationPermissionAnswer('perm-answer', { choice: 'deny' }, { io, sleep })).status).toBe(400);
    expect((await handleConversationPermissionAnswer('nope', { choice: 'deny', signature: 'x' }, { io, sleep })).status).toBe(404);
    expect((await handleConversationPermissionAnswer('perm-answer-codex', { choice: 'deny', signature: 'x' }, { io, sleep })).status).toBe(400);
    expect(io.sendKey).not.toHaveBeenCalled();
  });
});
