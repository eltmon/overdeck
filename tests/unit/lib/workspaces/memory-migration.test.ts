import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

import {
  migrateMemoryHomesToWorkspaces,
  migrateMemoryHomesToWorkspacesOnce,
} from '../../../../src/lib/workspaces/rebuild.js';
import { getWorkspaceForIssue } from '../../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { resolveMemoryRoot } from '../../../../src/lib/memory/paths.js';
import { withMemoryFtsDatabase, closeMemoryFtsDatabases } from '../../../../src/lib/memory/fts-db.js';

let odb: OverdeckTestDb;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  upsertProjectFromConfig('overdeck', { name: 'overdeck', path: '/repo/overdeck' });
});

afterEach(() => {
  closeMemoryFtsDatabases();
  teardownOverdeckTestDb(odb);
});

async function writeLegacyIssueHome(issueId: string, observationId: string): Promise<string> {
  const legacyDir = join(resolveMemoryRoot('overdeck'), issueId);
  await mkdir(join(legacyDir, 'observations'), { recursive: true });
  const content = '{"turn":1}\n';
  await writeFile(join(legacyDir, 'observations', '2026-07-28.jsonl'), content, 'utf-8');

  await withMemoryFtsDatabase('overdeck', (db) => db.prepare(`
    INSERT INTO memory_fts (
      content, display_content, source, branch, entry_date, entry_time, entry_type,
      files, tags, doc_type, scope, project_id, workspace_id, issue_id,
      run_id, session_id, agent_role, agent_harness
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'legacy observation content', 'legacy observation content', observationId, 'feature/x',
    '2026-07-28', '10:00:00.000Z', 'memory', '', '', 'observation', 'workspace',
    'overdeck', issueId, issueId, 'run-1', 'session-1', 'work', 'claude-code',
  ));

  return legacyDir;
}

describe('migrateMemoryHomesToWorkspaces (PAN-1990)', () => {
  it('moves a fixture issue-keyed home to {projectId}/{workspaceUuid}/ and creates metadata.json (ac1)', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'issue', name: 'feature-pan-2100', path: '/repo/overdeck/workspaces/feature-pan-2100', issueId: 'PAN-2100',
    });
    await writeLegacyIssueHome('PAN-2100', 'obs-1');

    const result = await migrateMemoryHomesToWorkspaces();

    expect(result.migrated).toBe(1);
    const legacyDir = join(resolveMemoryRoot('overdeck'), 'PAN-2100');
    const newDir = join(resolveMemoryRoot('overdeck'), workspaceId);
    expect(existsSync(legacyDir)).toBe(false);
    expect(existsSync(newDir)).toBe(true);
    expect(existsSync(join(newDir, 'observations', '2026-07-28.jsonl'))).toBe(true);
    expect(readFileSync(join(newDir, 'observations', '2026-07-28.jsonl'), 'utf-8')).toBe('{"turn":1}\n');

    const metadata = JSON.parse(await readFile(join(newDir, 'metadata.json'), 'utf-8'));
    expect(metadata).toMatchObject({ id: workspaceId, projectId: 'overdeck', kind: 'issue', issueId: 'PAN-2100' });
  });

  it('memory_fts rows re-point: querying by the new workspace_id returns the migrated observation (ac2)', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'issue', name: 'feature-pan-2101', path: '/repo/overdeck/workspaces/feature-pan-2101', issueId: 'PAN-2101',
    });
    await writeLegacyIssueHome('PAN-2101', 'obs-2');

    await migrateMemoryHomesToWorkspaces();

    const rows = await withMemoryFtsDatabase('overdeck', (db) => db.prepare(`
      SELECT workspace_id, issue_id FROM memory_fts WHERE source = ?
    `).all<{ workspace_id: string; issue_id: string }>('obs-2'));
    expect(rows).toEqual([{ workspace_id: workspaceId, issue_id: 'PAN-2101' }]);

    const byNewWorkspace = await withMemoryFtsDatabase('overdeck', (db) => db.prepare(`
      SELECT source FROM memory_fts WHERE workspace_id = ?
    `).all<{ source: string }>(workspaceId));
    expect(byNewWorkspace).toEqual([{ source: 'obs-2' }]);
  });

  it('a second run respects the marker and produces zero directory or FTS changes (ac3)', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'issue', name: 'feature-pan-2102', path: '/repo/overdeck/workspaces/feature-pan-2102', issueId: 'PAN-2102',
    });
    await writeLegacyIssueHome('PAN-2102', 'obs-3');

    const first = await migrateMemoryHomesToWorkspacesOnce();
    expect(first?.migrated).toBe(1);

    const newDir = join(resolveMemoryRoot('overdeck'), workspaceId);
    const beforeMtime = readFileSync(join(newDir, 'metadata.json'), 'utf-8');

    const second = await migrateMemoryHomesToWorkspacesOnce();
    expect(second).toBeNull(); // marker respected — no-op

    expect(readFileSync(join(newDir, 'metadata.json'), 'utf-8')).toBe(beforeMtime);
    const rows = await withMemoryFtsDatabase('overdeck', (db) => db.prepare(`
      SELECT COUNT(*) as c FROM memory_fts WHERE workspace_id = ?
    `).get<{ c: number }>(workspaceId));
    expect(rows).toEqual({ c: 1 });
  });

  it('an unresolvable directory survives in place and is logged, never deleted (ac4)', async () => {
    const legacyDir = await writeLegacyIssueHome('PAN-9999', 'obs-orphan');
    expect(getWorkspaceForIssue('PAN-9999')).toBeNull();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await migrateMemoryHomesToWorkspaces();

    expect(result.migrated).toBe(0);
    expect(result.unresolvable).toEqual(['overdeck/PAN-9999']);
    expect(existsSync(legacyDir)).toBe(true);
    expect(existsSync(join(legacyDir, 'observations', '2026-07-28.jsonl'))).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('PAN-9999'));
    warnSpy.mockRestore();
  });

  it('skips a directory that already carries a metadata.json identity record', async () => {
    await createWorkspace({
      projectId: 'overdeck', kind: 'issue', name: 'feature-pan-2103', path: '/repo/overdeck/workspaces/feature-pan-2103', issueId: 'PAN-2103',
    });
    const legacyDir = await writeLegacyIssueHome('PAN-2103', 'obs-4');
    // Simulate a partial prior migration: metadata.json already written at the old path.
    await writeFile(join(legacyDir, 'metadata.json'), JSON.stringify({ id: 'stale' }), 'utf-8');

    const result = await migrateMemoryHomesToWorkspaces();

    expect(result.migrated).toBe(0);
    expect(result.skippedAlreadyMigrated).toBe(1);
    expect(existsSync(legacyDir)).toBe(true);
  });
});
