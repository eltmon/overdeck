import { exitCli } from '../exit.js';
import chalk from 'chalk';
import ora from 'ora';
import { exec } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { basename, join } from 'path';
import { promisify } from 'util';
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';
import {
  extractTeamPrefix,
  findProjectByTeamSync,
  listProjectsSync,
  resolveProjectFromIssueSync,
} from '../../lib/projects.js';
import { loadWorkspaceMetadataSync } from '../../lib/remote/workspace-metadata.js';
import { removeWorkspace as removeWorkspaceFromConfig } from '../../lib/workspace-manager.js';
import { listWorktrees, removeWorktree, type WorktreeInfo } from '../../lib/worktree.js';
import { destroyRemoteWorkspace } from './workspace-remote.js';
import { resolveMemoryRoot } from '../../lib/memory/paths.js';
import { getWorkspaceForIssue, listWorkspaces } from '../../lib/workspaces/resolver.js';
import type { WorkspaceKind } from '../../lib/workspaces/types.js';
import { deleteWorkspace } from '../../lib/workspaces/writer.js';

const execAsync = promisify(exec);

interface ListOptions {
  json?: boolean;
  all?: boolean;
  kind?: WorkspaceKind;
  archived?: boolean;
}

/** PAN-1990: --kind reads through the resolver instead of scanning worktree directories. */
function listByKind(options: ListOptions & { kind: WorkspaceKind }): void {
  const projects = options.all ? listProjectsSync().map((p) => p.key) : undefined;
  const rows = projects
    ? projects.flatMap((projectId) => listWorkspaces({ projectId, kind: options.kind, includeArchived: options.archived }))
    : listWorkspaces({ kind: options.kind, includeArchived: options.archived });

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log(chalk.dim(`No ${options.kind} workspaces found.`));
    return;
  }

  console.log(chalk.bold(`\n${options.kind} workspaces\n`));
  for (const row of rows) {
    const archivedTag = row.isArchived ? chalk.yellow(' (archived)') : '';
    console.log(`${chalk.cyan(row.name)}${archivedTag}`);
    console.log(`  project:      ${row.projectId}`);
    console.log(`  branch:       ${row.branchName ?? chalk.dim('(none)')}`);
    console.log(`  lastAccessed: ${new Date(row.lastAccessedAt).toISOString()}`);
    console.log('');
  }
}

const VALID_WORKSPACE_KINDS: readonly WorkspaceKind[] = ['main', 'issue', 'scratch'];

