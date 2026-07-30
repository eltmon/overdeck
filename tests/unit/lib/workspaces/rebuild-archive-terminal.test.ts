/**
 * PAN-3286 WI-11 (FR-14, D-13): `pan admin db rebuild-workspaces` archives —
 * never deletes — issue-kind workspace rows whose issue reached a terminal
 * stage, leaves open-issue rows alone, and mutates nothing under --dry-run.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { archiveTerminalIssueWorkspaces } from '../../../../src/lib/workspaces/rebuild.js';
import { getWorkspaceById, listWorkspaces } from '../../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { closeDatabase } from '../../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases } from '../../../../src/lib/memory/fts-db.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let workspaceDir: string;

/** Seed an issue row at a given stage, the same way the merge-queue tests do. */
function seedIssue(issueId: string, stage: string): void {
  odb.raw().prepare('INSERT INTO issues (id, stage, updated_at) VALUES (?, ?, ?)').run(issueId, stage, 1);
}

async function seedIssueWorkspace(name: string, issueId: string): Promise<string> {
  return createWorkspace({
    projectId: 'overdeck',
    kind: 'issue',
    name,
    path: join(workspaceDir, name),
    issueId,
  });
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  workspaceDir = mkdtempSync(join(tmpdir(), 'pan-3286-archive-terminal-'));
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: '/repo/overdeck' });
});

afterEach(() => {
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
  rmSync(workspaceDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('archiveTerminalIssueWorkspaces (PAN-3286 FR-14)', () => {
  it('archives terminal-issue rows and leaves open-issue rows untouched', async () => {
    const closed = await seedIssueWorkspace('feature-pan-closed', 'PAN-CLOSED');
    const merged = await seedIssueWorkspace('feature-pan-merged', 'PAN-MERGED');
    const open = await seedIssueWorkspace('feature-pan-open', 'PAN-OPEN');
    seedIssue('PAN-CLOSED', 'closed');
    seedIssue('PAN-MERGED', 'verifying_on_main');
    seedIssue('PAN-OPEN', 'in_progress');

    const result = await archiveTerminalIssueWorkspaces();

    expect(result.archived).toBe(2);
    expect(result.archivedIds.sort()).toEqual([closed, merged].sort());
    expect(getWorkspaceById(closed)?.isArchived).toBe(true);
    expect(getWorkspaceById(merged)?.isArchived).toBe(true);
    expect(getWorkspaceById(open)?.isArchived).toBe(false);
  });

  it('archives rather than deletes, so the row and its identity survive', async () => {
    const closed = await seedIssueWorkspace('feature-pan-closed', 'PAN-CLOSED');
    seedIssue('PAN-CLOSED', 'closed');

    await archiveTerminalIssueWorkspaces();

    const row = getWorkspaceById(closed);
    expect(row).not.toBeNull();
    expect(row?.name).toBe('feature-pan-closed');
    expect(row?.issueId).toBe('PAN-CLOSED');
    // Still reachable through the resolver when archived rows are requested.
    expect(listWorkspaces({ kind: 'issue', includeArchived: true }).map((w) => w.id)).toContain(closed);
  });

  it('skips an issue row whose issue has no stage recorded', async () => {
    const unknown = await seedIssueWorkspace('feature-pan-unknown', 'PAN-UNKNOWN');

    const result = await archiveTerminalIssueWorkspaces();

    expect(result.archived).toBe(0);
    expect(result.skipped).toBe(1);
    expect(getWorkspaceById(unknown)?.isArchived).toBe(false);
  });

  it('never touches main or scratch rows', async () => {
    const main = await createWorkspace({ projectId: 'overdeck', kind: 'main', name: 'main', path: workspaceDir });
    const scratch = await createWorkspace({ projectId: 'overdeck', kind: 'scratch', name: 'scratch-lens', path: workspaceDir });
    const closed = await seedIssueWorkspace('feature-pan-closed', 'PAN-CLOSED');
    seedIssue('PAN-CLOSED', 'closed');

    const result = await archiveTerminalIssueWorkspaces();

    // Only the issue row was even considered.
    expect(result.scanned).toBe(1);
    expect(result.archivedIds).toEqual([closed]);
    expect(getWorkspaceById(main)?.isArchived).toBe(false);
    expect(getWorkspaceById(scratch)?.isArchived).toBe(false);
  });

  it('reports the would-archive list under --dry-run and mutates nothing', async () => {
    const closed = await seedIssueWorkspace('feature-pan-closed', 'PAN-CLOSED');
    const open = await seedIssueWorkspace('feature-pan-open', 'PAN-OPEN');
    seedIssue('PAN-CLOSED', 'closed');
    seedIssue('PAN-OPEN', 'in_progress');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const result = await archiveTerminalIssueWorkspaces({ dryRun: true, verbose: true });

    expect(result.archived).toBe(1);
    expect(result.archivedIds).toEqual([closed]);
    expect(logSpy.mock.calls.map((call) => String(call[0])).join('\n')).toContain('would archive');
    // A subsequent registry read shows zero mutated rows.
    expect(getWorkspaceById(closed)?.isArchived).toBe(false);
    expect(getWorkspaceById(open)?.isArchived).toBe(false);
    expect(listWorkspaces({ kind: 'issue' }).map((w) => w.id).sort()).toEqual([closed, open].sort());
  });

  it('is idempotent — a second run archives nothing new', async () => {
    await seedIssueWorkspace('feature-pan-closed', 'PAN-CLOSED');
    seedIssue('PAN-CLOSED', 'closed');

    expect((await archiveTerminalIssueWorkspaces()).archived).toBe(1);
    // The row is archived now, so listWorkspaces({kind:'issue'}) no longer sees it.
    expect((await archiveTerminalIssueWorkspaces()).archived).toBe(0);
  });
});
