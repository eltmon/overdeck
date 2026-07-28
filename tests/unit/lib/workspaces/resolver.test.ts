import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

import {
  getMainWorkspace,
  getProjectByKey,
  getProjectByPath,
  getWorkspaceByName,
  getWorkspaceById,
  getWorkspaceForIssue,
  listProjects,
  listWorkspaces,
  resolveWorkspaceForCwd,
} from '../../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
});

function seedProject(id = 'proj-1', path = '/repo/overdeck') {
  upsertProjectFromConfig(id, { name: 'overdeck', path });
  return id;
}

describe('workspaces resolver', () => {
  it('getWorkspaceById and getWorkspaceByName find a created row', () => {
    const projectId = seedProject();
    const id = createWorkspace({ projectId, kind: 'scratch', name: 'notes', path: '/repo/overdeck-notes' });

    expect(getWorkspaceById(id)?.name).toBe('notes');
    expect(getWorkspaceByName(projectId, 'notes')?.id).toBe(id);
    expect(getWorkspaceById('missing')).toBeNull();
    expect(getWorkspaceByName(projectId, 'missing')).toBeNull();
  });

  it('getWorkspaceForIssue returns the non-archived kind=issue row and ignores archived ones', () => {
    const projectId = seedProject();
    const activeId = createWorkspace({
      projectId,
      kind: 'issue',
      name: 'pan-1990',
      path: '/repo/workspaces/feature-pan-1990',
      issueId: 'pan-1990',
    });

    expect(getWorkspaceForIssue('pan-1990')?.id).toBe(activeId);
    expect(getWorkspaceForIssue('pan-9999')).toBeNull();

    odb.raw().prepare(`UPDATE workspaces SET is_archived = 1 WHERE id = ?`).run(activeId);
    expect(getWorkspaceForIssue('pan-1990')).toBeNull();
  });

  it('getMainWorkspace returns null when no main workspace exists yet', () => {
    const projectId = seedProject();
    expect(getMainWorkspace(projectId)).toBeNull();
    const id = createWorkspace({ projectId, kind: 'main', name: 'main', path: '/repo/overdeck' });
    expect(getMainWorkspace(projectId)?.id).toBe(id);
  });

  it('listWorkspaces filters by projectId, kind, and archived state', () => {
    const projectA = seedProject('proj-a', '/repo/a');
    const projectB = seedProject('proj-b', '/repo/b');
    createWorkspace({ projectId: projectA, kind: 'main', name: 'main', path: '/repo/a' });
    const scratchA = createWorkspace({ projectId: projectA, kind: 'scratch', name: 'scratch', path: '/repo/a-scratch' });
    createWorkspace({ projectId: projectB, kind: 'main', name: 'main', path: '/repo/b' });

    odb.raw().prepare(`UPDATE workspaces SET is_archived = 1 WHERE id = ?`).run(scratchA);

    expect(listWorkspaces({ projectId: projectA })).toHaveLength(1); // archived scratch excluded by default
    expect(listWorkspaces({ projectId: projectA, includeArchived: true })).toHaveLength(2);
    expect(listWorkspaces({ kind: 'main' })).toHaveLength(2);
    expect(listWorkspaces()).toHaveLength(2); // both mains; archived scratch excluded
  });

  it('getProjectByKey, getProjectByPath, and listProjects resolve seeded projects', () => {
    seedProject('proj-a', '/repo/a');
    seedProject('proj-b', '/repo/b');

    expect(getProjectByKey('proj-a')?.primaryPath).toBe('/repo/a');
    expect(getProjectByKey('missing')).toBeNull();
    expect(getProjectByPath('/repo/b')?.id).toBe('proj-b');
    expect(getProjectByPath('/repo/missing')).toBeNull();
    expect(listProjects().map((p) => p.id)).toEqual(['proj-a', 'proj-b']);
  });

  it('resolveWorkspaceForCwd matches the longest workspace path prefix, not a shorter sibling', () => {
    const projectId = seedProject();
    const outer = createWorkspace({ projectId, kind: 'scratch', name: 'outer', path: '/repo/overdeck' });
    const inner = createWorkspace({
      projectId,
      kind: 'issue',
      name: 'pan-1',
      path: '/repo/overdeck/workspaces/feature-pan-1',
      issueId: 'pan-1',
    });

    expect(resolveWorkspaceForCwd('/repo/overdeck/workspaces/feature-pan-1/src')?.id).toBe(inner);
    expect(resolveWorkspaceForCwd('/repo/overdeck/some-other-dir')?.id).toBe(outer);
  });

  it('resolveWorkspaceForCwd does not prefix-match a sibling directory with a shared string prefix', () => {
    const projectId = seedProject();
    createWorkspace({ projectId, kind: 'scratch', name: 'overdeck', path: '/repo/overdeck' });

    expect(resolveWorkspaceForCwd('/repo/overdeck-other-project')).toBeNull();
  });

  it('resolveWorkspaceForCwd falls back to a project primary path and returns its main workspace', () => {
    const projectId = seedProject('proj-1', '/repo/overdeck');
    const mainId = createWorkspace({ projectId, kind: 'main', name: 'main', path: '/repo/overdeck' });

    expect(resolveWorkspaceForCwd('/repo/overdeck/some/nested/dir')?.id).toBe(mainId);
  });

  it('resolveWorkspaceForCwd returns null when nothing matches', () => {
    seedProject();
    expect(resolveWorkspaceForCwd('/completely/unrelated/path')).toBeNull();
  });
});
