import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';
import { memoryPinCommand, memoryUnpinCommand, memoryPinsCommand } from '../../../src/cli/commands/memory.js';
import { listPinnedDocs } from '../../../src/lib/workspaces/resolver.js';
import { createWorkspace, deleteWorkspace, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';

let odb: OverdeckTestDb;
let projectRoot: string;

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-memory-pins-'));
  upsertProjectFromConfig('overdeck', { name: 'Overdeck', path: projectRoot });
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('pan memory pin/unpin (PAN-1990)', () => {
  it('pin stores a project-relative pinned_docs row; unpin deletes it (ac1)', async () => {
    await memoryPinCommand('docs/ARCHITECTURE.md', { project: 'overdeck' });

    expect(listPinnedDocs('project', 'overdeck').map((p) => p.docPath)).toEqual(['docs/ARCHITECTURE.md']);

    await memoryUnpinCommand('docs/ARCHITECTURE.md', { project: 'overdeck' });

    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('normalizes an absolute doc path to project-relative before storing', async () => {
    const absolutePath = join(projectRoot, 'docs', 'NOTES.md');
    await memoryPinCommand(absolutePath, { project: 'overdeck' });

    expect(listPinnedDocs('project', 'overdeck').map((p) => p.docPath)).toEqual(['docs/NOTES.md']);
  });

  it('pins at workspace scope when --workspace is given, resolving the owning project', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'scratch', name: 'scratch-a', path: join(projectRoot, 'scratch-a'),
    });

    await memoryPinCommand('docs/SCRATCH.md', { workspace: workspaceId });

    expect(listPinnedDocs('workspace', workspaceId).map((p) => p.docPath)).toEqual(['docs/SCRATCH.md']);
    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('exits 1 for an unregistered project key', async () => {
    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(memoryPinCommand('docs/X.md', { project: 'missing-project' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('a workspace-scoped pin is removed by deleteWorkspace while a project-scoped pin survives (ac2)', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'scratch', name: 'scratch-b', path: join(projectRoot, 'scratch-b'),
    });
    await memoryPinCommand('docs/WORKSPACE.md', { workspace: workspaceId });
    await memoryPinCommand('docs/PROJECT.md', { project: 'overdeck' });

    deleteWorkspace(workspaceId);

    expect(listPinnedDocs('workspace', workspaceId)).toHaveLength(0);
    expect(listPinnedDocs('project', 'overdeck').map((p) => p.docPath)).toEqual(['docs/PROJECT.md']);
  });

  it('pins lists pinned docs for the resolved scope', async () => {
    await memoryPinCommand('docs/A.md', { project: 'overdeck' });
    await memoryPinCommand('docs/B.md', { project: 'overdeck' });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await memoryPinsCommand({ project: 'overdeck' });
      expect(logSpy.mock.calls.flat()).toEqual(['docs/A.md', 'docs/B.md']);
    } finally {
      logSpy.mockRestore();
    }
  });
});
