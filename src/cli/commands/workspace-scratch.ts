import { exec, execFile } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { promisify } from 'util';
import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { listProjectsSync, type ProjectConfig } from '../../lib/projects.js';
import { getDefaultWorkspaceConfigSync } from '../../lib/workspace-config.js';
import { getMainWorkspace, listProjectTargets, resolveWorkspaceForCwd, resolveWorkspaceRef } from '../../lib/workspaces/resolver.js';
import { createWorkspace, relocateWorkspace, touchWorkspaceAccessed, upsertProjectFromConfig } from '../../lib/workspaces/writer.js';
import { validateFeatureName } from '../../lib/workspace-manager/worktree-ops.js';

/** True when `path` equals, or is nested under, `candidate`. */
function isPathUnder(path: string, candidate: string): boolean {
  return path === candidate || path.startsWith(candidate.endsWith('/') ? candidate : `${candidate}/`);
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface ResolvedProjectRef {
  key: string;
  config: ProjectConfig;
}

/** Resolve --project <key>, or the sole registered project, or the cwd's project. */
function resolveProjectByKey(key?: string): ResolvedProjectRef {
  const all = listProjectsSync();
  if (key) {
    const found = all.find((p) => p.key === key);
    if (!found) throw new Error(`No project registered with key '${key}'. Run 'pan projects list' to see registered keys.`);
    return found;
  }
  if (all.length === 1) return all[0];
  const ws = resolveWorkspaceForCwd(process.cwd());
  if (ws) {
    const fromCwd = all.find((p) => p.key === ws.projectId);
    if (fromCwd) return fromCwd;
  }
  throw new Error(`Multiple projects are registered; specify --project <key>. Run 'pan projects list' to see registered keys.`);
}

/** Ensure the project row exists (idempotent) before creating a workspace under it. */
function ensureProjectSeeded(project: ResolvedProjectRef): void {
  upsertProjectFromConfig(project.key, project.config);
}

async function inferParentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

export interface WorkspaceNewOptions {
  project?: string;
  isolated?: boolean;
  parentBranch?: string;
  targetPath?: string;
  dryRun?: boolean;
}

export async function workspaceNewCommand(name: string, options: WorkspaceNewOptions): Promise<void> {
  try {
    // Non-blocking review fix: name becomes a literal path segment
    // (`scratch-<name>`) and git ref fragment (`scratch/<name>`) for an
    // isolated workspace — reject separators, `..`, spaces, and other
    // ref-invalid characters up front instead of letting them create a
    // nested/unexpected target path or fail late inside git.
    if (!validateFeatureName(name)) {
      throw new Error(`Invalid workspace name '${name}'. Use alphanumeric and hyphens only.`);
    }
    if (options.targetPath && options.isolated) {
      throw new Error(`--target-path cannot be combined with --isolated.`);
    }
    const project = resolveProjectByKey(options.project);
    ensureProjectSeeded(project);

    const parentBranch = options.parentBranch ?? await inferParentBranch(project.config.path);
    const parentBranchGuessed = !options.parentBranch && parentBranch !== null;

    let path = project.config.path;
    let scratchBranch: string | undefined;
    let unregisteredTargetPath = false;
    let isGitRepository: boolean;
    let wouldCreateWorktree = false;
    if (options.targetPath) {
      const resolvedTarget = resolve(options.targetPath);
      if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isDirectory()) {
        throw new Error(`--target-path must be an existing directory: ${options.targetPath}`);
      }
      path = resolvedTarget;
      const registeredPaths = [project.config.path, ...listProjectTargets(project.key).map((t) => t.path)];
      unregisteredTargetPath = !registeredPaths.some((candidate) => isPathUnder(path, candidate));
      isGitRepository = existsSync(join(path, '.git'));
    } else if (options.isolated) {
      const workspaceConfig = project.config.workspace || getDefaultWorkspaceConfigSync();
      const workspacesDir = join(project.config.path, workspaceConfig.workspaces_dir || 'workspaces');
      path = join(workspacesDir, `scratch-${name}`);
      if (existsSync(path)) {
        throw new Error(`Path already exists: ${path}`);
      }
      scratchBranch = `scratch/${name}`;
      wouldCreateWorktree = true;
      isGitRepository = true;
      if (!options.dryRun) {
        // A new worktree cannot check out `parentBranch` directly — it's
        // normally the project's currently-checked-out branch, and git refuses
        // to have the same branch checked out in two worktrees at once. Create
        // a distinct scratch branch off of it instead. Argument-vector spawn
        // (execFile, not a shell string) so `name`/`path`/`--parent-branch`
        // can't inject shell metacharacters.
        const worktreeArgs = parentBranch
          ? ['worktree', 'add', '-b', scratchBranch, path, parentBranch]
          : ['worktree', 'add', '-b', scratchBranch, path];
        await execFileAsync('git', worktreeArgs, { cwd: project.config.path });
      }
    } else {
      isGitRepository = existsSync(join(path, '.git'));
    }

    if (options.dryRun) {
      console.log(
        JSON.stringify(
          {
            projectId: project.key,
            kind: 'scratch',
            name,
            path,
            branchName: scratchBranch ?? null,
            parentBranch: parentBranch ?? null,
            parentBranchGuessed,
            isGitRepository,
            wouldCreateWorktree,
          },
          null,
          2,
        ),
      );
      return;
    }

    const id = await createWorkspace({
      projectId: project.key,
      kind: 'scratch',
      name,
      path,
      branchName: scratchBranch,
      parentBranch: parentBranch ?? undefined,
      parentBranchGuessed,
      isGitRepository,
    });

    console.log(chalk.green(`✓ Created scratch workspace '${name}' (${id})`));
    console.log(chalk.dim(`  path: ${path}`));
    if (options.isolated) console.log(chalk.dim(`  isolated worktree, parent branch: ${parentBranch ?? '(none)'}`));
    if (unregisteredTargetPath) {
      console.log(
        chalk.yellow(
          `ℹ '${path}' is not a registered target for project '${project.key}'. Run 'pan project add-target ${project.key} --path ${path}' to register it.`,
        ),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`✗ ${message}`));
    return exitCli(1);
  }
}

