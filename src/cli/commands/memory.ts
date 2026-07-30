import { Command } from 'commander';
import chalk from 'chalk';
import {
  createResetMarker,
  generateDailySummary,
  getMemoryStatusForWorkspace,
  getMemoryStatusHistory,
  getMemoryTimeline,
  MEMORY_TIMELINE_DEFAULT_DAYS,
  readMemoryFile,
  readMemorySettingsSummary,
  resolveMemoryWorkspaceTarget,
  runMemoryDoctor,
  searchMemory,
} from '../../lib/memory/cli.js';
import { backfillMemoryFromTranscripts } from '../../lib/memory/backfill.js';
import { resolveContainedPinPath, verifyPinPathContainment } from '../../lib/memory/pin-path.js';
import { getProjectByKey, getWorkspaceById, listPinnedDocs, listWorkspacesForPath } from '../../lib/workspaces/resolver.js';
import { pinDoc, unpinDoc } from '../../lib/workspaces/writer.js';
import type { PinScope, ProjectRow } from '../../lib/workspaces/types.js';
import { exitCli } from '../exit.js';

export interface MemorySearchCommandOptions {
  project?: string;
  workspace?: string;
  issue?: string;
  tag?: string;
  sibling?: boolean;
  global?: boolean;
  /** commander `[path]`-style option: `true` for a bare flag, a string when a value is given. */
  target?: string | true;
  includeArchived?: boolean;
  limit?: number;
  json?: boolean;
}

