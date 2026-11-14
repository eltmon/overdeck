/**
 * PAN-5233 (FR-10, D-7): `pan admin db rebuild-workspaces` archives — never
 * deletes — issue-kind workspace rows whose worktree directory is gone,
 * skipping rows too young to have finished `git worktree add` yet, and
 * mutates nothing under --dry-run.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveDeadIssueWorkspaces } from '../../../../src/lib/workspaces/rebuild.js';
import { archiveWorkspace, createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { getWorkspaceById } from '../../../../src/lib/workspaces/resolver.js';
import { closeMemoryFtsDatabases } from '../../../../src/lib/memory/fts-db.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let workspaceDir: string;
const NOW = 1_700_000_000_000;

async function seedIssueWorkspace(name: string, issueId: string, createdAt: number, makeDir: boolean): Promise<string> {
  const path = join(workspaceDir, name);
  if (makeDir) mkdirSync(path, { recursive: true });
  return createWorkspace({ projectId: 'overdeck', kind: 'issue', name, path, issueId, createdAt });
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  workspaceDir = mkdtempSync(join(tmpdir(), 'pan-5233-archive-dead-'));
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
});

afterEach(() => {
  closeMemoryFtsDatabases();
  teardownOverdeckTestDb(odb);
  rmSync(workspaceDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('archiveDeadIssueWorkspaces (PAN-5233 FR-10)', () => {
  it('keeps a row whose directory exists', async () => {
    const alive = await seedIssueWorkspace('feature-pan-alive', 'PAN-ALIVE', NOW - 20 * 60 * 1000, true);

    const result = await archiveDeadIssueWorkspaces({ now: NOW });

    expect(result.archived).toBe(0);
    expect(result.skipped).toBe(1);
    expect(getWorkspaceById(alive)?.isArchived).toBe(false);
  });

  it('archives a row whose directory is missing', async () => {
    const dead = await seedIssueWorkspace('feature-pan-dead', 'PAN-DEAD', NOW - 20 * 60 * 1000, false);

    const result = await archiveDeadIssueWorkspaces({ now: NOW });

    expect(result.archived).toBe(1);
    expect(result.archivedIds).toEqual([dead]);
    expect(getWorkspaceById(dead)?.isArchived).toBe(true);
  });

  it('skips a missing-directory row created less than 10 minutes before now', async () => {
    const young = await seedIssueWorkspace('feature-pan-young', 'PAN-YOUNG', NOW - 5 * 60 * 1000, false);

    const result = await archiveDeadIssueWorkspaces({ now: NOW });

    expect(result.archived).toBe(0);
    expect(result.skipped).toBe(1);
    expect(getWorkspaceById(young)?.isArchived).toBe(false);
  });

  it('reports archived under --dry-run and leaves isArchived false', async () => {
    const dead = await seedIssueWorkspace('feature-pan-dead', 'PAN-DEAD', NOW - 20 * 60 * 1000, false);

    const result = await archiveDeadIssueWorkspaces({ now: NOW, dryRun: true });

    expect(result.archived).toBe(1);
    expect(result.archivedIds).toEqual([dead]);
    expect(getWorkspaceById(dead)?.isArchived).toBe(false);
  });

  it('does not re-scan an already-archived row', async () => {
    const dead = await seedIssueWorkspace('feature-pan-dead', 'PAN-DEAD', NOW - 20 * 60 * 1000, false);
    await archiveWorkspace(dead);

    const result = await archiveDeadIssueWorkspaces({ now: NOW });

    expect(result.scanned).toBe(0);
    expect(result.archived).toBe(0);
  });
});
