/**
 * PAN-4485: plan-action, permission and pane-choice answers refuse a
 * superseded /clear row with 409 conversation-cleared, sending no keystrokes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEST_HOME = join(tmpdir(), `input-doors-clear-chain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.OVERDECK_HOME = TEST_HOME;

const { sendRawKeystroke } = vi.hoisted(() => ({ sendRawKeystroke: vi.fn() }));
vi.mock('../../tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../tmux.js')>()),
  sendRawKeystroke,
}));
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));

const { closeOverdeckDatabase } = await import('../infra.js');
const { createConversation, setClearedToConvId } = await import('../conversations.js');
const { handleConversationPlanAction } = await import('../conversation-delivery.js');
const { handleConversationPermissionAnswer } = await import('../conversation-permission.js');
const { handleConversationPaneChoiceAnswer } = await import('../conversation-pane-choice.js');

const CWD = join(TEST_HOME, 'projects', 'fixture');

beforeAll(() => {
  mkdirSync(CWD, { recursive: true });
});

afterAll(() => {
  closeOverdeckDatabase();
  rmSync(TEST_HOME, { recursive: true, force: true });
  delete process.env.OVERDECK_HOME;
});

function makeSupersededRow(suffix: string) {
  const parent = createConversation({ name: `door-parent-${suffix}`, tmuxSession: `conv-door-${suffix}`, cwd: CWD, harness: 'claude-code' });
  const sibling = createConversation({ name: `door-parent-${suffix}-post-clear`, tmuxSession: `conv-door-${suffix}`, cwd: CWD, harness: 'claude-code' });
  setClearedToConvId(parent.name, sibling.id);
  return parent;
}

describe('input doors refuse a superseded row (PAN-4485)', () => {
  it('plan action: 409 conversation-cleared, no keystroke sent', async () => {
    const parent = makeSupersededRow('a');
    sendRawKeystroke.mockClear();

    const response = await handleConversationPlanAction(parent.name, { action: 'approve' });
    const payload = JSON.parse(new TextDecoder().decode((response as unknown as { body: { body: Uint8Array } }).body.body));

    expect((response as unknown as { status?: number }).status).toBe(409);
    expect(payload.code).toBe('conversation-cleared');
    expect(sendRawKeystroke).not.toHaveBeenCalled();
  });

  it('permission answer: 409 conversation-cleared, injected pane IO never called', async () => {
    const parent = makeSupersededRow('b');
    const io = { read: vi.fn(), sendKey: vi.fn() };

    const result = await handleConversationPermissionAnswer(parent.name, { choice: 'allow-once', signature: 'sig' }, { io });

    expect(result.status).toBe(409);
    expect(result.body['code']).toBe('conversation-cleared');
    expect(io.read).not.toHaveBeenCalled();
    expect(io.sendKey).not.toHaveBeenCalled();
  });

  it('pane-choice answer: 409 conversation-cleared, no keystroke sent', async () => {
    const parent = makeSupersededRow('c');
    sendRawKeystroke.mockClear();

    const result = await handleConversationPaneChoiceAnswer(parent.name, { selectedIndex: 0, signature: 'sig' });

    expect(result.status).toBe(409);
    expect(result.body['code']).toBe('conversation-cleared');
    expect(sendRawKeystroke).not.toHaveBeenCalled();
  });
});