export async function memorySearchCommand(query: string, options: MemorySearchCommandOptions): Promise<void> {
  let targetPath: string | undefined;
  if (options.target !== undefined) {
    if (options.workspace || options.issue || options.global) {
      console.error(chalk.red('--target cannot be combined with --workspace, --issue, or --global.'));
      return exitCli(1);
    }
    targetPath = options.target === true ? process.cwd() : options.target;
    if (listWorkspacesForPath(targetPath).length === 0) {
      console.log(chalk.yellow(`No workspaces target ${targetPath}.`));
      return;
    }
  }

  let results: Awaited<ReturnType<typeof searchMemory>>;
  try {
    results = await searchMemory(query, { ...options, targetPath });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (results.length === 0) {
    console.log(chalk.yellow('No memory observations matched.'));
    return;
  }
  for (const { observation, score } of results) {
    console.log(chalk.bold(`${observation.issueId} ${observation.timestamp} score=${score}`));
    console.log(`  ${observation.actionStatus ?? observation.summary}`);
    console.log(chalk.dim(`  ${observation.workspaceId} · ${observation.files.join(', ') || 'no files'}`));
  }
}

export interface MemoryStatusCommandOptions {
  project?: string;
  workspace?: string;
  history?: number;
  json?: boolean;
}

/**
 * `pan memory status [issue]` — addressable by `--workspace <id|name>`, by the
 * issue positional, or by cwd, with optional `--history <n>` archived-status
 * recall (PAN-3286 WI-4, FR-5/FR-6).
 */
export async function memoryStatusCommand(issue: string | undefined, options: MemoryStatusCommandOptions): Promise<void> {
  let target: ReturnType<typeof resolveMemoryWorkspaceTarget>;
  try {
    target = resolveMemoryWorkspaceTarget({ projectId: options.project, issueId: issue, workspaceRef: options.workspace });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const status = await getMemoryStatusForWorkspace(target.projectId, target.workspaceId);
  const history = options.history === undefined
    ? []
    : await getMemoryStatusHistory(target.projectId, target.workspaceId, options.history);

  if (options.json) {
    if (options.history === undefined) {
      console.log(JSON.stringify(status ?? null, null, 2));
      return;
    }
    console.log(JSON.stringify({ current: status ?? null, history }, null, 2));
    return;
  }

  if (!status) {
    console.log(chalk.yellow(`No memory status found for ${target.label}.`));
  } else {
    console.log(chalk.bold(status.headline));
    console.log(status.summary);
    console.log(chalk.dim(`phase=${status.phase} confidence=${status.confidence}`));
    if (status.nextSteps.length > 0) console.log(`Next: ${status.nextSteps.join('; ')}`);
  }

  if (options.history === undefined) return;
  if (history.length === 0) {
    console.log(chalk.yellow('No archived statuses retained.'));
    return;
  }
  console.log(chalk.bold(`\nArchived statuses (${history.length}, newest first):`));
  for (const entry of history) {
    console.log(`  ${entry.archivedAt ?? 'unknown-time'} phase=${entry.status.phase} ${entry.status.headline}`);
  }
}

export interface MemoryTimelineCommandOptions {
  workspace?: string;
  days?: number;
  limit?: number;
  json?: boolean;
}

/**
 * `pan memory timeline` — chronological observations for a workspace addressed
 * by `--workspace <id|name>` or by the current directory (PAN-3286 WI-5, FR-8).
 */
export async function memoryTimelineCommand(options: MemoryTimelineCommandOptions): Promise<void> {
  let target: ReturnType<typeof resolveMemoryWorkspaceTarget>;
  try {
    target = resolveMemoryWorkspaceTarget({ workspaceRef: options.workspace });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const observations = await getMemoryTimeline(target.projectId, target.workspaceId, {
    days: options.days,
    limit: options.limit,
  });

  if (options.json) {
    console.log(JSON.stringify(observations, null, 2));
    return;
  }
  if (observations.length === 0) {
    console.log(chalk.yellow(`No observations in the last ${options.days ?? MEMORY_TIMELINE_DEFAULT_DAYS} days for ${target.label}.`));
    return;
  }
  console.log(chalk.bold(`${target.label} — ${observations.length} observations, oldest first`));
  for (const observation of observations) {
    console.log(`${observation.timestamp}  ${observation.actionStatus ?? observation.summary}`);
    console.log(chalk.dim(`  files: ${observation.files.join(', ') || 'none'}`));
  }
}

export interface MemoryReadCommandOptions {
  workspace?: string;
  from?: number;
  lines?: number;
}

/**
 * `pan memory read <path>` — print a file from the resolved workspace's memory
 * home, refusing anything outside it (PAN-3286 WI-5, FR-9, D-9).
 */
export async function memoryReadCommand(path: string, options: MemoryReadCommandOptions): Promise<void> {
  let target: ReturnType<typeof resolveMemoryWorkspaceTarget>;
  try {
    target = resolveMemoryWorkspaceTarget({ workspaceRef: options.workspace });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }

  const result = await readMemoryFile(target.projectId, target.workspaceId, path, {
    from: options.from,
    lines: options.lines,
  });

  if (result.status === 'absolute-path') {
    console.error(chalk.red(`Refusing '${path}': the path must be relative to the workspace's memory home.`));
    return exitCli(1);
  }
  if (result.status === 'escapes-home') {
    console.error(chalk.red(`Refusing '${path}': it resolves outside the workspace's memory home.`));
    return exitCli(1);
  }
  if (result.status === 'unreadable') {
    console.error(chalk.red(`Refusing '${path}': it is not a readable regular file inside the workspace's memory home.`));
    return exitCli(1);
  }

  process.stdout.write(result.content);
}

export interface MemorySummaryCommandOptions {
  project?: string;
  workspace?: string;
  date?: string;
  json?: boolean;
}

/** `pan memory summary [issue]` — same three addressing modes as `status` (PAN-3286 FR-7). */
export async function memorySummaryCommand(issue: string | undefined, options: MemorySummaryCommandOptions): Promise<void> {
  let result: Awaited<ReturnType<typeof generateDailySummary>>;
  try {
    result = await generateDailySummary({
      projectId: options.project,
      issueId: issue,
      workspaceRef: options.workspace,
      date: options.date,
    });
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    return exitCli(1);
  }
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (result.status === 'insufficient-data') console.log(chalk.yellow(`Insufficient data: ${result.observationCount} observations found; 3 required.`));
  else if (result.status === 'up-to-date') console.log(chalk.yellow(`Summary already up to date at ${result.path}; ${result.observationCount - (result.previousObservationCount ?? 0)} new observations found, 20 required.`));
  else console.log(chalk.green(`Wrote ${result.observationCount} observations to ${result.path}`));
}

export function createMemoryCommand(): Command {
  const memory = new Command('memory')
    .description('Search and inspect Overdeck memory');

  memory
    .command('search <query>')
    .description('Search memory observations')
    .option('--project <id>', 'Project ID')
    .option('--workspace <id|name>', 'Workspace id or name')
    .option('--issue <id>', 'Issue ID')
    .option('--tag <tag>', 'Filter by tag')
    .option('--sibling', 'Search same-project sibling issues instead of the selected issue')
    .option('--global', 'Search across all registered projects instead of just one')
    .option('--target [path]', 'Search all workspaces whose path targets a directory (bare flag = cwd); mutually exclusive with --workspace/--issue/--global')
    .option('--include-archived', 'Include observations hidden by reset markers')
    .option('--limit <n>', 'Maximum results', parseInt)
    .option('--json', 'Output JSON')
    .action(memorySearchCommand);

  memory
    .command('status [issue]')
    .description('Show current memory status for an issue, a workspace, or the current directory')
    .option('--project <id>', 'Project ID', 'overdeck')
    .option('--workspace <id|name>', 'Workspace id or name instead of an issue positional')
    .option('--history <n>', 'Also print up to N archived statuses, newest first (max 50)', parseInt)
    .option('--json', 'Output JSON')
    .action(memoryStatusCommand);

  memory
    .command('timeline')
    .description('Print chronological observations for a workspace or the current directory')
    .option('--workspace <id|name>', 'Workspace id or name (defaults to the workspace owning the cwd)')
    .option('--days <n>', `Most recent N days, today counting as day 1 (default ${MEMORY_TIMELINE_DEFAULT_DAYS})`, parseInt)
    .option('--limit <n>', 'Maximum observation rows', parseInt)
    .option('--json', 'Output JSON')
    .action(memoryTimelineCommand);

  memory
    .command('read <path>')
    .description("Print a file from a workspace's memory home (path is relative to that home)")
    .option('--workspace <id|name>', 'Workspace id or name (defaults to the workspace owning the cwd)')
    .option('--from <n>', 'First line to print, 1-based', parseInt)
    .option('--lines <n>', 'Maximum number of lines to print', parseInt)
    .action(memoryReadCommand);

  memory
    .command('reset <scope> <scopeId>')
    .description('Create a memory reset marker')
    .option('--project <id>', 'Project ID', 'overdeck')
    .requiredOption('--reason <text>', 'Reason for the reset marker')
    .option('--from <iso>', 'Reset from timestamp')
    .option('--json', 'Output JSON')
    .action(async (scope, scopeId, options) => {
      const marker = await createResetMarker({
        projectId: options.project,
        scope,
        scopeId,
        reason: options.reason,
        fromTimestamp: options.from,
      });
      if (options.json) console.log(JSON.stringify(marker, null, 2));
      else console.log(chalk.green(`Created reset marker ${marker.id} for ${marker.scope}:${marker.scopeId}`));
    });

  memory
    .command('summary [issue]')
    .description('Generate a daily markdown memory summary for an issue, a workspace, or the current directory')
    .option('--project <id>', 'Project ID', 'overdeck')
    .option('--workspace <id|name>', 'Workspace id or name instead of an issue positional')
    .option('--date <yyyy-mm-dd>', 'Summary date')
    .option('--json', 'Output JSON')
    .action(memorySummaryCommand);

  memory
    .command('doctor')
    .description('Print memory health, pending counts, and provider configuration')
    .option('--project <id>', 'Project ID', 'overdeck')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const result = await runMemoryDoctor({ project: options.project });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.exitCode;
        return;
      }
      console.log(chalk.bold('Memory Doctor'));
      console.log(`Provider: ${result.provider.provider} / ${result.provider.model} (${result.provider.source})`);
      console.log(`Rollup pending threshold: ${result.rollupPendingThreshold}`);
      for (const issue of result.issues) {
        console.log(`${issue.issueId}: health=${issue.health.status} pending=${issue.pendingCount} last_success=${issue.health.last_success ?? 'never'}`);
      }
      if (result.staleActiveAgents.length > 0) {
        console.log(chalk.red('Stale active agents:'));
        for (const agent of result.staleActiveAgents) {
          console.log(chalk.red(`  ${agent.agentId} ${agent.issueId} last_success=${agent.lastSuccess ?? 'never'}`));
        }
      }
      process.exitCode = result.exitCode;
    });

  memory
    .command('backfill')
    .description('Backfill memory observations from historical Claude Code JSONL transcripts')
    .option('--workspace <id>', 'Only backfill sessions resolved to this workspace id')
    .option('--project <id>', 'Only backfill sessions resolved to this project id')
    .option('--dry-run', 'Report matched sessions without extracting or writing anything')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const result = await backfillMemoryFromTranscripts({
        workspaceId: options.workspace,
        projectId: options.project,
        dryRun: options.dryRun,
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const warning of result.warnings) console.log(chalk.yellow(`warning: ${warning}`));
      for (const session of result.sessions) {
        console.log(`${session.transcriptPath}: ${session.status}${session.workspaceId ? ` (workspace ${session.workspaceId})` : ''}`);
      }
      const processed = result.sessions.filter((s) => s.status === 'processed' || s.status === 'dry-run-matched').length;
      console.log(chalk.bold(`${processed}/${result.sessions.length} session(s) matched a workspace.`));
    });

  memory
    .command('pin <doc-path>')
    .description('Pin a doc for prompt-time memory injection (path is stored project-relative)')
    .option('--project <id>', 'Project key to pin at project scope', 'overdeck')
    .option('--workspace <id>', 'Workspace id to pin at workspace scope (overrides --project)')
    .option('--json', 'Output JSON')
    .action(memoryPinCommand);

  memory
    .command('unpin <doc-path>')
    .description('Remove a pinned doc')
    .option('--project <id>', 'Project key the pin was made at project scope', 'overdeck')
    .option('--workspace <id>', 'Workspace id the pin was made at workspace scope (overrides --project)')
    .option('--json', 'Output JSON')
    .action(memoryUnpinCommand);

  memory
    .command('pins')
    .description('List pinned docs for a project or workspace')
    .option('--project <id>', 'Project key to list project-scoped pins for', 'overdeck')
    .option('--workspace <id>', 'Workspace id to list workspace-scoped pins for (overrides --project)')
    .option('--json', 'Output JSON')
    .action(memoryPinsCommand);

  memory
    .command('config')
    .description('Show memory provider and rollup configuration')
    .option('--json', 'Output JSON')
    .action(async (options) => {
      const summary = await readMemorySettingsSummary();
      if (options.json) console.log(JSON.stringify(summary, null, 2));
      else {
        console.log(`Provider: ${summary.provider.provider} / ${summary.provider.model} (${summary.provider.source})`);
        console.log(`Rollup pending threshold: ${summary.rollupPendingThreshold}`);
      }
    });

  return memory;
}

