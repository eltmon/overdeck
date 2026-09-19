/**
 * `pan task` — read and update xBRIEF item state for one issue (PAN-3917 FR-10).
 *
 * The xBRIEF spec is immutable; item progress lives in the issue's continue
 * file at `<planHome>/.pan/continues/<ISSUE>.xbrief.json`, on the feature
 * branch, committed by this verb. There is no record, no task door, and no
 * sequence to compare against: `pan task done` is corroborated by git — a
 * commit carrying the `Item: <id>` trailer on a branch that has been pushed.
 */

import { join } from 'node:path';

import { Command } from 'commander';

import { resolvePlanHome } from '../../lib/pan-dir/paths.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../lib/projects.js';
import { computeWorkspaceRepoRootsSync, resolveProjectReposForIssueSync } from '../../lib/project-repos.js';
import { getDispatchableItems } from '../../lib/xbrief/dag.js';
import { readWorkspacePlanSync } from '../../lib/xbrief/io.js';
import {
  claimItem,
  ItemNotVerifiable,
  markItemDone,
  readContinueState,
  setItemStatus,
  type ContinueItemState,
} from '../../lib/xbrief/continue-state.js';
import { commitPlanArtifacts, planArtifactCommitMessage } from '../../lib/overdeck/plan-artifact-commit.js';

interface TaskOptions {
  json?: boolean;
}

async function taskAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

interface TaskContext {
  issueId: string;
  workspacePath: string;
  planHome: string;
  doc: ReturnType<typeof readWorkspacePlanSync>;
}

function resolveTaskContext(issue: string): TaskContext & { doc: NonNullable<TaskContext['doc']> } {
  const issueId = issue.toUpperCase();
  const resolved = resolveProjectFromIssueSync(issueId);
  const configured = resolved && getProjectSync(resolved.projectKey);
  if (!resolved || !configured) throw new Error(`Could not resolve a registered project for ${issueId}.`);
  const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) throw new Error(`The xBRIEF for ${issueId} is missing or unreadable. Return the issue to planning before reading task state.`);
  return { issueId, workspacePath, planHome: resolvePlanHome(workspacePath), doc };
}

function print(value: unknown, json: boolean | undefined): void {
  if (json) console.log(JSON.stringify(value, null, 2));
  else if (Array.isArray(value)) {
    for (const item of value as Array<{ id: string; status: string }>) {
      console.log(`${item.id}\t${item.status}`);
    }
  } else {
    const result = value as { itemId?: string; id?: string; status?: string };
    console.log(`${result.itemId ?? result.id}\t${result.status}`);
  }
}

/**
 * Commit the continue file on the branch that owns it. A clean tree is not a
 * failure; anything else is — the continue file IS the item state, and an
 * uncommitted one is invisible to everyone but this checkout.
 */
async function commitContinue(planHome: string, issueId: string): Promise<void> {
  const result = await commitPlanArtifacts({
    cwd: planHome,
    paths: [join('.pan', 'continues')],
    message: planArtifactCommitMessage(issueId),
  });
  if (!result.committed && result.reason !== 'nothing to commit') {
    throw new Error(
      `The continue file for ${issueId} was written but could not be committed: ${result.reason}.\n`
      + `Commit ${join(planHome, '.pan', 'continues')} yourself, then run this again.`,
    );
  }
}

export async function runTaskRead(
  command: 'next' | 'show',
  issue: string,
  itemId: string | undefined,
  options: TaskOptions,
): Promise<void> {
  const { issueId, planHome, doc } = resolveTaskContext(issue);
  if (command === 'show') {
    const item = doc.plan.items.find(({ id }) => id === itemId);
    if (!item) throw new Error(`Task ${itemId} does not exist in the immutable xBRIEF for ${issueId}. Return the issue to planning to change scope.`);
    const state = readContinueState(planHome, issueId)?.items?.[item.id];
    print({ ...item, claimedBy: state?.claimedBy, claimedAt: state?.claimedAt, doneAt: state?.doneAt }, options.json);
    return;
  }
  print(getDispatchableItems(doc, new Set()), options.json);
}

export async function runTaskClaim(issue: string, itemId: string, options: TaskOptions): Promise<void> {
  const { issueId, planHome } = resolveTaskContext(issue);
  const agentId = process.env.OVERDECK_AGENT_ID ?? `cli-${process.pid}`;
  const state = claimItem(planHome, issueId, itemId, agentId);
  await commitContinue(planHome, issueId);
  print({ itemId, ...state }, options.json);
}

/**
 * Every repository root of the issue workspace, plus the plan home. A polyrepo
 * issue commits its work in whichever repo the item touched, and the plan home
 * may be none of them, so the corroborating commit is looked for in all of them.
 */
export function issueRepoRoots(issueId: string, workspacePath: string, planHome: string): string[] {
  const repos = resolveProjectReposForIssueSync(issueId);
  const roots = computeWorkspaceRepoRootsSync(repos, issueId, workspacePath).map((root) => root.dir);
  return [...new Set([...roots, planHome])];
}

export async function runTaskDone(issue: string, itemId: string, options: TaskOptions): Promise<void> {
  const { issueId, planHome, workspacePath } = resolveTaskContext(issue);
  let state: ContinueItemState;
  try {
    state = await markItemDone(planHome, issueId, itemId, {
      requireTrailer: `Item: ${itemId}`,
      requirePushed: true,
      repoRoots: issueRepoRoots(issueId, workspacePath, planHome),
    });
  } catch (error) {
    if (error instanceof ItemNotVerifiable) {
      throw new Error(
        `${itemId} is not done yet: ${error.message}.\n`
        + `Nothing was written. Commit the work with a body line "Item: ${itemId}", push the branch, then run this again.`,
      );
    }
    throw error;
  }
  await commitContinue(planHome, issueId);
  print({ itemId, ...state }, options.json);
}

export async function runTaskStatus(
  status: 'blocked' | 'pending' | 'cancelled',
  issue: string,
  itemId: string,
  options: TaskOptions,
): Promise<void> {
  const { issueId, planHome } = resolveTaskContext(issue);
  setItemStatus(planHome, issueId, itemId, status);
  await commitContinue(planHome, issueId);
  print({ itemId, status }, options.json);
}

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Read and update xBRIEF item state for one issue');
  task.command('next <issue>').option('--json', 'Print JSON')
    .action(async (issue, options) => taskAction(() => runTaskRead('next', issue, undefined, options)));
  task.command('show <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskRead('show', issue, item, options)));
  task.command('claim <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskClaim(issue, item, options)));
  task.command('done <issue> <item>').option('--json', 'Print JSON')
    .description('Record an item as done. Requires a commit carrying "Item: <item>" on a pushed branch.')
    .action(async (issue, item, options) => taskAction(() => runTaskDone(issue, item, options)));
  task.command('block <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('blocked', issue, item, options)));
  task.command('unblock <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('pending', issue, item, options)));
  task.command('reopen <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('pending', issue, item, options)));
  task.command('cancel <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('cancelled', issue, item, options)));
}
