/**
 * PAN-4596: the pending-input feed lists every unarchived, non-superseded
 * held handoff, alive or ended, with heldKickoff: { since, focus? }.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listConversations, listHeldKickoffNames, readConversationPermission } = vi.hoisted(() => ({
  listConversations: vi.fn(),
  listHeldKickoffNames: vi.fn<() => Set<string>>(),
  readConversationPermission: vi.fn(),
}));
vi.mock('../conversations.js', () => ({ listConversations }));
vi.mock('../conversation-kickoff-store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../conversation-kickoff-store.js')>()),
  listHeldKickoffNames,
}));
vi.mock('../conversation-delivery.js', () => ({ codexConversationPendingInput: async () => ({}) }));
vi.mock('../conversation-pane-choice.js', () => ({ claudeConversationPaneChoice: async () => null }));
vi.mock('../conversation-permission.js', () => ({
  readConversationPermission,
  conversationPendingPermission: async () => null,
}));

import { getConversationsPendingInputFeed } from '../conversation-reads.js';

const PERMISSION = {
  signature: 'sig', answerable: true, agentLabel: 'Main agent', agentKey: null,
  toolName: 'Bash', header: null, clipped: false,
};

function row(partial: Record<string, unknown> & { name: string; tmuxSession: string }) {
  return {
    forkStatus: null, clearedToConvId: null, harness: 'claude-code', title: null, issueId: null,
    forkRequest: null, createdAt: '2026-10-04T13:19:27.000Z', ...partial,
  };
}

async function feed(liveSessions: string[], resolveSessionFile = vi.fn().mockResolvedValue(null)) {
  const response = await getConversationsPendingInputFeed({ resolveSessionFile, listSessionNames: async () => liveSessions });
  return { rows: response.body as Array<Record<string, unknown>>, resolveSessionFile };
}

describe('getConversationsPendingInputFeed held kickoffs (PAN-4596)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readConversationPermission.mockResolvedValue({ pendingPermission: null, tmuxPaneText: null });
  });

  it('lists an ended held conversation with since and focus, without scanning it', async () => {
    listConversations.mockReturnValue([
      row({
        name: 'held-ended', tmuxSession: 'conv-held-ended', title: 'Bundle', issueId: 'PAN-1',
        forkRequest: JSON.stringify({ hold: true, handoffFocus: '  Read the brief  ' }),
      }),
    ]);
    listHeldKickoffNames.mockReturnValue(new Set(['held-ended']));

    const { rows, resolveSessionFile } = await feed([]);

    expect(resolveSessionFile).not.toHaveBeenCalled();
    expect(rows).toEqual([{
      name: 'held-ended', title: 'Bundle', issueId: 'PAN-1', harness: 'claude-code',
      heldKickoff: { since: '2026-10-04T13:19:27.000Z', focus: 'Read the brief' },
    }]);
  });

  it('a live held conversation with a pending permission keeps it and gains heldKickoff', async () => {
    listConversations.mockReturnValue([row({ name: 'held-live', tmuxSession: 'conv-held-live' })]);
    listHeldKickoffNames.mockReturnValue(new Set(['held-live']));
    readConversationPermission.mockResolvedValue({ pendingPermission: PERMISSION, tmuxPaneText: null });

    const { rows } = await feed(['conv-held-live']);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'held-live',
      pendingPermission: PERMISSION,
      heldKickoff: { since: '2026-10-04T13:19:27.000Z' },
    });
    expect(rows[0]?.heldKickoff).not.toHaveProperty('focus');
  });

  it('omits a superseded held row and a non-held ended row', async () => {
    listConversations.mockReturnValue([
      row({ name: 'held-superseded', tmuxSession: 'conv-held-s', clearedToConvId: 7 }),
      row({ name: 'not-held', tmuxSession: 'conv-not-held' }),
    ]);
    listHeldKickoffNames.mockReturnValue(new Set(['held-superseded']));

    const { rows } = await feed([]);

    expect(rows).toEqual([]);
  });

  it('never sets pendingInputKinds on any row', async () => {
    listConversations.mockReturnValue([
      row({ name: 'held-ended', tmuxSession: 'conv-held-ended' }),
      row({ name: 'held-live', tmuxSession: 'conv-held-live' }),
    ]);
    listHeldKickoffNames.mockReturnValue(new Set(['held-ended', 'held-live']));
    readConversationPermission.mockResolvedValue({ pendingPermission: PERMISSION, tmuxPaneText: null });

    const { rows } = await feed(['conv-held-live']);

    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).not.toHaveProperty('pendingInputKinds');
  });
});
