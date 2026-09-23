import { exitCli } from '../exit.js';
import chalk from 'chalk';
import ora from 'ora';
import { exec, execFile } from 'child_process';
import { existsSync, readdirSync, rmSync } from 'fs';
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
import { resolveIssueWorkspaceDirs, type IssueWorkspaceDir, type IssueWorkspaceShape } from '../../lib/workspaces/shapes.js';
import { deleteWorkspace } from '../../lib/workspaces/writer.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface ListOptions {
  json?: boolean;
  all?: boolean;
  kind?: WorkspaceKind;
  archived?: boolean;
  stale?: boolean;
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

export interface StaleWorkspaceRow {
  name: string;
  path: string;
  branch: string | null;
  merged: boolean | null;
  sizeBytes: number | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return chalk.dim('(unknown)');
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

async function dirSizeBytes(path: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('du', ['-sb', path], { encoding: 'utf-8' });
    const parsed = parseInt(stdout.trim().split(/\s/)[0] ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Local-only merged check: is `branch` an ancestor of origin's default (PAN-3887). Null when undeterminable. */
async function isBranchMerged(projectRoot: string, branch: string | null): Promise<boolean | null> {
  if (!branch) return null;
  try {
    let defaultBranch = 'main';
    try {
      const { stdout } = await execFileAsync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: projectRoot, encoding: 'utf-8' });
      const ref = stdout.trim().split('/').pop();
      if (ref) defaultBranch = ref;
    } catch { /* fall back to main */ }
    await execFileAsync('git', ['merge-base', '--is-ancestor', branch, `origin/${defaultBranch}`], { cwd: projectRoot });
    return true;
  } catch (error: any) {
    // Exit code 1 = not an ancestor (not merged); anything else = undeterminable.
    if (typeof error?.code === 'number' && error.code === 1) return false;
    return null;
  }
}

/**
 * PAN-3887: reclaim candidates under `<projectRoot>/workspaces/` — every
 * `feature-*` directory with on-disk size and a local merged-into-default
 * marker. Local-only heuristic (no tracker or network calls): a merged branch
 * whose directory still sits on disk is what piled up when the Deacon's
 * close-out janitor was frozen.
 */
export async function collectStaleWorkspaceRows(projectRoot: string): Promise<StaleWorkspaceRow[]> {
  const workspacesDir = join(projectRoot, 'workspaces');
  let entries: string[] = [];
  try {
    entries = readdirSync(workspacesDir);
  } catch {
    return [];
  }
  const names = entries.filter((name) => name.startsWith('feature-') && existsSync(join(workspacesDir, name))).sort();
  const worktrees = await Effect.runPromise(
    listWorktrees(projectRoot).pipe(Effect.provide(nodeServicesLayer)),
  ).catch(() => [] as WorktreeInfo[]);
  const branchByPath = new Map(worktrees.map((wt) => [wt.path, wt.branch ?? null]));

  const rows: StaleWorkspaceRow[] = [];
  for (const name of names) {
    const path = join(workspacesDir, name);
    const branch = branchByPath.get(path) ?? null;
    const [merged, sizeBytes] = await Promise.all([
      isBranchMerged(projectRoot, branch),
      dirSizeBytes(path),
    ]);
    rows.push({ name, path, branch, merged, sizeBytes });
  }
  rows.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
  return rows;
}

async function staleListCommand(options: ListOptions, projectRoots: string[]): Promise<void> {
  const rows = (await Promise.all(projectRoots.map((root) => collectStaleWorkspaceRows(root)))).flat();
  const candidates = rows.filter((row) => row.merged !== false);
  if (options.json) {
    console.log(JSON.stringify(candidates, null, 2));
    return;
  }
  if (candidates.length === 0) {
    console.log(chalk.dim('No stale workspaces (merged branches still on disk) found.'));
    return;
  }
  console.log(chalk.bold('\nStale workspaces (merged, still on disk)\n'));
  for (const row of candidates) {
    const mergedTag = row.merged === true ? chalk.green('merged') : chalk.yellow('unknown');
    console.log(`${chalk.cyan(row.name)} [${mergedTag}] ${formatBytes(row.sizeBytes)}`);
    console.log(`  Branch: ${row.branch || chalk.dim('(detached)')}`);
    console.log(`  Path:   ${chalk.dim(row.path)}`);
    console.log('');
  }
  console.log(chalk.dim(`Reclaim with: pan workspace destroy <id>  (removes base, strike, and slot shapes)`));
}

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

  // PAN-3887: reclaim view — merged branches still sitting on disk with sizes.
  if (options.stale) {
    if (projects.length > 0 && options.all) {
      const roots = projects.map((p) => p.config.path).filter((p) => existsSync(join(p, '.git')));
      await staleListCommand(options, roots);
      return;
    }
    await staleListCommand(options, [process.cwd()]);
    return;
  }

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
  shape?: string;
}

const VALID_DESTROY_SHAPES: readonly string[] = ['base', 'strike', 'slot', 'all'];

/** Best-effort `git branch -D` of a shape's canonical branch — returns the step text or null. */
async function deleteBranchBestEffort(repoPath: string, branch: string): Promise<string | null> {
  try {
    await execFileAsync('git', ['branch', '-D', branch], { cwd: repoPath });
    return `Deleted branch ${branch}`;
  } catch {
    return null;
  }
}

function shapeFilterError(shape: string): string {
  return `Invalid --shape '${shape}'. Expected one of: ${VALID_DESTROY_SHAPES.join(', ')}`;
}

