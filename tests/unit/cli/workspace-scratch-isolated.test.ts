/**
 * PAN-1990 review fix: `pan workspace new --isolated` used to (1) try to
 * check the project's currently-checked-out branch out a second time in the
 * new worktree — which git refuses — and (2) build the `git worktree add`
 * command as an interpolated shell string, so `name`/`--parent-branch` could
 * inject shell metacharacters. These tests exercise the real `git` binary
 * (no mocked exec) so both are proven against actual git behavior, not a
 * mock's assumptions about it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../helpers/overdeck-test-db.js';
import { registerProjectSync, unregisterProjectSync } from '../../../src/lib/projects.js';
import { getWorkspaceForIssue } from '../../../src/lib/workspaces/resolver.js';
import { listWorkspaces } from '../../../src/lib/workspaces/resolver.js';
import { workspaceNewCommand } from '../../../src/cli/commands/workspace-scratch.js';

let odb: OverdeckTestDb;
let projectRoot: string;
const PROJECT_KEY = 'workspace-scratch-isolated-test';

function initRepoWithCheckedOutBranch(root: string): void {
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'root\n', 'utf-8');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'init', '--quiet'], { cwd: root });
}

beforeEach(() => {
  odb = setupOverdeckTestDb();
  projectRoot = mkdtempSync(join(tmpdir(), 'pan-1990-workspace-scratch-'));
  initRepoWithCheckedOutBranch(projectRoot);
  registerProjectSync(PROJECT_KEY, { name: 'Isolated test project', path: projectRoot });
});

afterEach(() => {
  unregisterProjectSync(PROJECT_KEY);
  teardownOverdeckTestDb(odb);
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('workspaceNewCommand --isolated (PAN-1990 review fix)', () => {
  it('creates the worktree on a distinct scratch branch instead of re-checking-out the current branch', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit unexpectedly called with ${code}`);
    }) as never);

    await workspaceNewCommand('alpha', { project: PROJECT_KEY, isolated: true });

    expect(exitSpy).not.toHaveBeenCalled();
    const worktreePath = join(projectRoot, 'workspaces', 'scratch-alpha');
    expect(existsSync(worktreePath)).toBe(true);

    const branch = execFileSync('git', ['-C', worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    expect(branch).toBe('scratch/alpha');
    // The main worktree's own branch is untouched — proves no second-checkout conflict occurred.
    const mainBranch = execFileSync('git', ['-C', projectRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    expect(mainBranch).toBe('main');

    const rows = listWorkspaces({ projectId: PROJECT_KEY, kind: 'scratch' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.branchName).toBe('scratch/alpha');
  });

  it('a workspace name containing shell metacharacters cannot inject a command (argument-vector spawn)', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit unexpectedly called with ${code}`);
    }) as never);
    const canaryPath = join(tmpdir(), `pan-1990-injection-canary-${process.pid}`);
    rmSync(canaryPath, { force: true });

    // If the command were still built as an interpolated shell string, this
    // name would break out and touch canaryPath via command substitution.
    const maliciousName = `x$(touch ${canaryPath})`;

    await expect(workspaceNewCommand(maliciousName, { project: PROJECT_KEY, isolated: true }))
      .rejects.toThrow(/process\.exit/);

    expect(existsSync(canaryPath)).toBe(false);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
