import { existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { exitCli } from '../exit.js';
import chalk from 'chalk';
import { getMainWorkspace, resolveWorkspaceRef } from '../../lib/workspaces/resolver.js';
import { relocateWorkspace, touchWorkspaceAccessed } from '../../lib/workspaces/writer.js';
import {
  ensureProjectSeeded,
  performWorkspaceCreate,
  resolveWorkspaceCreateIntent,
  toDryRunPayload,
  type WorkspaceIntentFinding,
} from '../../lib/workspaces/create.js';

/**
 * Render a resolver finding in the CLI's own phrasing. The shared core keeps
 * its messages surface-neutral (a dialog renders them beside a field), so the
 * flag-flavored wording every existing CLI test asserts lives here.
 */
function cliMessageFor(finding: WorkspaceIntentFinding): string {
  switch (finding.code) {
    case 'invalid-name':
      return `Invalid workspace name '${finding.detail}'. Use alphanumeric and hyphens only.`;
    case 'mode-conflict':
      return `--target-path cannot be combined with --isolated.`;
    case 'project-not-found':
      return `No project registered with key '${finding.detail}'. Run 'pan projects list' to see registered keys.`;
    case 'project-ambiguous':
      return `Multiple projects are registered; specify --project <key>. Run 'pan projects list' to see registered keys.`;
    case 'target-not-a-directory':
      return `--target-path must be an existing directory: ${finding.detail}`;
    case 'path-exists':
      return `Path already exists: ${finding.detail}`;
    default:
      return finding.message;
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
    // Resolution writes nothing, so `--dry-run` leaves no `projects` row, no
    // worktree and no memory home behind — and a rejected `--target-path`
    // leaves no trace either. Seeding happens inside performWorkspaceCreate,
    // the only path that needs the row to exist.
    const intent = await resolveWorkspaceCreateIntent({
      name,
      kind: 'scratch',
      projectKey: options.project,
      cwd: process.cwd(),
      isolated: options.isolated,
      targetPath: options.targetPath,
      parentBranch: options.parentBranch,
    });
    if (intent.findings.length > 0) throw new Error(cliMessageFor(intent.findings[0]));

    if (options.dryRun) {
      console.log(JSON.stringify(toDryRunPayload(intent), null, 2));
      return;
    }

    const { id } = await performWorkspaceCreate(intent);

    console.log(chalk.green(`✓ Created scratch workspace '${name}' (${id})`));
    console.log(chalk.dim(`  path: ${intent.path}`));
    if (options.isolated) console.log(chalk.dim(`  isolated worktree, parent branch: ${intent.parentBranch ?? '(none)'}`));
    if (intent.unregisteredTargetPath) {
      console.log(
        chalk.yellow(
          `ℹ '${intent.path}' is not a registered target for project '${intent.projectId}'. Run 'pan project add-target ${intent.projectId} --path ${intent.path}' to register it.`,
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
    const intent = await resolveWorkspaceCreateIntent({
      kind: 'main',
      projectKey: options.project,
      cwd: process.cwd(),
    });
    if (intent.findings.length > 0) throw new Error(cliMessageFor(intent.findings[0]));
    const projectKey = intent.projectId as string;
    await ensureProjectSeeded(projectKey);

    const row = getMainWorkspace(projectKey);
    if (row) {
      touchWorkspaceAccessed(row.id);
      console.log(chalk.green(`✓ Main workspace for '${projectKey}': ${row.path}`));
      return;
    }

    const { id } = await performWorkspaceCreate(intent);
    touchWorkspaceAccessed(id);
    console.log(chalk.green(`✓ Created main workspace for '${projectKey}' (${id})`));
    console.log(chalk.dim(`  path: ${intent.path}${intent.isGitRepository ? '' : ' (not a git repository)'}`));
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
