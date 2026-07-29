import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

// vi.mock is hoisted — use vi.hoisted so the factory can reference this fn.
const { mockListProjects: hoistedMockListProjects } = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
}));

vi.mock('../../../../src/lib/projects.js', () => ({
  listProjectsSync: hoistedMockListProjects,
}));

import { backfillIssueWorkspaces, rebuildMainAndScratchWorkspaces, seedProjectsFromYaml } from '../../../../src/lib/workspaces/rebuild.js';
import { getProjectByKey, getWorkspaceById, listWorkspaces } from '../../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

let odb: OverdeckTestDb;
let projectRoot: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-boot-seed-'));
  hoistedMockListProjects.mockReset();
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('seedProjectsFromYaml', () => {
  it('creates one projects row per projects.yaml entry, and a second run creates zero additional rows', () => {
    hoistedMockListProjects.mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: projectRoot } },
      { key: 'other', config: { name: 'other', path: '/repo/other' } },
    ]);

    seedProjectsFromYaml();
    expect(getProjectByKey('overdeck')?.primaryPath).toBe(projectRoot);
    expect(getProjectByKey('other')?.primaryPath).toBe('/repo/other');
    const countAfterFirst = odb.raw().prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
    expect(countAfterFirst.c).toBe(2);

    seedProjectsFromYaml();
    const countAfterSecond = odb.raw().prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
    expect(countAfterSecond.c).toBe(2);
  });
});

describe('backfillIssueWorkspaces', () => {
  it('creates a kind=issue row with branch feature/<id> for every feature-* worktree dir', async () => {
    hoistedMockListProjects.mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: projectRoot } },
    ]);
    upsertProjectFromConfig('overdeck', { name: 'overdeck', path: projectRoot });

    const workspacesDir = join(projectRoot, 'workspaces');
    mkdirSync(join(workspacesDir, 'feature-pan-1990'), { recursive: true });
    mkdirSync(join(workspacesDir, 'feature-min-42'), { recursive: true });
    mkdirSync(join(workspacesDir, 'not-a-feature-dir'), { recursive: true });

    await backfillIssueWorkspaces();

    const rows = listWorkspaces({ projectId: 'overdeck', kind: 'issue' });
    expect(rows).toHaveLength(2);
    const byIssue = Object.fromEntries(rows.map((row) => [row.issueId, row]));
    expect(byIssue['PAN-1990']?.branchName).toBe('feature/pan-1990');
    expect(byIssue['MIN-42']?.branchName).toBe('feature/min-42');
  });

  it('does not create a duplicate row for an issue that already has one', async () => {
    hoistedMockListProjects.mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: projectRoot } },
    ]);
    upsertProjectFromConfig('overdeck', { name: 'overdeck', path: projectRoot });

    const workspacesDir = join(projectRoot, 'workspaces');
    mkdirSync(join(workspacesDir, 'feature-pan-1990'), { recursive: true });

    await createWorkspace({
      projectId: 'overdeck',
      kind: 'issue',
      name: 'feature-pan-1990',
      path: join(workspacesDir, 'feature-pan-1990'),
      issueId: 'PAN-1990',
    });

    await backfillIssueWorkspaces();

    expect(listWorkspaces({ projectId: 'overdeck', kind: 'issue' })).toHaveLength(1);
  });

  it('is a no-op for a project whose workspaces directory does not exist yet', async () => {
    hoistedMockListProjects.mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: projectRoot } },
    ]);
    upsertProjectFromConfig('overdeck', { name: 'overdeck', path: projectRoot });

    await expect(backfillIssueWorkspaces()).resolves.not.toThrow();
    expect(listWorkspaces({ projectId: 'overdeck' })).toHaveLength(0);
  });
});

describe('rebuildMainAndScratchWorkspaces (PAN-1990)', () => {
  beforeEach(() => {
    hoistedMockListProjects.mockReturnValue([
      { key: 'overdeck', config: { name: 'overdeck', path: projectRoot } },
    ]);
    upsertProjectFromConfig('overdeck', { name: 'overdeck', path: projectRoot });
  });

  it('recreates a main workspace row deleted from the DB from its fixture metadata.json (ac1)', async () => {
    const id = await createWorkspace({
      projectId: 'overdeck',
      kind: 'main',
      name: 'main',
      path: projectRoot,
      isGitRepository: true,
    });
    odb.raw().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    expect(getWorkspaceById(id)).toBeNull();

    const result = await rebuildMainAndScratchWorkspaces();

    expect(result.created).toBe(1);
    expect(result.createdIds).toEqual([id]);
    const row = getWorkspaceById(id);
    expect(row).toMatchObject({ id, projectId: 'overdeck', kind: 'main', name: 'main', path: projectRoot });
  });

  it('--dry-run reports planned changes and persists zero rows (ac2)', async () => {
    const id = await createWorkspace({
      projectId: 'overdeck', kind: 'scratch', name: 'notes', path: join(projectRoot, 'notes'),
    });
    odb.raw().prepare('DELETE FROM workspaces WHERE id = ?').run(id);

    const result = await rebuildMainAndScratchWorkspaces({ dryRun: true });

    expect(result.created).toBe(1);
    expect(result.createdIds).toEqual([id]);
    expect(getWorkspaceById(id)).toBeNull();
    expect(odb.raw().prepare('SELECT COUNT(*) as c FROM workspaces').get()).toEqual({ c: 0 });
  });

  it('the next (non-dry-run) run recreates a scratch row deleted from the DB (ac3)', async () => {
    const id = await createWorkspace({
      projectId: 'overdeck', kind: 'scratch', name: 'scratch-a', path: join(projectRoot, 'scratch-a'),
    });
    odb.raw().prepare('DELETE FROM workspaces WHERE id = ?').run(id);

    const dryRunResult = await rebuildMainAndScratchWorkspaces({ dryRun: true });
    expect(dryRunResult.created).toBe(1);
    expect(getWorkspaceById(id)).toBeNull(); // dry run persisted nothing

    const realResult = await rebuildMainAndScratchWorkspaces();
    expect(realResult.created).toBe(1);
    expect(getWorkspaceById(id)).toMatchObject({ id, kind: 'scratch', name: 'scratch-a' });
  });

  it('is idempotent — a second run skips rows that already exist', async () => {
    const id = await createWorkspace({
      projectId: 'overdeck', kind: 'main', name: 'main', path: projectRoot,
    });
    odb.raw().prepare('DELETE FROM workspaces WHERE id = ?').run(id);

    const first = await rebuildMainAndScratchWorkspaces();
    expect(first.created).toBe(1);

    const second = await rebuildMainAndScratchWorkspaces();
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
    expect(odb.raw().prepare('SELECT COUNT(*) as c FROM workspaces').get()).toEqual({ c: 1 });
  });

  it('does not touch issue-kind identity records (backfillIssueWorkspaces owns those)', async () => {
    const id = await createWorkspace({
      projectId: 'overdeck', kind: 'issue', name: 'feature-pan-1', path: join(projectRoot, 'workspaces', 'feature-pan-1'), issueId: 'PAN-1',
    });
    odb.raw().prepare('DELETE FROM workspaces WHERE id = ?').run(id);

    const result = await rebuildMainAndScratchWorkspaces();

    expect(result.created).toBe(0);
    expect(getWorkspaceById(id)).toBeNull();
  });
});