export interface WorkspaceMainOptions {
  project?: string;
}

export async function workspaceMainCommand(options: WorkspaceMainOptions): Promise<void> {
  try {
    const project = resolveProjectByKey(options.project);
    ensureProjectSeeded(project);

    let row = getMainWorkspace(project.key);
    if (row) {
      touchWorkspaceAccessed(row.id);
      console.log(chalk.green(`✓ Main workspace for '${project.key}': ${row.path}`));
      return;
    }

    const isGitRepository = existsSync(join(project.config.path, '.git'));
    const id = await createWorkspace({
      projectId: project.key,
      kind: 'main',
      name: 'main',
      path: project.config.path,
      isGitRepository,
    });
    touchWorkspaceAccessed(id);
    console.log(chalk.green(`✓ Created main workspace for '${project.key}' (${id})`));
    console.log(chalk.dim(`  path: ${project.config.path}${isGitRepository ? '' : ' (not a git repository)'}`));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`✗ ${message}`));
    return exitCli(1);
  }
}

export interface WorkspaceRelocateOptions {
  path?: string;
  force?: boolean;
}

/** Point a workspace at a new path (Subspace `workspaces update --relocate` parity, PAN-3286 WI-2). */
export async function workspaceRelocateCommand(ws: string, options: WorkspaceRelocateOptions): Promise<void> {
  try {
    if (!options.path) {
      throw new Error(`--path is required.`);
    }
    const resolution = resolveWorkspaceRef(ws);
    if (resolution.ambiguous) {
      throw new Error(
        `Multiple workspaces named '${ws}' found (projects: ${resolution.matches.map((w) => w.projectId).join(', ')}); use the workspace id instead.`,
      );
    }
    if (!resolution.workspace) {
      throw new Error(`No workspace found with id or name '${ws}'`);
    }
    const workspace = resolution.workspace;

    const resolvedPath = resolve(options.path);
    if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
      throw new Error(`--path must be an existing directory: ${options.path}`);
    }

    const oldPath = workspace.path;
    await relocateWorkspace(workspace.id, resolvedPath, { force: options.force });

    console.log(chalk.green(`✓ Relocated workspace '${workspace.name}' (${workspace.id})`));
    console.log(chalk.dim(`  ${oldPath} → ${resolvedPath}`));
    if (workspace.kind === 'main') {
      console.log(
        chalk.yellow(
          `ℹ '${workspace.name}' is the project's main workspace — its path now diverges from projects.yaml's primary path.`,
        ),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`✗ ${message}`));
    return exitCli(1);
  }
}
