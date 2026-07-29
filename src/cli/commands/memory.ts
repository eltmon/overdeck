import { isAbsolute, relative } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  createResetMarker,
  generateDailySummary,
  getMemoryStatus,
  readMemorySettingsSummary,
  runMemoryDoctor,
  searchMemory,
} from '../../lib/memory/cli.js';
import { backfillMemoryFromTranscripts } from '../../lib/memory/backfill.js';
import { getProjectByKey, getWorkspaceById, listPinnedDocs } from '../../lib/workspaces/resolver.js';
import { pinDoc, unpinDoc } from '../../lib/workspaces/writer.js';
import type { PinScope, ProjectRow } from '../../lib/workspaces/types.js';
import { exitCli } from '../exit.js';

export function createMemoryCommand(): Command {
  const memory = new Command('memory')
    .description('Search and inspect Overdeck memory');

  memory
    .command('search <query>')
    .description('Search memory observations')
    .option('--project <id>', 'Project ID')
    .option('--workspace <id>', 'Workspace ID')
    .option('--issue <id>', 'Issue ID')
    .option('--tag <tag>', 'Filter by tag')
    .option('--sibling', 'Search same-project sibling issues instead of the selected issue')
    .option('--global', 'Search across all registered projects instead of just one')
    .option('--include-archived', 'Include observations hidden by reset markers')
    .option('--limit <n>', 'Maximum results', parseInt)
    .option('--json', 'Output JSON')
    .action(async (query, options) => {
      const results = await searchMemory(query, options);
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
    });

  memory
    .command('status <issue>')
    .description('Show current memory status for an issue')
    .option('--project <id>', 'Project ID', 'overdeck')
    .option('--json', 'Output JSON')
    .action(async (issue, options) => {
      const status = await getMemoryStatus(options.project, issue);
      if (options.json) {
        console.log(JSON.stringify(status ?? null, null, 2));
        return;
      }
      if (!status) {
        console.log(chalk.yellow(`No memory status found for ${issue}.`));
        return;
      }
      console.log(chalk.bold(status.headline));
      console.log(status.summary);
      console.log(chalk.dim(`phase=${status.phase} confidence=${status.confidence}`));
      if (status.nextSteps.length > 0) console.log(`Next: ${status.nextSteps.join('; ')}`);
    });

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
    .command('summary <issue>')
    .description('Generate a daily markdown memory summary')
    .option('--project <id>', 'Project ID', 'overdeck')
    .option('--date <yyyy-mm-dd>', 'Summary date')
    .option('--json', 'Output JSON')
    .action(async (issue, options) => {
      const result = await generateDailySummary({ projectId: options.project, issueId: issue, date: options.date });
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else if (result.status === 'insufficient-data') console.log(chalk.yellow(`Insufficient data: ${result.observationCount} observations found; 3 required.`));
      else if (result.status === 'up-to-date') console.log(chalk.yellow(`Summary already up to date at ${result.path}; ${result.observationCount - (result.previousObservationCount ?? 0)} new observations found, 20 required.`));
      else console.log(chalk.green(`Wrote ${result.observationCount} observations to ${result.path}`));
    });

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
  const projectRelativePath = isAbsolute(docPath) ? relative(project.primaryPath, docPath) : docPath;

  await pinDoc(scope, scopeId, projectRelativePath);
  if (options.json) console.log(JSON.stringify({ scope, scopeId, docPath: projectRelativePath }, null, 2));
  else console.log(chalk.green(`Pinned ${projectRelativePath} for ${scope} ${scopeId}`));
}

export async function memoryUnpinCommand(docPath: string, options: MemoryPinOptions): Promise<void> {
  const resolved = resolvePinTarget(options);
  if (!resolved) return exitCli(1);
  const { scope, scopeId, project } = resolved;
  const projectRelativePath = isAbsolute(docPath) ? relative(project.primaryPath, docPath) : docPath;

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
