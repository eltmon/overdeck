import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

/** Pin creation now requires a real regular file (symlink-safe containment) — write one under projectRoot. */
function writeDoc(relativePath: string): void {
  const fullPath = join(projectRoot, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, '# doc\n', 'utf8');
}

describe('pan memory pin/unpin (PAN-1990)', () => {
  it('pin stores a project-relative pinned_docs row; unpin deletes it (ac1)', async () => {
    writeDoc('docs/ARCHITECTURE.md');
    await memoryPinCommand('docs/ARCHITECTURE.md', { project: 'overdeck' });

    expect(listPinnedDocs('project', 'overdeck').map((p) => p.docPath)).toEqual(['docs/ARCHITECTURE.md']);

    await memoryUnpinCommand('docs/ARCHITECTURE.md', { project: 'overdeck' });

    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('normalizes an absolute doc path to project-relative before storing', async () => {
    writeDoc('docs/NOTES.md');
    const absolutePath = join(projectRoot, 'docs', 'NOTES.md');
    await memoryPinCommand(absolutePath, { project: 'overdeck' });

    expect(listPinnedDocs('project', 'overdeck').map((p) => p.docPath)).toEqual(['docs/NOTES.md']);
  });

  it('pins at workspace scope when --workspace is given, resolving the owning project', async () => {
    const workspaceId = await createWorkspace({
      projectId: 'overdeck', kind: 'scratch', name: 'scratch-a', path: join(projectRoot, 'scratch-a'),
    });

    writeDoc('docs/SCRATCH.md');
    await memoryPinCommand('docs/SCRATCH.md', { workspace: workspaceId });

    expect(listPinnedDocs('workspace', workspaceId).map((p) => p.docPath)).toEqual(['docs/SCRATCH.md']);
    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('refuses to pin an absolute path outside the project root (security)', async () => {
    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(memoryPinCommand('/etc/passwd', { project: 'overdeck' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }
    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('refuses to pin a relative path that traverses outside the project root (security)', async () => {
    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(memoryPinCommand('../../../../etc/passwd', { project: 'overdeck' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }
    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('refuses to pin an in-project symlink whose real target is outside the project root (security, cycle 2)', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'pan-1990-outside-'));
    const outsideFile = join(outsideDir, 'secret.txt');
    writeFileSync(outsideFile, 'not for the model\n', 'utf8');
    mkdirSync(join(projectRoot, 'docs'), { recursive: true });
    symlinkSync(outsideFile, join(projectRoot, 'docs', 'private.md'));

    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(memoryPinCommand('docs/private.md', { project: 'overdeck' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
      rmSync(outsideDir, { recursive: true, force: true });
    }
    expect(listPinnedDocs('project', 'overdeck')).toHaveLength(0);
  });

  it('refuses to pin a path that does not exist as a real file', async () => {
    const exitError = new Error('process exited');
    vi.spyOn(process, 'exit').mockImplementation(() => { throw exitError; });

    try {
      await expect(memoryPinCommand('docs/does-not-exist.md', { project: 'overdeck' })).rejects.toThrow(exitError);
    } finally {
      vi.restoreAllMocks();
    }
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
    writeDoc('docs/WORKSPACE.md');
    writeDoc('docs/PROJECT.md');
    await memoryPinCommand('docs/WORKSPACE.md', { workspace: workspaceId });
    await memoryPinCommand('docs/PROJECT.md', { project: 'overdeck' });

    await deleteWorkspace(workspaceId);

    expect(listPinnedDocs('workspace', workspaceId)).toHaveLength(0);
    expect(listPinnedDocs('project', 'overdeck').map((p) => p.docPath)).toEqual(['docs/PROJECT.md']);
  });

  it('pins lists pinned docs for the resolved scope', async () => {
    writeDoc('docs/A.md');
    writeDoc('docs/B.md');
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
