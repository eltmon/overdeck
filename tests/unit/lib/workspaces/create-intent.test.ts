/**
 * PAN-3330 WI-1: the shared workspace-creation core.
 *
 * Three properties matter here, because the dashboard's resolve-before-create
 * preview is only trustworthy if all three hold:
 *
 *  1. Parity — `toDryRunPayload(resolveWorkspaceCreateIntent(...))` is
 *     field-for-field (and key-order) identical to what
 *     `pan workspace new --dry-run` prints, for all three modes.
 *  2. Findings, not throws — invalid input comes back as `{field, message}`
 *     entries a form can render inline.
 *  3. Resolution writes nothing — no worktree, no registry row, no project row.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../helpers/overdeck-test-db.js';
import { registerProjectSync, unregisterProjectSync } from '../../../../src/lib/projects.js';
import { getProjectByKey, listWorkspaces } from '../../../../src/lib/workspaces/resolver.js';
import { createWorkspace, upsertProjectFromConfig } from '../../../../src/lib/workspaces/writer.js';
import {
  performWorkspaceCreate,
  resolveWorkspaceCreateIntent,
  toDryRunPayload,
} from '../../../../src/lib/workspaces/create.js';
import { workspaceNewCommand } from '../../../../src/cli/commands/workspace-scratch.js';

let odb: OverdeckTestDb;
let projectRoot: string;
let targetDir: string;
const PROJECT_KEY = 'pan-3330-create-intent-test';

function initRepo(root: string): void {
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'root\n', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'init', '--quiet'], { cwd: root });
}

/** What the CLI prints for `--dry-run`, parsed back out of console.log. */
async function cliDryRun(name: string, options: Record<string, unknown>): Promise<unknown> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await workspaceNewCommand(name, { project: PROJECT_KEY, dryRun: true, ...options });
    return JSON.parse(logSpy.mock.calls.map((call) => String(call[0])).join('\n'));
  } finally {
    logSpy.mockRestore();
  }
}

function worktreeList(): string {
  return execFileSync('git', ['worktree', 'list'], { cwd: projectRoot, encoding: 'utf-8' });
}