function noShapesFoundError(issueLower: string, issueId: string, workspacesDir: string, shape: string): string {
  const wanted = shape === 'all' ? 'base, strike, or slot' : shape;
  return `No ${wanted} workspace found for ${issueId} under ${workspacesDir} ` +
    `(looked for feature-${issueLower}, feature-${issueLower}-strike, feature-${issueLower}-slot-N). ` +
    `See reclaim candidates with: pan workspace list --stale`;
}

/**
 * PAN-1990: archive (never delete) the issue's workspace row after a
 * successful destroy, mirroring the writer's deleteWorkspace semantics for
 * non-main workspaces (deleteWorkspace refuses kind='main' itself, but the
 * caller checks first so the refusal happens BEFORE any destructive action,
 * not after). --purge-memory additionally removes the memory home —
 * irreversible, opt-in only.
 */
async function finalizeWorkspaceRowDestroy(issueIdUpper: string, purgeMemory: boolean | undefined): Promise<void> {
  const row = getWorkspaceForIssue(issueIdUpper);
  if (!row) return;
  const memoryRoot = purgeMemory ? join(resolveMemoryRoot(row.projectId), row.id) : null;
  await deleteWorkspace(row.id);
  if (memoryRoot && existsSync(memoryRoot)) {
    rmSync(memoryRoot, { recursive: true, force: true });
  }
}

export async function destroyCommand(issueId: string, options: DestroyOptions): Promise<void> {
  const spinner = ora('Destroying workspace...').start();

  try {
    const normalizedId = issueId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const issueLower = normalizedId;
    const issueIdUpper = normalizedId.toUpperCase();
    const shapeFilter = options.shape ?? 'all';
    if (!VALID_DESTROY_SHAPES.includes(shapeFilter)) {
      spinner.fail(shapeFilterError(shapeFilter));
      return exitCli(1);
    }
    const wanted = (dir: IssueWorkspaceDir): boolean => shapeFilter === 'all' || dir.shape === (shapeFilter as IssueWorkspaceShape);

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
      await finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
      return;
    }

    // Try to find project config from registry
    const teamPrefix = extractTeamPrefix(issueId);
    const projectConfig = teamPrefix ? findProjectByTeamSync(teamPrefix) : null;

    // Priority 1: Use workspace-manager if project has workspace config.
    // PAN-3887: destroy every existing shape (base, strike, slots), not just
    // the base folder — finished strike workspaces were previously unreachable.
    if (projectConfig?.workspace) {
      const workspacesDir = join(projectConfig.path, projectConfig.workspace.workspaces_dir || 'workspaces');
      const targets = resolveIssueWorkspaceDirs(workspacesDir, issueLower).filter(wanted);
      if (targets.length === 0) {
        spinner.fail(noShapesFoundError(issueLower, issueId, workspacesDir, shapeFilter));
        return exitCli(1);
      }
      spinner.text = `Removing workspace (${targets.map((t) => t.name).join(', ')})...`;

      const steps: string[] = [];
      const errors: string[] = [];
      for (const target of targets) {
        const result = await removeWorkspaceFromConfig({
          projectConfig,
          featureName: target.name.replace(/^feature-/, ''),
        });
        steps.push(...result.steps.map((step) => `${target.name}: ${step}`));
        errors.push(...result.errors);
        const branchStep = await deleteBranchBestEffort(projectConfig.path, target.branch);
        if (branchStep) steps.push(`${target.name}: ${branchStep}`);
      }

      if (errors.length === 0) {
        spinner.succeed(`Workspace destroyed: ${targets.map((t) => t.name).join(', ')}`);
        console.log('');
        for (const step of steps) {
          console.log(`  ${chalk.green('✓')} ${step}`);
        }
        await finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
      } else {
        spinner.fail('Workspace destruction failed');
        for (const error of errors) {
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
        await finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
        return;
      } catch (error: any) {
        spinner.fail(`Custom remove command failed: ${error.message}`);
        return exitCli(1);
      }
    }

    // Priority 3: Simple worktree removal (PAN-3887: all shapes, not just base)
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

    let workspacesDir = join(projectRoot, 'workspaces');
    let targets = resolveIssueWorkspaceDirs(workspacesDir, issueLower).filter(wanted);
    if (targets.length === 0 && projectRoot !== process.cwd()) {
      const cwdDir = join(process.cwd(), 'workspaces');
      const cwdTargets = resolveIssueWorkspaceDirs(cwdDir, issueLower).filter(wanted);
      if (cwdTargets.length > 0) {
        projectRoot = process.cwd();
        workspacesDir = cwdDir;
        targets = cwdTargets;
      }
    }
    if (targets.length === 0) {
      spinner.fail(noShapesFoundError(issueLower, issueId, workspacesDir, shapeFilter));
      return exitCli(1);
    }

    spinner.text = `Removing git worktree(s): ${targets.map((t) => t.name).join(', ')}...`;
    for (const target of targets) {
      await Effect.runPromise(
        removeWorktree(projectRoot, target.path).pipe(Effect.provide(nodeServicesLayer)),
      );
      await deleteBranchBestEffort(projectRoot, target.branch);
    }

    spinner.succeed(`Workspace destroyed: ${targets.map((t) => t.name).join(', ')}`);
    await finalizeWorkspaceRowDestroy(issueIdUpper, options.purgeMemory);
  } catch (error: any) {
    spinner.fail(error.message);
    if (!options.force) {
      console.log(chalk.dim('Tip: Use --force to remove even with uncommitted changes'));
    }
    return exitCli(1);
  }
}
