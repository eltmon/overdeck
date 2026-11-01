/**
 * PAN-4650 WI-5: a released conversation refuses every write door with 409
 * conversation-released before reaching the terminal backend; undoing the
 * release lets resume proceed; a vault browse row keeps its own refusal.
 */
import { HttpServerResponse } from 'effect/unstable/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/dashboard/server/event-store.js', () => ({ getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })) }));
vi.mock('../../../../src/lib/overdeck/conversation-liveness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/overdeck/conversation-liveness.js')>()),
  listLiveConversationSessions: vi.fn(async () => new Set<string>()),
  conversationHarnessAlive: vi.fn(async () => true),
}));
vi.mock('../../../../src/lib/tmux.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/tmux.js')>()),
  sendKeysAsync: vi.fn(async () => undefined),
  sendRawKeystroke: vi.fn(async () => undefined),
}));
vi.mock('../../../../src/lib/agents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/lib/agents.js')>()),
  deliverAgentMessage: vi.fn(async () => ({ ok: true })),
}));

const { setupOverdeckTestDb, teardownOverdeckTestDb } = await import('../../../helpers/overdeck-test-db.js');
const { createConversation, getConversationByName } = await import('../../../../src/lib/overdeck/conversations.js');
const { clearConversationRelease, markConversationReleased } = await import('../../../../src/lib/overdeck/conversation-release.js');
const { upsertVaultBrowseRow } = await import('../../../../src/lib/overdeck/conversation-vault-rows.js');
const { handleConversationMessage } = await import('../../../../src/lib/overdeck/conversation-message.js');
const { handleConversationResume, handleConversationSwitchModel } = await import('../../../../src/lib/overdeck/conversation-runtime.js');
const { handleConversationCompact, handleConversationPlanAction } = await import('../../../../src/lib/overdeck/conversation-delivery.js');
const { startHeldKickoff } = await import('../../../../src/lib/overdeck/conversation-kickoff.js');
const { conversationHarnessAlive } = await import('../../../../src/lib/overdeck/conversation-liveness.js');
const tmux = await import('../../../../src/lib/tmux.js');
const agents = await import('../../../../src/lib/agents.js');

type OverdeckTestDb = import('../../../helpers/overdeck-test-db.js').OverdeckTestDb;

async function read(response: HttpServerResponse.HttpServerResponse): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: JSON.parse(await HttpServerResponse.toWeb(response).text()) as Record<string, unknown> };
}

const RELEASED = {
  error: 'Continued on 6f1c0000; this copy is read-only',
  code: 'conversation-released',
  releasedTo: '6f1c0000-0000-4000-8000-000000000001',
};

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  vi.clearAllMocks();
  createConversation({ name: 'conv-desk', tmuxSession: 'conv-conv-desk', cwd: '/tmp', harness: 'pi' });
  markConversationReleased('conv-desk', RELEASED.releasedTo);
}, 15_000);

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('released conversations (PAN-4650 WI-5)', () => {
  it('mark and clear write released_to', () => {
    expect(getConversationByName('conv-desk')?.releasedTo).toBe(RELEASED.releasedTo);
    clearConversationRelease('conv-desk');
    expect(getConversationByName('conv-desk')?.releasedTo).toBeNull();
  });

  it('refuses message, resume, switch-model, compact and plan-action with 409 before the terminal backend', async () => {
    const responses = await Promise.all([
      handleConversationMessage('conv-desk', { message: 'hi' }),
      handleConversationResume('conv-desk', {}, { resolveSessionFile: async () => null }),
      handleConversationSwitchModel('conv-desk', { model: 'claude-opus-5-5' }),
      handleConversationCompact('conv-desk'),
      handleConversationPlanAction('conv-desk', { action: 'approve' }),
    ]);
    for (const response of responses) {
      expect(await read(response)).toEqual({ status: 409, body: RELEASED });
    }
    expect(conversationHarnessAlive).not.toHaveBeenCalled();
    expect(tmux.sendKeysAsync).not.toHaveBeenCalled();
    expect(tmux.sendRawKeystroke).not.toHaveBeenCalled();
    expect(agents.deliverAgentMessage).not.toHaveBeenCalled();
  });

  it('refuses the held kickoff', async () => {
    expect(await startHeldKickoff('conv-desk')).toEqual({ status: 'refused', ...RELEASED });
  });

  it('resume proceeds after the release is undone', async () => {
    clearConversationRelease('conv-desk');
    const { status, body } = await read(await handleConversationResume('conv-desk', {}, { resolveSessionFile: async () => null }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: 'conv-desk', reattached: true });
    expect(conversationHarnessAlive).toHaveBeenCalledTimes(1);
  });

  it('a vault browse row still answers vault-browse-copy', async () => {
    const vaultId = '00000000-0000-4000-8000-000000000042';
    upsertVaultBrowseRow({
      vaultId, title: 'saved', harness: 'claude-code', ownerLabel: 'laptop', cwd: '/tmp', model: null,
      createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T11:00:00.000Z',
    });
    const { status, body } = await read(await handleConversationSwitchModel(`vault-${vaultId}`, { model: 'x' }));
    expect(status).toBe(409);
    expect(body).toMatchObject({ code: 'vault-browse-copy' });
  });
});