export async function listCommand(options: ListOptions): Promise<void> {
  if (options.kind) {
    if (!VALID_WORKSPACE_KINDS.includes(options.kind)) {
      console.error(chalk.red(`✗ Invalid --kind '${options.kind}'. Expected one of: ${VALID_WORKSPACE_KINDS.join(', ')}`));
      return exitCli(1);
    }
    listByKind(options as ListOptions & { kind: WorkspaceKind });
    return;
  }

  const projects = listProjectsSync();

  // If we have registered projects and --all is specified, list across all projects
  if (projects.length > 0 && options.all) {
    const allWorkspaces: Array<{
      projectName: string;
      projectPath: string;
      workspaces: WorktreeInfo[];
    }> = [];

    for (const { key, config } of projects) {
      // For polyrepo projects, list worktrees from each sub-repo
      const isPolyrepo = config.workspace?.type === 'polyrepo' && config.workspace?.repos;
      const workspaces: WorktreeInfo[] = [];

      if (isPolyrepo && config.workspace?.repos) {
        // Polyrepo: scan each configured repo for worktrees
        for (const repo of config.workspace.repos) {
          const repoPath = join(config.path, repo.path);
          if (!existsSync(join(repoPath, '.git'))) continue;
          const repoWorktrees = await Effect.runPromise(
            listWorktrees(repoPath).pipe(Effect.provide(nodeServicesLayer)),
          );
          for (const wt of repoWorktrees) {
            if (wt.path.includes('/workspaces/') || wt.path.includes('\\workspaces\\')) {
              // Deduplicate: polyrepo workspaces share a parent dir (e.g., feature-min-697/fe, feature-min-697/api)
              // Use the parent workspace dir as the canonical path
              const parts = wt.path.split('/workspaces/');
              if (parts.length > 1) {
                const workspaceDir = parts[1].split('/')[0]; // e.g., "feature-min-697"
                const canonicalPath = join(config.path, 'workspaces', workspaceDir);
                if (!workspaces.some(w => w.path === canonicalPath)) {
                  workspaces.push({ ...wt, path: canonicalPath });
                }
              }
            }
          }
        }
      } else {
        // Monorepo: scan project root
        if (!existsSync(join(config.path, '.git'))) continue;
        const worktrees = await Effect.runPromise(
          listWorktrees(config.path).pipe(Effect.provide(nodeServicesLayer)),
        );
        for (const wt of worktrees) {
          if (wt.path.includes('/workspaces/') || wt.path.includes('\\workspaces\\')) {
            workspaces.push(wt);
          }
        }
      }

      if (workspaces.length > 0) {
        allWorkspaces.push({
          projectName: config.name,
          projectPath: config.path,
          workspaces,
        });
      }
    }

    if (options.json) {
      console.log(JSON.stringify(allWorkspaces, null, 2));
      return;
    }

    if (allWorkspaces.length === 0) {
      console.log(chalk.dim('No workspaces found in any registered project.'));
      console.log(chalk.dim('Create one with: pan workspace create <issue-id>'));
      return;
    }

    for (const proj of allWorkspaces) {
      console.log(chalk.bold(`\n${proj.projectName}\n`));
      for (const ws of proj.workspaces) {
        const name = basename(ws.path);
        const status = ws.prunable ? chalk.yellow(' (prunable)') : '';
        console.log(`  ${chalk.cyan(name)}${status}`);
        console.log(`    Branch: ${ws.branch || chalk.dim('(detached)')}`);
        console.log(`    Path:   ${chalk.dim(ws.path)}`);
      }
    }
    return;
  }

  // Default behavior: list from current directory
  const projectRoot = process.cwd();

  if (!existsSync(join(projectRoot, '.git'))) {
    console.error(chalk.red('Not a git repository.'));
    if (projects.length > 0) {
      console.log(chalk.dim('Tip: Use --all to list workspaces across all registered projects.'));
    }
    return exitCli(1);
  }

  const worktrees = await Effect.runPromise(
    listWorktrees(projectRoot).pipe(Effect.provide(nodeServicesLayer)),
  );

  // Filter to workspaces directory only
  const workspaces = worktrees.filter((w) =>
    w.path.includes('/workspaces/') || w.path.includes('\\workspaces\\')
  );

  if (options.json) {
    console.log(JSON.stringify(workspaces, null, 2));
    return;
  }

  if (workspaces.length === 0) {
    console.log(chalk.dim('No workspaces found.'));
    console.log(chalk.dim('Create one with: pan workspace create <issue-id>'));
    if (projects.length > 0) {
      console.log(chalk.dim('Tip: Use --all to list workspaces across all registered projects.'));
    }
    return;
  }

  console.log(chalk.bold('\nWorkspaces\n'));

  for (const ws of workspaces) {
    const name = basename(ws.path);
    const status = ws.prunable ? chalk.yellow(' (prunable)') : '';
    console.log(`${chalk.cyan(name)}${status}`);
    console.log(`  Branch: ${ws.branch || chalk.dim('(detached)')}`);
    console.log(`  Path:   ${chalk.dim(ws.path)}`);
    console.log('');
  }
}

interface DestroyOptions {
  force?: boolean;
  project?: string;
  purgeMemory?: boolean;
}

/**
 * PAN-1990: archive (never delete) the issue's workspace row after a
 * successful destroy, mirroring the writer's deleteWorkspace semantics for
 * non-main workspaces (deleteWorkspace refuses kind='main' itself, but the
 * caller checks first so the refusal happens BEFORE any destructive action,
 * not after). --purge-memory additionally removes the memory home —
 * irreversible, opt-in only.
 */
