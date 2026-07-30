/**
 * PAN-3286 WI-3: `pan memory search --target [path]` — Subspace `target-search`
 * parity. Covers `listWorkspacesForPath` (symlink resolution, archived
 * exclusion), `searchMemory`'s target fan-out merging hits across workspaces
 * in different projects, and the CLI-level exclusivity/bare-default/
 * zero-match behavior in `memorySearchCommand`.
 */
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemoryIdentity, MemoryObservation } from '@overdeck/contracts';
import { searchMemory } from '../../../../src/lib/memory/cli.js';
import { writeObservation } from '../../../../src/lib/memory/observations.js';
import { closeDatabase } from '../../../../src/lib/database/index.js';
import { closeMemoryFtsDatabases } from '../../../../src/lib/memory/fts-db.js';
import { archiveWorkspace, createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { listWorkspacesForPath } from '../../../../src/lib/workspaces/resolver.js';
import { memorySearchCommand } from '../../../../src/cli/commands/memory.js';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';

let odb: OverdeckTestDb;
let targetDir: string;

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit unexpectedly called with ${code}`);
  }) as never);
}

function identityFor(projectId: string, workspaceId: string, issueId: string): MemoryIdentity {
  return { projectId, workspaceId, issueId, runId: 'run-1', sessionId: 'session-1', agentRole: 'work', agentHarness: 'claude-code' };
}

function observation(identity: MemoryIdentity, overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: overrides.id ?? 'obs-1',
    timestamp: overrides.timestamp ?? '2026-05-16T20:00:00.000Z',
    ...identity,
    gitBranch: 'main',
    sourceTranscriptOffset: 1,
    actionStatus: overrides.actionStatus ?? null,
    narrative: overrides.narrative ?? 'narrative',
    summary: overrides.summary ?? 'summary',
    files: overrides.files ?? [],
    tags: overrides.tags ?? [],
    tokens: { prompt: 1, completion: 1, total: 2 },
    model: 'stub-model',
  };
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  targetDir = mkdtempSync(join(tmpdir(), 'pan-3286-target-search-'));
});

afterEach(() => {
  closeMemoryFtsDatabases();
  closeDatabase();
  teardownOverdeckTestDb(odb);
  rmSync(targetDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('listWorkspacesForPath (PAN-3286 WI-3 FR-4)', () => {
  it('resolves a symlinked directory to the same workspace as its real target', async () => {
    upsertProjectFromConfig('proj-a', { name: 'Proj A', path: '/repo/proj-a' });
    const id = await createWorkspace({ projectId: 'proj-a', kind: 'scratch', name: 'scratch', path: targetDir });

    const symlinkPath = join(tmpdir(), `pan-3286-target-search-symlink-${process.pid}`);
    symlinkSync(targetDir, symlinkPath);
    try {
      const matches = listWorkspacesForPath(symlinkPath);
      expect(matches.map((w) => w.id)).toEqual([id]);
    } finally {
      rmSync(symlinkPath, { force: true });
    }
  });

  it('excludes archived workspaces by default', async () => {
    upsertProjectFromConfig('proj-a', { name: 'Proj A', path: '/repo/proj-a' });
    const id = await createWorkspace({ projectId: 'proj-a', kind: 'scratch', name: 'scratch', path: targetDir });

    expect(listWorkspacesForPath(targetDir).map((w) => w.id)).toEqual([id]);
    await archiveWorkspace(id);
    expect(listWorkspacesForPath(targetDir)).toEqual([]);
  });

  it('returns an empty array when no workspace targets the directory', () => {
    expect(listWorkspacesForPath(targetDir)).toEqual([]);
  });
});

describe('searchMemory --target fan-out (PAN-3286 WI-3 FR-4)', () => {
  it('merges rank-ordered hits from two workspaces in different projects sharing one target directory', async () => {
    upsertProjectFromConfig('proj-a', { name: 'Proj A', path: '/repo/proj-a' });
    upsertProjectFromConfig('proj-b', { name: 'Proj B', path: '/repo/proj-b' });
    const workspaceA = await createWorkspace({ projectId: 'proj-a', kind: 'issue', name: 'a-1', path: targetDir, issueId: 'A-1' });
    const workspaceB = await createWorkspace({ projectId: 'proj-b', kind: 'issue', name: 'b-1', path: targetDir, issueId: 'B-1' });

    await writeObservation(observation(identityFor('proj-a', workspaceA, 'A-1'), {
      id: 'obs-a',
      summary: 'shared-target memory result from project A',
      timestamp: '2026-05-16T20:00:00.000Z',
    }));
    await writeObservation(observation(identityFor('proj-b', workspaceB, 'B-1'), {
      id: 'obs-b',
      summary: 'shared-target memory result from project B',
      timestamp: '2026-05-16T21:00:00.000Z',
    }));

    const results = await searchMemory('shared-target', { targetPath: targetDir });

    expect(results.map((r) => r.observation.id).sort()).toEqual(['obs-a', 'obs-b']);
    expect(results.map((r) => r.observation.workspaceId).sort()).toEqual([workspaceA, workspaceB].sort());
  });

  it('returns no hits when the target directory has no workspaces', async () => {
    expect(await searchMemory('anything', { targetPath: targetDir })).toEqual([]);
  });
});

describe('memorySearchCommand --target CLI surface (PAN-3286 WI-3)', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('rejects --target combined with --workspace, --issue, or --global', async () => {
    const exitSpy = mockExit();
    await expect(memorySearchCommand('q', { target: targetDir, workspace: 'some-id' })).rejects.toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('defaults a bare --target to the current working directory', async () => {
    upsertProjectFromConfig('proj-a', { name: 'Proj A', path: '/repo/proj-a' });
    const workspaceId = await createWorkspace({ projectId: 'proj-a', kind: 'issue', name: 'a-1', path: targetDir, issueId: 'A-1' });
    await writeObservation(observation(identityFor('proj-a', workspaceId, 'A-1'), {
      id: 'obs-cwd',
      summary: 'cwd-default memory result',
    }));
    process.chdir(targetDir);
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await memorySearchCommand('cwd-default', { target: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain('A-1');
  });

  it('prints a friendly note and exits 0 when no workspace targets the directory', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await memorySearchCommand('q', { target: targetDir });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toMatch(/No workspaces target/);
    expect(printed).toContain(targetDir);
  });
});