export interface MemoryPinOptions {
  workspace?: string;
  project?: string;
  json?: boolean;
}

export async function memoryPinCommand(docPath: string, options: MemoryPinOptions): Promise<void> {
  const resolved = resolvePinTarget(options);
  if (!resolved) return exitCli(1);
  const { scope, scopeId, project } = resolved;
  // Symlink-safe: a lexically-contained path can still point outside the
  // project root through an in-project symlink, so pin creation must verify
  // the REAL target, not just the path string.
  const projectRelativePath = await verifyPinPathContainment(project.primaryPath, docPath);
  if (projectRelativePath === null) {
    console.error(chalk.red(`Refusing to pin '${docPath}': it must resolve to a real file inside the project root '${project.primaryPath}'.`));
    return exitCli(1);
  }

  await pinDoc(scope, scopeId, projectRelativePath);
  if (options.json) console.log(JSON.stringify({ scope, scopeId, docPath: projectRelativePath }, null, 2));
  else console.log(chalk.green(`Pinned ${projectRelativePath} for ${scope} ${scopeId}`));
}

export async function memoryUnpinCommand(docPath: string, options: MemoryPinOptions): Promise<void> {
  const resolved = resolvePinTarget(options);
  if (!resolved) return exitCli(1);
  const { scope, scopeId, project } = resolved;
  const projectRelativePath = resolveContainedPinPath(project.primaryPath, docPath);
  if (projectRelativePath === null) {
    console.error(chalk.red(`Refusing to unpin '${docPath}': it resolves outside the project root '${project.primaryPath}'.`));
    return exitCli(1);
  }

  await unpinDoc(scope, scopeId, projectRelativePath);
  if (options.json) console.log(JSON.stringify({ scope, scopeId, docPath: projectRelativePath }, null, 2));
  else console.log(chalk.green(`Unpinned ${projectRelativePath} for ${scope} ${scopeId}`));
}