function workspaceRowCount(): number {
  return listWorkspaces({ projectId: PROJECT_KEY }).length;
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-3330-create-intent-'));
  initRepo(projectRoot);
  registerProjectSync(PROJECT_KEY, { name: 'Create intent test project', path: projectRoot });
  targetDir = mkdtempSync(join(tmpdir(), 'pan-3330-target-dir-'));
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('resolveWorkspaceCreateIntent — CLI dry-run parity (AC-1)', () => {
  it('matches the shared-mode dry-run field for field, in the same key order', async () => {
    const fromCli = await cliDryRun('shared-mode', {});
    const fromCore = toDryRunPayload(
      await resolveWorkspaceCreateIntent({ name: 'shared-mode', projectKey: PROJECT_KEY }),
    );

    expect(fromCore).toEqual(fromCli);
    expect(Object.keys(fromCore)).toEqual(Object.keys(fromCli as object));
    expect(fromCore).toMatchObject({
      projectId: PROJECT_KEY,
      kind: 'scratch',
      path: projectRoot,
      branchName: null,
      parentBranch: 'main',
      parentBranchGuessed: true,
      isGitRepository: true,
      wouldCreateWorktree: false,
    });
  });

  it('matches the target-path dry-run field for field, in the same key order', async () => {
    const fromCli = await cliDryRun('target-mode', { targetPath: targetDir });
    const fromCore = toDryRunPayload(
      await resolveWorkspaceCreateIntent({ name: 'target-mode', projectKey: PROJECT_KEY, targetPath: targetDir }),
    );

    expect(fromCore).toEqual(fromCli);
    expect(Object.keys(fromCore)).toEqual(Object.keys(fromCli as object));
    expect(fromCore).toMatchObject({ path: targetDir, wouldCreateWorktree: false, isGitRepository: false });
  });

  it('matches the isolated dry-run field for field, in the same key order', async () => {
    const fromCli = await cliDryRun('isolated-mode', { isolated: true });
    const fromCore = toDryRunPayload(
      await resolveWorkspaceCreateIntent({ name: 'isolated-mode', projectKey: PROJECT_KEY, isolated: true }),
    );

    expect(fromCore).toEqual(fromCli);
    expect(Object.keys(fromCore)).toEqual(Object.keys(fromCli as object));
    expect(fromCore).toMatchObject({
      path: join(projectRoot, 'workspaces', 'scratch-isolated-mode'),
      branchName: 'scratch/isolated-mode',
      wouldCreateWorktree: true,
      isGitRepository: true,
    });
  });

  it('carries an explicit --parent-branch through unguessed', async () => {
    const intent = await resolveWorkspaceCreateIntent({
      name: 'explicit-parent',
      projectKey: PROJECT_KEY,
      isolated: true,
      parentBranch: 'main',
    });

    expect(intent.parentBranch).toBe('main');
    expect(intent.parentBranchGuessed).toBe(false);
  });
});

describe('resolveWorkspaceCreateIntent — findings instead of throws (AC-2)', () => {
  it('returns an invalid-name finding against the name field rather than throwing', async () => {
    const intent = await resolveWorkspaceCreateIntent({ name: 'bad/name', projectKey: PROJECT_KEY });

    expect(intent.findings).toEqual([
      expect.objectContaining({ field: 'name', code: 'invalid-name', message: expect.any(String) }),
    ]);
    expect(intent.path).toBeNull();
  });

  it('returns a target-not-a-directory finding when the target directory is missing', async () => {
    const missing = join(targetDir, 'does-not-exist');
    const intent = await resolveWorkspaceCreateIntent({
      name: 'missing-target',
      projectKey: PROJECT_KEY,
      targetPath: missing,
    });

    expect(intent.findings).toEqual([
      expect.objectContaining({ field: 'targetPath', code: 'target-not-a-directory', detail: missing }),
    ]);
    expect(intent.path).toBeNull();
  });

  it('returns a mode-conflict finding and resolves no path when target-path and isolated are combined', async () => {
    const intent = await resolveWorkspaceCreateIntent({
      name: 'conflict',
      projectKey: PROJECT_KEY,
      targetPath: targetDir,
      isolated: true,
    });

    expect(intent.findings).toEqual([
      expect.objectContaining({ field: 'targetPath', code: 'mode-conflict' }),
    ]);
    expect(intent.path).toBeNull();
    expect(intent.wouldCreateWorktree).toBe(false);
  });

  it('returns a project-not-found finding for an unregistered project key', async () => {
    const intent = await resolveWorkspaceCreateIntent({ name: 'orphan', projectKey: 'no-such-project' });

    expect(intent.findings).toEqual([
      expect.objectContaining({ field: 'project', code: 'project-not-found', detail: 'no-such-project' }),
    ]);
    expect(intent.projectId).toBeNull();
  });

  it('refuses to perform an intent that carries findings', async () => {
    const intent = await resolveWorkspaceCreateIntent({ name: 'bad/name', projectKey: PROJECT_KEY });

    await expect(performWorkspaceCreate(intent)).rejects.toThrow(/letters, numbers, and hyphens/);
    expect(workspaceRowCount()).toBe(0);
  });
});

describe('resolveWorkspaceCreateIntent — resolution writes nothing (AC-3)', () => {
  it('leaves git worktrees and the registry untouched after resolving all three modes', async () => {
    const worktreesBefore = worktreeList();
    const rowsBefore = workspaceRowCount();

    await resolveWorkspaceCreateIntent({ name: 'probe-shared', projectKey: PROJECT_KEY });
    await resolveWorkspaceCreateIntent({ name: 'probe-target', projectKey: PROJECT_KEY, targetPath: targetDir });
    await resolveWorkspaceCreateIntent({ name: 'probe-isolated', projectKey: PROJECT_KEY, isolated: true });

    expect(worktreeList()).toBe(worktreesBefore);
    expect(workspaceRowCount()).toBe(rowsBefore);
    expect(getProjectByKey(PROJECT_KEY)).toBeNull();
    expect(existsSync(join(projectRoot, 'workspaces', 'scratch-probe-isolated'))).toBe(false);
  });

  it('performWorkspaceCreate is the step that creates the worktree and the row', async () => {
    const intent = await resolveWorkspaceCreateIntent({
      name: 'realized',
      projectKey: PROJECT_KEY,
      isolated: true,
    });

    const { id } = await performWorkspaceCreate(intent);

    expect(id).toBeTruthy();
    expect(existsSync(join(projectRoot, 'workspaces', 'scratch-realized'))).toBe(true);
    expect(worktreeList()).toMatch(/scratch-realized/);
    const rows = listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.branchName).toBe('scratch/realized');
    expect(getProjectByKey(PROJECT_KEY)).not.toBeNull();
  });
});

