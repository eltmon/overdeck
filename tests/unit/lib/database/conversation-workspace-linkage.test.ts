/**
 * PAN-1990: conversations carry workspace_id, resolved from cwd when not
 * given explicitly. Implementation lives in src/lib/overdeck/conversations.ts
 * (the real overdeck.db door — src/lib/database/conversations-db.ts has zero
 * production consumers left and is not the live path; verified via
 * `git grep -rl "from.*conversations-db"` outside tests).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import { createConversation, getConversationByName } from '../../../../src/lib/overdeck/conversations.js';
import { createWorkspace, deleteWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

describe('conversation <-> workspace linkage (PAN-1990)', () => {
  it('persists an explicitly-provided workspaceId', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'proj-1', kind: 'scratch', name: 'scratch', path: '/repo/overdeck-scratch',
    });

    createConversation({ name: 'conv-explicit', tmuxSession: 'tmux-1', cwd: '/unrelated/path', workspaceId });

    expect(getConversationByName('conv-explicit')?.workspaceId).toBe(workspaceId);
  });

  it('resolves workspace_id from cwd via resolveWorkspaceForCwd when not given explicitly', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'proj-1', kind: 'issue', name: 'pan-1990', path: '/repo/overdeck/workspaces/feature-pan-1990', issueId: 'PAN-1990',
    });

    createConversation({
      name: 'conv-cwd-resolved',
      tmuxSession: 'tmux-2',
      cwd: '/repo/overdeck/workspaces/feature-pan-1990/src',
    });

    expect(getConversationByName('conv-cwd-resolved')?.workspaceId).toBe(workspaceId);
  });

  it('leaves workspace_id null when cwd matches nothing', async () => {
    createConversation({ name: 'conv-no-match', tmuxSession: 'tmux-3', cwd: '/nowhere/relevant' });
    expect(getConversationByName('conv-no-match')?.workspaceId).toBeNull();
  });

  it('an explicit workspaceId: null opts out of cwd resolution', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    await createWorkspace({ projectId: 'proj-1', kind: 'main', name: 'main', path: '/repo/overdeck' });

    createConversation({ name: 'conv-opt-out', tmuxSession: 'tmux-4', cwd: '/repo/overdeck', workspaceId: null });

    expect(getConversationByName('conv-opt-out')?.workspaceId).toBeNull();
  });

  it('after deleteWorkspace, the conversation row survives with workspace_id NULL', async () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    const workspaceId = await createWorkspace({
      projectId: 'proj-1', kind: 'scratch', name: 'scratch', path: '/repo/overdeck-scratch',
    });
    createConversation({ name: 'conv-survives', tmuxSession: 'tmux-5', cwd: '/repo/overdeck-scratch', workspaceId });
    expect(getConversationByName('conv-survives')?.workspaceId).toBe(workspaceId);

    await deleteWorkspace(workspaceId);

    const conv = getConversationByName('conv-survives');
    expect(conv).not.toBeNull();
    expect(conv?.workspaceId).toBeNull();
    expect(conv?.name).toBe('conv-survives');
  });
});
