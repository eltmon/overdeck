/**
 * PAN-1990: closeOutIssue(), cleanupWorkspaceForIssue(), and deepWipeIssue()
 * all call the same archiveIssueWorkspaceRow() helper to archive (never
 * delete) an issue's workspace row on teardown. Full end-to-end coverage of
 * those three entry points would require mocking EventStoreService, the
 * shared issue-data service, and the dynamically-imported lifecycle module —
 * out of scope for this item. These tests instead cover the shared helper
 * directly (verified by source read to be the exact function each entry
 * point calls at its teardown-success point) plus the memory-home survival
 * guarantee the acceptance criteria require.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import { archiveIssueWorkspaceRow } from '../../../../src/lib/overdeck/workspace-hygiene.js';
import { getWorkspaceForIssue } from '../../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';

let odb: OverdeckTestDb;
let memoryHome: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  memoryHome = mkdtempSync(join(tmpdir(), 'pan-1990-memory-home-'));
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(memoryHome, { recursive: true, force: true });
});

function seedWorkspace(issueId: string): Promise<string> {
  upsertProjectFromConfig('proj-1', { name: 'overdeck', path: '/repo/overdeck' });
  return createWorkspace({
    projectId: 'proj-1',
    kind: 'issue',
    name: `feature-${issueId.toLowerCase()}`,
    path: `/repo/overdeck/workspaces/feature-${issueId.toLowerCase()}`,
    branchName: `feature/${issueId.toLowerCase()}`,
    issueId,
  });
}

function writeMemoryHomeFixture(): { path: string; content: string }[] {
  const projectDir = join(memoryHome, 'proj-1', 'ws-uuid-1');
  mkdirSync(join(projectDir, 'observations'), { recursive: true });
  const files = [
    { path: join(projectDir, 'status.json'), content: '{"lastTurn":"2026-07-28T00:00:00.000Z"}' },
    { path: join(projectDir, 'observations', '2026-07-28.jsonl'), content: '{"turn":1}\n{"turn":2}\n' },
  ];
  for (const file of files) writeFileSync(file.path, file.content, 'utf-8');
  return files;
}

describe('archiveIssueWorkspaceRow (PAN-1990)', () => {
  it('marks an existing issue workspace row is_archived=1 without deleting it', async () => {
    const id = await seedWorkspace('PAN-2000');
    expect(getWorkspaceForIssue('PAN-2000')?.isArchived).toBe(false);

    await archiveIssueWorkspaceRow('PAN-2000');

    const row = odb.raw().prepare('SELECT is_archived FROM workspaces WHERE id = ?').get(id) as { is_archived: number };
    expect(row.is_archived).toBe(1);
    // The row still exists — archived, not deleted.
    expect(odb.raw().prepare('SELECT COUNT(*) as c FROM workspaces WHERE id = ?').get(id)).toEqual({ c: 1 });
  });

  it('is a no-op for an issue with no workspace row yet (never backfilled)', async () => {
    await expect(archiveIssueWorkspaceRow('PAN-9999')).resolves.toBeUndefined();
    expect(getWorkspaceForIssue('PAN-9999')).toBeNull();
  });

  it('never touches the fixture memory-home tree — files survive byte-identical', async () => {
    await seedWorkspace('PAN-2001');
    const files = writeMemoryHomeFixture();

    await archiveIssueWorkspaceRow('PAN-2001');

    for (const file of files) {
      expect(readFileSync(file.path, 'utf-8')).toBe(file.content);
    }
  });

  it('archiving is idempotent — calling it twice leaves exactly one archived row', async () => {
    const id = await seedWorkspace('PAN-2002');
    await archiveIssueWorkspaceRow('PAN-2002');
    await archiveIssueWorkspaceRow('PAN-2002');

    const row = odb.raw().prepare('SELECT is_archived FROM workspaces WHERE id = ?').get(id) as { is_archived: number };
    expect(row.is_archived).toBe(1);
    expect(odb.raw().prepare('SELECT COUNT(*) as c FROM workspaces').get()).toEqual({ c: 1 });
  });
});
