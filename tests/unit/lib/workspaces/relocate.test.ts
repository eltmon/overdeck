/**
 * PAN-3286 WI-2: `relocateWorkspace` writer + `pan workspace relocate` /
 * `pan workspace get` CLI surface (Subspace `workspaces update --relocate`
 * parity). Covers the writer's guard rules (kind=issue refused, archived
 * refused, kind=main requires --force) plus the memory-home metadata.json
 * rewrite, and the CLI-level divergence warning and `memoryHome` line.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import { archiveWorkspace, createWorkspace, relocateWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import { getWorkspaceById } from '../../../../src/lib/workspaces/resolver.js';
import { resolveWorkspaceIdentityPath } from '../../../../src/lib/memory/identity-record.js';
import { resolveWorkspaceMemoryRoot } from '../../../../src/lib/memory/paths.js';
import { workspaceRelocateCommand } from '../../../../src/cli/commands/workspace-scratch.js';
import { workspaceGetCommand } from '../../../../src/cli/commands/workspace-lifecycle.js';

let odb: OverdeckTestDb;
let oldDir: string;
let newDir: string;

function seedProject(id = 'proj-relocate') {
  upsertProjectFromConfig(id, { name: 'overdeck', path: '/repo/overdeck' });
  return id;
}

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit unexpectedly called with ${code}`);
  }) as never);
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  oldDir = mkdtempSync(join(tmpdir(), 'pan-3286-relocate-old-'));
  newDir = mkdtempSync(join(tmpdir(), 'pan-3286-relocate-new-'));
});

afterEach(() => {
  teardownOverdeckTestDb(odb);
  rmSync(oldDir, { recursive: true, force: true });
  rmSync(newDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('relocateWorkspace writer (PAN-3286 WI-2)', () => {
  it('updates the path column, refreshes is_git_repository, rewrites memory-home metadata.json, and touches last_accessed_at', async () => {
    const projectId = seedProject();
    mkdirSync(join(newDir, '.git'));
    // The writer stamps last_accessed_at from Date.now(), so the clock has to
    // move between create and relocate. Drive it with fake timers rather than a
    // real sleep — NFR-3 and the repository timer rule forbid wall-clock waits,
    // and this also makes the assertion deterministic instead of relying on a
    // 2ms delay actually crossing a millisecond boundary. shouldAdvanceTime keeps
    // any internal timer in the fs/writer path progressing.
    let id: string;
    let before: NonNullable<ReturnType<typeof getWorkspaceById>>;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-07-30T00:00:00.000Z'));
      id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: oldDir });
      before = getWorkspaceById(id)!;

      vi.setSystemTime(new Date('2026-07-30T00:00:01.000Z'));
      await relocateWorkspace(id, newDir);
    } finally {
      vi.useRealTimers();
    }

    const after = getWorkspaceById(id)!;
    expect(after.path).toBe(newDir);
    expect(after.isGitRepository).toBe(true);
    expect(after.lastAccessedAt).toBeGreaterThan(before.lastAccessedAt);

    const identityPath = resolveWorkspaceIdentityPath(projectId, id);
    const identity = JSON.parse(await readFile(identityPath, 'utf-8'));
    expect(identity.path).toBe(newDir);
    // The memory home itself is keyed by workspace id, not path — relocation never moves it,
    // so the identity file still lives under the pre-relocation memory-root path.
    expect(identityPath.startsWith(resolveWorkspaceMemoryRoot(projectId, id))).toBe(true);
  });

  it('reflects is_git_repository=false when the new path has no .git', async () => {
    const projectId = seedProject();
    mkdirSync(join(oldDir, '.git'));
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: oldDir, isGitRepository: true });

    await relocateWorkspace(id, newDir);

    expect(getWorkspaceById(id)!.isGitRepository).toBe(false);
  });

  it('refuses an issue-kind workspace', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'issue', name: 'pan-1', path: oldDir, issueId: 'pan-1' });

    await expect(relocateWorkspace(id, newDir)).rejects.toThrow(/issue-kind workspace/);
    expect(getWorkspaceById(id)!.path).toBe(oldDir);
  });

  it('refuses an archived workspace', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: oldDir });
    await archiveWorkspace(id);

    await expect(relocateWorkspace(id, newDir)).rejects.toThrow(/archived workspace/);
    expect(getWorkspaceById(id)!.path).toBe(oldDir);
  });

  it('refuses kind=main without --force and succeeds with --force', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'main', name: 'main', path: oldDir });

    await expect(relocateWorkspace(id, newDir)).rejects.toThrow(/diverges it from projects\.yaml/);
    expect(getWorkspaceById(id)!.path).toBe(oldDir);

    await relocateWorkspace(id, newDir, { force: true });
    expect(getWorkspaceById(id)!.path).toBe(newDir);
  });

  it('throws for an unknown workspace id', async () => {
    await expect(relocateWorkspace('does-not-exist', newDir)).rejects.toThrow(/No workspace found/);
  });
});

describe('workspaceRelocateCommand + workspaceGetCommand (PAN-3286 WI-2 CLI surface)', () => {
  it('prints the old -> new path and the get command shows the new path with no divergence warning for a scratch workspace', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch-cli', path: oldDir });
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceRelocateCommand(id, { path: newDir });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toContain(oldDir);
    expect(printed).toContain(newDir);
    expect(printed).not.toMatch(/diverges/);
    expect(getWorkspaceById(id)!.path).toBe(newDir);

    logSpy.mockClear();
    await workspaceGetCommand(id);
    const getPrinted = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(getPrinted).toContain(`path:        ${newDir}`);
    expect(getPrinted).toContain(`memoryHome:  ${resolveWorkspaceMemoryRoot(projectId, id)}`);
  });

  it('rejects a nonexistent --path, exiting non-zero and leaving the row untouched', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch-missing', path: oldDir });
    const exitSpy = mockExit();
    const missing = join(newDir, 'does-not-exist');

    await expect(workspaceRelocateCommand(id, { path: missing })).rejects.toThrow(/process\.exit/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getWorkspaceById(id)!.path).toBe(oldDir);
  });

  it('prints a divergence warning when relocating a main workspace with --force', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'main', name: 'main', path: oldDir });
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceRelocateCommand(id, { path: newDir, force: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toMatch(/diverges/);
    expect(getWorkspaceById(id)!.path).toBe(newDir);
  });

  it('rejects relocating a main workspace without --force, exiting non-zero', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'main', name: 'main', path: oldDir });
    const exitSpy = mockExit();

    await expect(workspaceRelocateCommand(id, { path: newDir })).rejects.toThrow(/process\.exit/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getWorkspaceById(id)!.path).toBe(oldDir);
  });
});

describe('relocateWorkspace path validation (PAN-3330 review)', () => {
  it('refuses a path that does not exist, leaving the row untouched', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: oldDir });

    await expect(relocateWorkspace(id, join(newDir, 'does-not-exist'))).rejects.toThrow(/existing directory/);

    expect(getWorkspaceById(id)?.path).toBe(oldDir);
  });

  it('refuses a regular file, leaving the row untouched', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: oldDir });
    const filePath = join(newDir, 'not-a-dir.txt');
    writeFileSync(filePath, 'x', 'utf-8');

    await expect(relocateWorkspace(id, filePath)).rejects.toThrow(/existing directory/);

    expect(getWorkspaceById(id)?.path).toBe(oldDir);
  });

  it('stores a relative path as its resolved absolute form', async () => {
    const projectId = seedProject();
    const id = await createWorkspace({ projectId, kind: 'scratch', name: 'scratch', path: oldDir });

    await relocateWorkspace(id, '.');

    expect(getWorkspaceById(id)?.path).toBe(process.cwd());
  });
});