export async function memoryPinsCommand(options: MemoryPinOptions): Promise<void> {
  const resolved = resolvePinTarget(options);
  if (!resolved) return exitCli(1);
  const { scope, scopeId } = resolved;
  const pins = listPinnedDocs(scope, scopeId);
  if (options.json) {
    console.log(JSON.stringify(pins, null, 2));
    return;
  }
  if (pins.length === 0) {
    console.log(chalk.yellow(`No pinned docs for ${scope} ${scopeId}.`));
    return;
  }
  for (const pin of pins) console.log(pin.docPath);
}

/**
 * Resolves pin/unpin/pins scope+scopeId from --workspace|--project, plus the
 * owning project (needed to make an absolute doc-path project-relative —
 * memory-pins stores paths project-relative regardless of pin scope, since a
 * workspace is one worktree of the same project repo).
 */
function resolvePinTarget(options: { workspace?: string; project?: string }): { scope: PinScope; scopeId: string; project: ProjectRow } | null {
  if (options.workspace) {
    const workspace = getWorkspaceById(options.workspace);
    if (!workspace) {
      console.error(chalk.red(`No workspace found with id '${options.workspace}'`));
      return null;
    }
    const project = getProjectByKey(workspace.projectId);
    if (!project) {
      console.error(chalk.red(`No project registered for workspace '${options.workspace}' (project key '${workspace.projectId}')`));
      return null;
    }
    return { scope: 'workspace', scopeId: workspace.id, project };
  }

  const projectKey = options.project ?? 'overdeck';
  const project = getProjectByKey(projectKey);
  if (!project) {
    console.error(chalk.red(`No project registered with key '${projectKey}'`));
    return null;
  }
  return { scope: 'project', scopeId: projectKey, project };
}
