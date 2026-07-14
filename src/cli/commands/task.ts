import { Command } from 'commander';
import chalk from 'chalk';

import { resolveBareNumericIdSync } from '../../lib/issue-id.js';
import { getIssueWorkspacePath } from '../../lib/pan-dir/record.js';
import { runTaskCommand } from '../../lib/vbrief/dag-cli.js';
import type { TaskCommand } from '../../lib/vbrief/dag.js';

interface TaskOptions {
  json?: boolean;
  reason?: string;
  workspace?: string;
}

function resolveWorkspace(issueId: string, workspace?: string): string {
  const path = workspace ?? getIssueWorkspacePath(issueId);
  if (!path) throw new Error(`No project or workspace found for ${issueId}`);
  return path;
}

function resolveIssueId(id: string): string {
  const issueId = resolveBareNumericIdSync(id);
  if (!issueId) throw new Error(`Could not resolve issue: ${id}`);
  return issueId;
}

function printResult(result: unknown, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const values = Array.isArray(result) ? result : ['item' in (result as object)
    ? (result as { item: unknown }).item
    : result];
  for (const value of values) {
    const item = value as { id: string; title: string; status: string };
    console.log(`${chalk.cyan(item.id)}  ${item.title}  ${chalk.dim(`[${item.status}]`)}`);
  }
}

export function createTaskCommand(): Command {
  const task = new Command('task')
    .description('Read and update the vBRIEF checklist for an issue');

  const addReadCommand = (name: 'next' | 'show', itemRequired: boolean): void => {
    const command = task.command(itemRequired ? `${name} <issueId> <itemId>` : `${name} <issueId>`)
      .option('--workspace <path>', 'Workspace path (auto-detected if omitted)')
      .option('--json', 'Print JSON');
    command.action((id: string, itemIdOrOptions: string | TaskOptions, maybeOptions?: TaskOptions) => {
      const options = (itemRequired ? maybeOptions : itemIdOrOptions) as TaskOptions;
      const issueId = resolveIssueId(id);
      const itemId = itemRequired ? itemIdOrOptions as string : undefined;
      printResult(runTaskCommand(name, {
        issueId,
        itemId,
        workspacePath: resolveWorkspace(issueId, options.workspace),
      }), options.json);
    });
  };

  addReadCommand('next', false);
  addReadCommand('show', true);

  for (const name of ['claim', 'done', 'block', 'unblock', 'cancel'] as TaskCommand[]) {
    task.command(`${name} <issueId> <itemId>`)
      .option('--workspace <path>', 'Workspace path (auto-detected if omitted)')
      .option('--reason <text>', 'Record why the task status changed')
      .option('--json', 'Print JSON')
      .action((id: string, itemId: string, options: TaskOptions) => {
        try {
          const issueId = resolveIssueId(id);
          printResult(runTaskCommand(name, {
            issueId,
            itemId,
            reason: options.reason,
            workspacePath: resolveWorkspace(issueId, options.workspace),
          }), options.json);
        } catch (error) {
          console.error(chalk.red(`Error: ${(error as Error).message}`));
          process.exitCode = 1;
        }
      });
  }

  return task;
}
