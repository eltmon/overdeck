import { hostname } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';

import { applyTaskStatusChange, type TaskStatusChange } from '../../lib/pan-dir/task-door.js';
import { isPidDead } from '../../lib/pan-dir/fs-lock.js';
import { readIssueRecordSync } from '../../lib/pan-dir/record.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../lib/projects.js';
import { getDispatchableItems } from '../../lib/xbrief/dag.js';
import { readWorkspacePlanSync } from '../../lib/xbrief/io.js';

interface TaskOptions {
  json?: boolean;
  reason?: string;
  expectedSequence?: string;
  force?: boolean;
}

async function taskAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function resolveTaskContext(issue: string) {
  const issueId = issue.toUpperCase();
  const resolved = resolveProjectFromIssueSync(issueId);
  const configured = resolved && getProjectSync(resolved.projectKey);
  if (!resolved || !configured) throw new Error(`Could not resolve a registered project for ${issueId}.`);
  const project = { ...configured, path: resolved.projectPath };
  const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) throw new Error(`The xBRIEF for ${issueId} is missing or unreadable. Return the issue to planning before reading task state.`);
  return { issueId, project, doc };
}

function print(value: unknown, json: boolean | undefined): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (Array.isArray(value)) {
    for (const item of value as Array<{ id: string; status: string; staleClaim?: boolean }>) {
      console.log(`${item.id}\t${item.status}${item.staleClaim ? '\tstale claim' : ''}`);
    }
  } else {
    const result = value as { issueId?: string; itemId?: string; id?: string; status?: string; sequence?: number };
    console.log(`${result.itemId ?? result.id}\t${result.status}${result.sequence === undefined ? '' : `\tsequence ${result.sequence}`}`);
  }
}

export async function runTaskRead(command: 'next' | 'show', issue: string, itemId: string | undefined, options: TaskOptions): Promise<void> {
  const { issueId, project, doc } = resolveTaskContext(issue);
  const record = readIssueRecordSync(project, issueId);
  if (command === 'show') {
    const item = doc.plan.items.find(({ id }) => id === itemId);
    if (!item) throw new Error(`Task ${itemId} does not exist in the immutable xBRIEF for ${issueId}. Return the issue to planning to change scope.`);
    print({ ...item, claim: record?.tasks?.claims[item.id], sequence: record?.tasks?.sequence ?? 0 }, options.json);
    return;
  }
  const ready = getDispatchableItems(doc, new Set()).map((item) => ({ ...item, staleClaim: false }));
  const stale = doc.plan.items.flatMap((item) => {
    const claim = record?.tasks?.claims[item.id];
    return claim && claim.host === hostname() && isPidDead(claim.pid) ? [{ ...item, staleClaim: true }] : [];
  });
  print([...ready, ...stale], options.json);
}

export async function runTaskMutation(type: TaskStatusChange['type'], issue: string, itemId: string, options: TaskOptions): Promise<void> {
  const { issueId, project } = resolveTaskContext(issue);
  const expectedSequence = options.expectedSequence === undefined ? undefined : Number(options.expectedSequence);
  if (expectedSequence !== undefined && !Number.isInteger(expectedSequence)) throw new Error('--expected-sequence must be an integer.');
  const result = await applyTaskStatusChange(project, issueId, {
    type,
    itemId,
    reason: options.reason,
    expectedSequence,
    force: options.force,
    writerId: process.env.OVERDECK_AGENT_ID ?? `cli-${process.pid}@${hostname()}`,
  });
  print(result, options.json);
}

function mutation(command: Command, type: TaskStatusChange['type'], reasonRequired = false): Command {
  const configured = reasonRequired
    ? command.requiredOption('--reason <text>', 'Reason for the status change')
    : command.option('--reason <text>', 'Reason for the status change');
  return configured
    .option('--expected-sequence <n>', 'Require the current task sequence')
    .option('--force', 'Override a non-terminal transition or claim owner; requires --reason')
    .option('--json', 'Print JSON')
    .action(async (issue: string, itemId: string, options: TaskOptions) => taskAction(() => runTaskMutation(type, issue, itemId, options)));
}

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Read and update xBRIEF task state for one issue');
  task.command('next <issue>').option('--json', 'Print JSON').action(async (issue, options) => taskAction(() => runTaskRead('next', issue, undefined, options)));
  task.command('show <issue> <item>').option('--json', 'Print JSON').action(async (issue, item, options) => taskAction(() => runTaskRead('show', issue, item, options)));
  mutation(task.command('claim <issue> <item>'), 'claim');
  mutation(task.command('done <issue> <item>'), 'done');
  mutation(task.command('block <issue> <item>'), 'block', true);
  mutation(task.command('unblock <issue> <item>'), 'unblock');
  // PAN-3691: canonical recovery for a task falsely marked completed (e.g. a
  // swarm slot that merged with no current-item changes). Resets to pending.
  mutation(task.command('reopen <issue> <item>'), 'reopen', true);
  mutation(task.command('cancel <issue> <item>'), 'cancel', true);
}