describe('resolveWorkspaceCreateIntent — no ambient working directory (AC-4)', () => {
  // Two registered projects, so the sole-project shortcut cannot decide, and a
  // registry row at projectRoot — exactly what a cwd lookup would resolve
  // through. If the module reached for the process's own working directory it
  // would silently pick PROJECT_KEY here.
  const SECOND_PROJECT_KEY = 'pan-3330-second-project';
  let secondRoot: string;

  beforeEach(async () => {
    secondRoot = mkdtempSync(join(tmpdir(), 'pan-3330-second-project-'));
    registerProjectSync(SECOND_PROJECT_KEY, { name: 'Second project', path: secondRoot });
    upsertProjectFromConfig(PROJECT_KEY, { name: 'Create intent test project', path: projectRoot });
    await createWorkspace({ projectId: PROJECT_KEY, kind: 'main', name: 'main', path: projectRoot });
  });

  afterEach(() => {
    unregisterProjectSync(SECOND_PROJECT_KEY);
    rmSync(secondRoot, { recursive: true, force: true });
  });

  it('reports the project as ambiguous instead of resolving from the ambient working directory', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    const intent = await resolveWorkspaceCreateIntent({ name: 'ambient' });

    expect(cwdSpy).not.toHaveBeenCalled();
    expect(intent.projectId).toBeNull();
    expect(intent.findings).toEqual([
      expect.objectContaining({ field: 'project', code: 'project-ambiguous' }),
    ]);
  });

  it('anchors a relative target path to the caller cwd, not the ambient one', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/definitely/not/here');

    const intent = await resolveWorkspaceCreateIntent({
      name: 'relative-target',
      projectKey: PROJECT_KEY,
      cwd: targetDir,
      targetPath: '.',
    });

    expect(cwdSpy).not.toHaveBeenCalled();
    expect(intent.findings).toEqual([]);
    expect(intent.path).toBe(targetDir);
  });

  it('anchors a relative target path to the project root when no cwd is given', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/definitely/not/here');

    const intent = await resolveWorkspaceCreateIntent({
      name: 'relative-target',
      projectKey: PROJECT_KEY,
      targetPath: '.',
    });

    expect(cwdSpy).not.toHaveBeenCalled();
    expect(intent.path).toBe(projectRoot);
  });

  it('leaves an absolute target path untouched', async () => {
    const intent = await resolveWorkspaceCreateIntent({
      name: 'absolute-target',
      projectKey: PROJECT_KEY,
      cwd: projectRoot,
      targetPath: targetDir,
    });

    expect(intent.path).toBe(targetDir);
  });

  it('resolves that same project once the working directory is passed explicitly', async () => {
    const intent = await resolveWorkspaceCreateIntent({ name: 'explicit-cwd', cwd: projectRoot });

    expect(intent.projectId).toBe(PROJECT_KEY);
    expect(intent.findings).toEqual([]);
  });
});
