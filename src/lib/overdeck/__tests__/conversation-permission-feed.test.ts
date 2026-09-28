/**
 * PAN-4278: pendingPermission on the conversation pending-input feed and the
 * single conversation read — the pane decides `answerable`, the hook registry
 * names the agent.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_HOME = mkdtempSync(join(tmpdir(), 'pan-4278-conv-permission-feed-'));
process.env.OVERDECK_HOME = TEST_HOME;

const paneRead = vi.hoisted(() => vi.fn<(lines: number) => Promise<string>>());
const paneChoice = vi.hoisted(() => vi.fn());
vi.mock('../../../dashboard/server/event-store.js', () => ({
  getEventStore: vi.fn(() => ({ emitOnly: vi.fn() })),
}));
vi.mock('../../terminal-backends/agent-pane-io.js', () => ({
  resolveAgentPaneIo: vi.fn(async () => ({ backend: 'tmux', read: paneRead, sendKey: vi.fn() })),
}));
vi.mock('../conversation-pane-choice.js', () => ({ claudeConversationPaneChoice: paneChoice }));
vi.mock('../conversation-input-target.js', () => ({ readConversationInputTarget: vi.fn(async () => undefined) }));

const { createConversation, getConversationByName } = await import('../conversations.js');
const { closeOverdeckDatabase } = await import('../infra.js');
const { conversationPendingPermission } = await import('../conversation-permission.js');
const { recordPermissionRequest, resetPermissionRegistryForTests } = await import('../conversation-permission-registry.js');
const { getConversationRead, getConversationsPendingInputFeed } = await import('../conversation-reads.js');

function fixture(name: string): string {
  return readFileSync(new URL(`../../agents/__fixtures__/claude-code-2.1.280/${name}`, import.meta.url), 'utf8');
}

const NOW = '2026-09-27T16:00:00.000Z';
const deps = (pane: string) => ({ read: async () => pane, now: () => NOW });

function entry(agentKey: string, extra: Partial<Parameters<typeof recordPermissionRequest>[1]> = {}) {
  return {
    agentKey,
    agentId: agentKey === 'main' ? null : agentKey,
    agentType: agentKey === 'main' ? null : 'general-purpose',
    agentDescription: null,
    toolName: 'Bash',
    toolInputPreview: 'Q=$(pwd)/queue; rm -f "$Q"/*',
    requestedAt: '2026-09-27T15:32:21.000Z',
    ...extra,
  };
}

createConversation({ name: 'perm-feed', tmuxSession: 'conv-perm-feed', cwd: TEST_HOME, title: 'Perm feed' });
createConversation({ name: 'perm-codex', tmuxSession: 'conv-perm-codex', cwd: TEST_HOME, title: 'Codex', harness: 'codex' });
const conv = getConversationByName('perm-feed')!;

beforeEach(() => {
  resetPermissionRegistryForTests();
  paneRead.mockReset();
  paneChoice.mockReset();
  paneChoice.mockResolvedValue(null);
});

afterAll(() => {
  closeOverdeckDatabase();
  delete process.env.OVERDECK_HOME;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('conversationPendingPermission', () => {
  it('answerable row when the Herdr pane shows the prompt', async () => {
    const pending = await conversationPendingPermission(conv, deps(fixture('permission-bash.txt')));
    expect(pending).toMatchObject({
      answerable: true,
      agentLabel: 'Main agent',
      agentKey: 'main',
      toolName: 'Bash command',
      header: 'Bash command',
      detailLines: ['touch /tmp/pan4278-probe-marker.txt', 'Create marker file for PAN-4278 probe'],
      reason: null,
      options: [
        { choice: 'allow-once', label: 'Yes' },
        { choice: 'allow-always', label: 'Yes, and always allow access to /tmp from this project' },
        { choice: 'deny', label: 'No' },
      ],
      since: NOW,
    });
    expect(pending!.signature).toBeTruthy();
  });

  it('non-answerable row when only the registry has an entry', async () => {
    recordPermissionRequest('perm-feed', entry('main', { toolInputPreview: 'npm install' }));
    const pending = await conversationPendingPermission(conv, deps(fixture('permission-answered.txt')));
    expect(pending).toEqual({
      signature: null,
      answerable: false,
      agentLabel: 'Main agent',
      agentKey: 'main',
      toolName: 'Bash',
      header: null,
      detailLines: ['npm install'],
      reason: null,
      options: [],
      since: '2026-09-27T15:32:21.000Z',
    });
  });

  it('subagent label from the registry', async () => {
    recordPermissionRequest('perm-feed', entry('a9ef', { agentDescription: 'Research Orca onboarding flow' }));
    const pending = await conversationPendingPermission(conv, deps(fixture('permission-subagent.txt')));
    expect(pending).toMatchObject({
      answerable: true,
      agentLabel: 'Subagent: Research Orca onboarding flow',
      agentKey: 'a9ef',
      toolName: 'Bash',
      since: '2026-09-27T15:32:21.000Z',
    });
    expect(pending!.reason).toMatch(/^Dangerous rm operation/);
  });

  it('Unknown agent when two entries and no preview match', async () => {
    recordPermissionRequest('perm-feed', entry('s1', { agentDescription: 'One', toolInputPreview: 'ls' }));
    recordPermissionRequest('perm-feed', entry('s2', { agentDescription: 'Two', toolInputPreview: 'whoami' }));
    const pending = await conversationPendingPermission(conv, deps(fixture('permission-subagent.txt')));
    expect(pending).toMatchObject({ agentLabel: 'Unknown agent', agentKey: null, toolName: 'Bash command', since: NOW });
  });

  it('labels from the prompt title when the registry is empty (after a restart)', async () => {
    const pending = await conversationPendingPermission(conv, deps(fixture('permission-subagent.txt')));
    expect(pending).toMatchObject({ agentLabel: 'Subagent: general-purpose', agentKey: null, answerable: true });
  });

  it('picks the subagent whose preview appears in the prompt', async () => {
    recordPermissionRequest('perm-feed', entry('s1', { agentDescription: 'One', toolInputPreview: 'ls' }));
    recordPermissionRequest('perm-feed', entry('s2', { agentDescription: 'Two' }));
    const pending = await conversationPendingPermission(conv, deps(fixture('permission-subagent.txt')));
    expect(pending).toMatchObject({ agentLabel: 'Subagent: Two', agentKey: 's2' });
  });

  it('Unknown agent when a subagent entry carries no name', async () => {
    recordPermissionRequest('perm-feed', entry('main', { agentKey: 'x', agentId: null, agentType: null }));
    const pending = await conversationPendingPermission(conv, deps(''));
    expect(pending).toMatchObject({ answerable: false, agentLabel: 'Unknown agent' });
  });

  it('null for a codex conversation', async () => {
    recordPermissionRequest('perm-codex', entry('main'));
    const read = vi.fn(async () => fixture('permission-bash.txt'));
    expect(await conversationPendingPermission(getConversationByName('perm-codex')!, { read })).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('null when the pane read throws and the registry is empty', async () => {
    const pending = await conversationPendingPermission(conv, { read: async () => { throw new Error('gone'); } });
    expect(pending).toBeNull();
  });
});

describe('pending-input feed and conversation read', () => {
  const feedDeps = { resolveSessionFile: async () => null, listSessionNames: async () => ['conv-perm-feed'] };

  it('feed skips pane-choice when a permission is pending', async () => {
    paneRead.mockResolvedValue(fixture('permission-bash.txt'));
    const rows = (await getConversationsPendingInputFeed(feedDeps)).body as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'perm-feed', pendingPermission: { answerable: true, header: 'Bash command' } });
    expect(paneChoice).not.toHaveBeenCalled();
  });

  it('feed row carries a non-answerable pendingPermission for a registry-only entry', async () => {
    recordPermissionRequest('perm-feed', entry('main', { toolInputPreview: 'npm install' }));
    paneRead.mockResolvedValue(fixture('permission-answered.txt'));
    const rows = (await getConversationsPendingInputFeed(feedDeps)).body as Array<Record<string, unknown>>;
    expect(rows).toEqual([expect.objectContaining({
      name: 'perm-feed',
      pendingPermission: expect.objectContaining({ answerable: false, signature: null, agentLabel: 'Main agent' }),
    })]);
  });

  it('feed shares the tmux pane read with the pane-choice check', async () => {
    const screen = fixture('permission-answered.txt');
    paneRead.mockResolvedValue(screen);
    const rows = (await getConversationsPendingInputFeed(feedDeps)).body as Array<Record<string, unknown>>;
    expect(rows).toEqual([]);
    expect(paneRead).toHaveBeenCalledTimes(1);
    const capture = paneChoice.mock.calls[0]![1].capture as () => Promise<string>;
    expect(await capture()).toBe(screen);
  });

  it('conversation read lists permissionRequest and returns pendingPermission', async () => {
    paneRead.mockResolvedValue(fixture('permission-dangerous-rm.txt'));
    const body = (await getConversationRead('perm-feed', {
      resolveSessionFile: async () => null,
      tmuxSessionExists: async () => true,
    })).body as Record<string, unknown>;
    expect(body.pendingInputKinds).toEqual(['permissionRequest']);
    expect(body.pendingInputCount).toBe(1);
    expect(body.pendingPermission).toMatchObject({ answerable: true, reason: expect.stringMatching(/^Dangerous/) });
    expect(paneChoice).not.toHaveBeenCalled();
  });
});
