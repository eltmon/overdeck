import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { listProjectsSync, type ProjectConfig } from '../../lib/projects.js';
import { getDefaultWorkspaceConfigSync } from '../../lib/workspace-config.js';
import { getMainWorkspace, resolveWorkspaceForCwd } from '../../lib/workspaces/resolver.js';
import { createWorkspace, touchWorkspaceAccessed, upsertProjectFromConfig } from '../../lib/workspaces/writer.js';

const execAsync = promisify(exec);

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
}

export async function workspaceNewCommand(name: string, options: WorkspaceNewOptions): Promise<void> {
  try {
    const project = resolveProjectByKey(options.project);
    ensureProjectSeeded(project);

    const parentBranch = options.parentBranch ?? await inferParentBranch(project.config.path);
    const parentBranchGuessed = !options.parentBranch && parentBranch !== null;

    let path = project.config.path;
    if (options.isolated) {
      const workspaceConfig = project.config.workspace || getDefaultWorkspaceConfigSync();
      const workspacesDir = join(project.config.path, workspaceConfig.workspaces_dir || 'workspaces');
      path = join(workspacesDir, `scratch-${name}`);
      if (existsSync(path)) {
        throw new Error(`Path already exists: ${path}`);
      }
      const branchArgs = parentBranch ? [parentBranch] : [];
      await execAsync(
        `git worktree add "${path}" ${branchArgs.join(' ')}`.trim(),
        { cwd: project.config.path },
      );
    }

    const id = await createWorkspace({
      projectId: project.key,
      kind: 'scratch',
      name,
      path,
      parentBranch: parentBranch ?? undefined,
      parentBranchGuessed,
      isGitRepository: options.isolated ? true : existsSync(join(project.config.path, '.git')),
    });

    console.log(chalk.green(`✓ Created scratch workspace '${name}' (${id})`));
    console.log(chalk.dim(`  path: ${path}`));
    if (options.isolated) console.log(chalk.dim(`  isolated worktree, parent branch: ${parentBranch ?? '(none)'}`));
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
