import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

import {
  addProjectTarget,
  archiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  pinDoc,
  setWorkspaceFavorite,
  touchWorkspaceAccessed,
  unarchiveWorkspace,
  unpinDoc,
  updateWorkspaceLayout,
  upsertProjectFromConfig,
} from '../../../../src/lib/workspaces/writer.js';
import { getMainWorkspace, getWorkspaceById, listPinnedDocs, listProjectTargets, listWorkspaces } from '../../../../src/lib/workspaces/resolver.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

function seedProject(id = 'proj-1') {
  upsertProjectFromConfig(id, { name: 'overdeck', path: '/repo/overdeck' });
  return id;
}

describe('workspaces writer', () => {
  it('upsertProjectFromConfig creates then updates the same project row', () => {
    upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
    upsertProjectFromConfig('proj-1', { name: 'overdeck-renamed', path: '/repo/overdeck2' });

    const row = odb.raw().prepare(`SELECT name, primary_path FROM projects WHERE id = ?`).get('proj-1') as {
      name: string;
      primary_path: string;
    };
    expect(row.name).toBe('overdeck-renamed');
    expect(row.primary_path).toBe('/repo/overdeck2');
    expect(odb.raw().prepare(`SELECT COUNT(*) as c FROM projects`).get()).toEqual({ c: 1 });
  });

  it('createWorkspace rejects a second kind=main row for the same project', async () => {
    const projectId = seedProject();
    await createWorkspace({ projectId, kind: 'main', name: 'main', path: '/repo/overdeck' });

    await expect(
      createWorkspace({ projectId, kind: 'main', name: 'main-2', path: '/repo/overdeck' }),
    ).rejects.toThrow(/already has a main workspace/);

    expect(listWorkspaces({ projectId, kind: 'main' })).toHaveLength(1);
  });

  it('createWorkspace allows multiple scratch/issue workspaces for the same project', async () => {
    const projectId = seedProject();
    await createWorkspace({ projectId, kind: 'scratch', name: 'scratch-1', path: '/repo/overdeck-scratch-1' });
    await createWorkspace({ projectId, kind: 'scratch', name: 'scratch-2', path: '/repo/overdeck-scratch-2' });
    await createWorkspace({ projectId, kind: 'issue', name: 'pan-1', path: '/repo/workspaces/feature-pan-1', issueId: 'pan-1' });

    expect(listWorkspaces({ projectId })).toHaveLength(3);
  });

  it('touchWorkspaceAccessed, updateWorkspaceLayout, setWorkspaceFavorite, archive/unarchive round-trip', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: '/repo/overdeck-scratch' });

    touchWorkspaceAccessed(id);
    updateWorkspaceLayout(id, '{"tabs":[]}');
    setWorkspaceFavorite(id, true);
    await archiveWorkspace(id);

    let row = getWorkspaceById(id)!;
    expect(row.layoutConfig).toBe('{"tabs":[]}');
    expect(row.isFavorite).toBe(true);
    expect(row.isArchived).toBe(true);

    unarchiveWorkspace(id);
    row = getWorkspaceById(id)!;
    expect(row.isArchived).toBe(false);
  });

  it('deleteWorkspace refuses kind=main', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'main', name: 'main', path: '/repo/overdeck' });

    expect(() => deleteWorkspace(id)).toThrow(/Cannot delete the main workspace/);
    expect(getWorkspaceById(id)).not.toBeNull();
  });

  it('deleteWorkspace sets conversations.workspace_id to NULL and preserves the conversation row', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: '/repo/overdeck-scratch' });

    odb.raw().prepare(`
      INSERT INTO conversations (id, name, tmux_session, status, cwd, created_at, workspace_id)
      VALUES ('conv-id-1', 'conv-1', 'tmux-1', 'active', '/repo/overdeck-scratch', ?, ?)
    `).run(Date.now(), id);

    deleteWorkspace(id);

    expect(getWorkspaceById(id)).toBeNull();
    const conversation = odb.raw().prepare(`SELECT name, workspace_id FROM conversations WHERE name = ?`).get('conv-1') as {
      name: string;
      workspace_id: string | null;
    };
    expect(conversation).toEqual({ name: 'conv-1', workspace_id: null });
  });

  it('deleteWorkspace removes workspace-scoped pins but leaves project-scoped pins for the same id untouched', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: '/repo/overdeck-scratch' });

    await pinDoc('workspace', id, 'docs/NOTES.md');
    await pinDoc('project', projectId, 'docs/README.md');

    deleteWorkspace(id);

    expect(listPinnedDocs('workspace', id)).toHaveLength(0);
    expect(listPinnedDocs('project', projectId)).toHaveLength(1);
  });

  it('addProjectTarget with isPrimary demotes the previous primary so exactly one remains', () => {
    const projectId = seedProject();
    addProjectTarget(projectId, '/repo/overdeck', true);
    addProjectTarget(projectId, '/repo/overdeck-secondary', true);

    const targets = listProjectTargets(projectId);
    expect(targets.filter((t) => t.isPrimary)).toHaveLength(1);
    expect(targets.find((t) => t.isPrimary)?.path).toBe('/repo/overdeck-secondary');
  });

  it('pinDoc is idempotent and unpinDoc removes the pin', async () => {
    const projectId = seedProject();
    await pinDoc('project', projectId, 'docs/README.md');
    await pinDoc('project', projectId, 'docs/README.md');
    expect(listPinnedDocs('project', projectId)).toHaveLength(1);

    await unpinDoc('project', projectId, 'docs/README.md');
    expect(listPinnedDocs('project', projectId)).toHaveLength(0);
  });
});

describe('workspaces writer + resolver: main workspace lookup', () => {
  it('getMainWorkspace finds the singleton row created via createWorkspace', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'main', name: 'main', path: '/repo/overdeck' });
    expect(getMainWorkspace(projectId)?.id).toBe(id);
  });
});