function finalizeWorkspaceRowDestroy(issueIdUpper: string, purgeMemory: boolean | undefined): void {
  const row = getWorkspaceForIssue(issueIdUpper);
  if (!row) return;
  const memoryRoot = purgeMemory ? join(resolveMemoryRoot(row.projectId), row.id) : null;
  deleteWorkspace(row.id);
  if (memoryRoot && existsSync(memoryRoot)) {
    rmSync(memoryRoot, { recursive: true, force: true });
  }
}

export async function destroyCommand(issueId: string, options: DestroyOptions): Promise<void> {
  const spinner = ora('Destroying workspace...').start();

  try {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const folderName = `feature-${normalizedId}`;
    const issueIdUpper = normalizedId.toUpperCase();

    // getWorkspaceForIssue only matches kind='issue' rows, so a defensive,
    // kind-agnostic check is needed here: a kind='main' row is never expected
    // to carry an issueId (pan workspace main never sets one), but nothing
    // stops one from existing, and this guard must catch it if it ever does.
    const mainRowWithThisIssueId = listWorkspaces({ kind: 'main', includeArchived: true })
      .find((ws) => ws.issueId === issueIdUpper);
    if (mainRowWithThisIssueId) {
      spinner.fail(`Refusing to destroy the main workspace for project '${mainRowWithThisIssueId.projectId}'`);
      return exitCli(1);
    }

    // Check if this is a remote workspace
    const metadata = loadWorkspaceMetadataSync(normalizedId);
    if (metadata && metadata.location === 'remote') {
      await destroyRemoteWorkspace(issueId, normalizedId, metadata, spinner, options);
      finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
      return;
    }

    // Try to find project config from registry
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    // Priority 1: Use workspace-manager if project has workspace config
    if (projectConfig?.workspace) {
      spinner.text = 'Removing workspace...';

      const result = await Effect.runPromise(removeWorkspaceFromConfig({
        projectConfig,
        featureName: normalizedId,
      }));

      if (result.success) {
        spinner.succeed('Workspace destroyed!');
        console.log('');
        for (const step of result.steps) {
          console.log(`  ${chalk.green('✓')} ${step}`);
        }
        finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
      } else {
        spinner.fail('Workspace destruction failed');
        for (const error of result.errors) {
          console.error(chalk.red(`  ${error}`));
        }
        return exitCli(1);
      }
      return;
    }

    // Priority 2: Use custom workspace_remove_command (legacy)
    if (projectConfig?.workspace_remove_command) {
      spinner.text = 'Running custom remove command...';

      const cmd = `${projectConfig.workspace_remove_command} ${normalizedId}`;
      try {
        const { stdout } = await execAsync(cmd, {
          cwd: projectConfig.path,
          encoding: 'utf-8',
          timeout: 120000,
        });

        if (stdout) {
          console.log(stdout);
        }

        spinner.succeed('Workspace destroyed via custom command!');
        finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
        return;
      } catch (error: any) {
        spinner.fail(`Custom remove command failed: ${error.message}`);
        return exitCli(1);
      }
    }

    // Priority 3: Simple worktree removal
    let projectRoot: string;

    if (options.project) {
      projectRoot = options.project;
    } else {
      const resolved = resolveProjectFromIssueSync(issueId);
      if (resolved) {
        projectRoot = resolved.projectPath;
      } else {
        projectRoot = process.cwd();
      }
    }

    const workspacePath = join(projectRoot, 'workspaces', folderName);

    if (!existsSync(workspacePath)) {
      const cwdPath = join(process.cwd(), 'workspaces', folderName);
      if (projectRoot !== process.cwd() && existsSync(cwdPath)) {
        projectRoot = process.cwd();
      } else {
        spinner.fail(`Workspace not found: ${workspacePath}`);
        return exitCli(1);
      }
    }

    const finalWorkspacePath = join(projectRoot, 'workspaces', folderName);

    spinner.text = 'Removing git worktree...';
    await Effect.runPromise(
      removeWorktree(projectRoot, finalWorkspacePath).pipe(Effect.provide(nodeServicesLayer)),
    );

    spinner.succeed(`Workspace destroyed: ${folderName}`);
    finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
  } catch (error: any) {
    spinner.fail(error.message);
    if (!options.force) {
      console.log(chalk.dim('Tip: Use --force to remove even with uncommitted changes'));
    }
    return exitCli(1);
  }
}
