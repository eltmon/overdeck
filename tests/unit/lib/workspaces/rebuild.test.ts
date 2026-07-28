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

import { backfillIssueWorkspaces, seedProjectsFromYaml } from '../../../../src/lib/workspaces/rebuild.js';
import { getProjectByKey, listWorkspaces } from '../../../../src/lib/workspaces/resolver.js';
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

    createWorkspace({
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
