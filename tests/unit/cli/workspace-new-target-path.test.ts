/**
 * PAN-3286 WI-1: `pan workspace new --target-path <dir>` lets a scratch
 * workspace target any existing directory instead of the project's primary
 * path — happy path, the two rejection cases (nonexistent/non-directory,
 * combined with --isolated), and the informational note when the target
 * isn't a registered project target. Also covers WI-1's --dry-run intent
 * resolution: it must print the resolved intent as JSON and create no DB
 * row, worktree, or memory home.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';
import { registerProjectSync, unregisterProjectSync } from '../../../src/lib/projects.js';
import { getProjectByKey, listWorkspaces } from '../../../src/lib/workspaces/resolver.js';
import { addProjectTarget, upsertProjectFromConfig } from '../../../src/lib/workspaces/writer.js';
import { resolveMemoryRoot } from '../../../src/lib/memory/paths.js';
import { workspaceNewCommand } from '../../../src/cli/commands/workspace-scratch.js';

let odb: OverdeckTestDb;
let projectRoot: string;
let targetDir: string;
const PROJECT_KEY = 'workspace-new-target-path-test';

function mockExit() {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit unexpectedly called with ${code}`);
  }) as never);
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-3286-workspace-new-target-'));
  registerProjectSync(PROJECT_KEY, { name: 'Target path test project', path: projectRoot });
  targetDir = mkdtempSync(join(tmpdir(), 'pan-3286-target-dir-'));
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('workspaceNewCommand --target-path (PAN-3286 WI-1)', () => {
  it('creates a scratch workspace row whose path is the resolved target directory and reflects .git presence', async () => {
    execFileSync('git', ['init', '--quiet'], { cwd: targetDir });
    const exitSpy = mockExit();

    await workspaceNewCommand('alpha', { project: PROJECT_KEY, targetPath: targetDir });

    expect(exitSpy).not.toHaveBeenCalled();
    const rows = listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe(targetDir);
    expect(rows[0]?.isGitRepository).toBe(true);
  });

  it('reflects is_git_repository=false when the target directory is not a git repo', async () => {
    const exitSpy = mockExit();

    await workspaceNewCommand('beta', { project: PROJECT_KEY, targetPath: targetDir });

    expect(exitSpy).not.toHaveBeenCalled();
    const rows = listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' });
    expect(rows[0]?.isGitRepository).toBe(false);
  });

  it('rejects a nonexistent --target-path, exiting non-zero and creating no row', async () => {
    const exitSpy = mockExit();
    const missing = join(targetDir, 'does-not-exist');

    await expect(workspaceNewCommand('gamma', { project: PROJECT_KEY, targetPath: missing })).rejects.toThrow(
      /process\.exit/,
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(0);
  });

  it('rejects a --target-path that is a file, not a directory', async () => {
    const exitSpy = mockExit();
    const filePath = join(targetDir, 'not-a-dir.txt');
    writeFileSync(filePath, 'x', 'utf-8');

    await expect(workspaceNewCommand('delta', { project: PROJECT_KEY, targetPath: filePath })).rejects.toThrow(
      /process\.exit/,
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('rejects --target-path combined with --isolated, exiting non-zero and creating no row', async () => {
    const exitSpy = mockExit();

    await expect(
      workspaceNewCommand('epsilon', { project: PROJECT_KEY, targetPath: targetDir, isolated: true }),
    ).rejects.toThrow(/process\.exit/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(0);
  });

  it('prints an informational note and still creates the row when the target is under no registered project target', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceNewCommand('zeta', { project: PROJECT_KEY, targetPath: targetDir });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(1);
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).toMatch(/not a registered target/);
    expect(printed).toMatch(/pan project add-target/);
  });

  it('prints no informational note when the target path is registered via pan project add-target', async () => {
    upsertProjectFromConfig(PROJECT_KEY, { name: 'Target path test project', path: projectRoot });
    addProjectTarget(PROJECT_KEY, targetDir, false);
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceNewCommand('eta', { project: PROJECT_KEY, targetPath: targetDir });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(printed).not.toMatch(/not a registered target/);
  });
});

describe('workspaceNewCommand --dry-run (PAN-3286 WI-1)', () => {
  it('prints the resolved intent as JSON for the shared (default) variant and creates no row', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceNewCommand('theta', { project: PROJECT_KEY, dryRun: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    const intent = JSON.parse(printed);
    expect(intent).toMatchObject({
      projectId: PROJECT_KEY,
      kind: 'scratch',
      name: 'theta',
      path: projectRoot,
      isGitRepository: false,
      wouldCreateWorktree: false,
    });
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(0);
  });

  // Review fix: `--dry-run` must write NOTHING. The command used to seed the
  // project row before resolving the intent, so a supposedly read-only planning
  // command mutated canonical runtime state.
  it('leaves the projects table and the memory root untouched', async () => {
    const exitSpy = mockExit();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(getProjectByKey(PROJECT_KEY)).toBeNull();

    await workspaceNewCommand('theta', { project: PROJECT_KEY, dryRun: true });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getProjectByKey(PROJECT_KEY)).toBeNull();
    expect(existsSync(resolveMemoryRoot(PROJECT_KEY))).toBe(false);
  });

  it('leaves the projects table untouched when --target-path is rejected', async () => {
    const exitSpy = mockExit();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(workspaceNewCommand('theta', {
      project: PROJECT_KEY,
      targetPath: join(targetDir, 'does-not-exist'),
    })).rejects.toThrow(/process\.exit/);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getProjectByKey(PROJECT_KEY)).toBeNull();
  });

  it('does seed the project row on a real (non-dry-run) create', async () => {
    const exitSpy = mockExit();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceNewCommand('theta-real', { project: PROJECT_KEY });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getProjectByKey(PROJECT_KEY)).not.toBeNull();
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(1);
  });

  it('prints wouldCreateWorktree=true and creates no worktree directory for the --isolated variant', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceNewCommand('iota', { project: PROJECT_KEY, isolated: true, dryRun: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    const intent = JSON.parse(printed);
    const worktreePath = join(projectRoot, 'workspaces', 'scratch-iota');
    expect(intent).toMatchObject({
      kind: 'scratch',
      name: 'iota',
      path: worktreePath,
      branchName: 'scratch/iota',
      isGitRepository: true,
      wouldCreateWorktree: true,
    });
    expect(existsSync(worktreePath)).toBe(false);
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(0);
  });

  it('prints the resolved target directory as path and wouldCreateWorktree=false when combined with --target-path', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await workspaceNewCommand('kappa', { project: PROJECT_KEY, targetPath: targetDir, dryRun: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    const intent = JSON.parse(printed);
    expect(intent).toMatchObject({
      kind: 'scratch',
      name: 'kappa',
      path: targetDir,
      wouldCreateWorktree: false,
    });
    expect(listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' })).toHaveLength(0);
  });
});
