/**
 * `pan task` — read and update xBRIEF item state for one issue (PAN-3917 FR-10).
 *
 * The xBRIEF spec is immutable; item progress lives in the issue's continue
 * file at `<planHome>/.pan/continues/<ISSUE>.xbrief.json`, on the feature
 * branch, committed by this verb. There is no record, no task door, and no
 * sequence to compare against: `pan task done` is corroborated by git — a
 * commit carrying the `Item: <id>` trailer on a branch that has been pushed.
 * `pan task done <issue> <item...>` takes one or more ids and records all of
 * them in one continue commit, or none of them if any id's trailer or push
 * check fails (PAN-5118).
 */

import { join } from 'node:path';

import { Command } from 'commander';

import { resolvePlanHome } from '../../lib/pan-dir/paths.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../lib/projects.js';
import { computeWorkspaceRepoRoots, resolveProjectReposForIssue } from '../../lib/project-repos.js';
import { getDispatchableItems } from '../../lib/xbrief/dag.js';
import { readWorkspacePlanSync } from '../../lib/xbrief/io.js';
import {
  ItemNotVerifiable,
  markItemsDone,
  readContinueState,
  setItemStatus,
  type ContinueItemState,
} from '../../lib/xbrief/continue-state.js';
import {
  claimItemChecked,
  formatClaimRefusal,
  resolveClaimantId,
  type HolderLiveness,
} from '../../lib/xbrief/claim-check.js';
import { taskStateLockPath, withTaskStateLock } from '../../lib/xbrief/task-state-lock.js';
import { commitPlanArtifacts, planArtifactCommitMessage } from '../../lib/overdeck/plan-artifact-commit.js';
import { formatBlockerRef, parseBlockerRefs } from '../../lib/cloister/blocker-refs.js';
import { appendPipelineEntry } from '../../lib/cloister/pipeline-journal.js';
import { resolveGitHubIssue } from '../../lib/tracker-utils.js';

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

export interface TaskClaimOptions extends TaskOptions {
  steal?: boolean;
}

export interface TaskClaimDeps {
  /** Holder liveness probe. Injected by the test; defaults to {@link probeHolder}. */
  readonly probe?: (holder: string) => Promise<HolderLiveness>;
}

/**
 * Refuses the claim (FR-1..FR-5) unless the item's holder is dead or the
 * claimant itself, or the target's `files_scope` overlaps an active claim
 * held live/indeterminate. `--steal` overrides both refusal kinds (FR-9). The
 * whole check-and-write runs under the task-state lock (FR-10) so a
 * concurrent `pan task claim` can't race the read.
 */
export async function runTaskClaim(
  issue: string,
  itemId: string,
  options: TaskClaimOptions,
  deps: TaskClaimDeps = {},
): Promise<void> {
  const { issueId, planHome, doc } = resolveTaskContext(issue);
  const claimant = resolveClaimantId();
  const lockPath = await taskStateLockPath(planHome);
  const { state, overridden } = await withTaskStateLock(lockPath, async () => {
    const result = await claimItemChecked(planHome, issueId, itemId, claimant, {
      items: doc.plan.items,
      probe: deps.probe,
      steal: options.steal,
    });
    await commitContinue(planHome, issueId);
    return result;
  });
  for (const refusal of overridden) {
    console.error(`--steal overrode: ${formatClaimRefusal(itemId, refusal)}`);
  }
  print({ itemId, ...state }, options.json);
}

/**
 * Every repository root of the issue workspace, plus the plan home. A polyrepo
 * issue commits its work in whichever repo the item touched, and the plan home
 * may be none of them, so the corroborating commit is looked for in all of them.
 */
export function issueRepoRoots(issueId: string, workspacePath: string, planHome: string): string[] {
  const repos = resolveProjectReposForIssue(issueId);
  const roots = computeWorkspaceRepoRoots(repos, issueId, workspacePath).map((root) => root.dir);
  return [...new Set([...roots, planHome])];
}

/**
 * The refusal for ids git cannot corroborate. One id keeps the pre-PAN-5118
 * wording exactly. Several ids put every missing-trailer id on one line, so a
 * large refusal stays inside the self-job runner's 16 KiB stderr tail.
 */
function notDoneMessage(itemIds: readonly string[], repoRoots: readonly string[], error: ItemNotVerifiable): string {
  if (itemIds.length === 1) {
    const [itemId] = itemIds;
    const reason = error.failures[0]?.reason ?? error.message;
    return `${itemId} is not done yet: ${reason}.\n`
      + `Nothing was written. Commit the work with a body line "Item: ${itemId}", push the branch, then run this again.`;
  }
  const missing = error.failures.filter((failure) => failure.kind === 'missing-trailer').flatMap((failure) => failure.itemIds);
  const unpushed = error.failures.filter((failure) => failure.kind === 'unpushed');
  const failing = new Set(error.failures.flatMap((failure) => failure.itemIds));
  return [
    `${failing.size} of ${itemIds.length} items are not done yet. Nothing was written.`,
    ...(missing.length > 0 ? [`  - No commit in ${repoRoots.join(', ')} carries the line "Item: <id>" for: ${missing.join(', ')}`] : []),
    ...unpushed.map((failure) => `  - ${failure.reason}`),
    ...(error.failures.length === 0 ? [`  - ${error.message}`] : []),
    'Commit the missing work with one body line "Item: <id>" per id, push the branch, then run this again.',
  ].join('\n');
}

export async function runTaskDone(issue: string, itemIds: readonly string[], options: TaskOptions): Promise<void> {
  const { issueId, planHome, workspacePath } = resolveTaskContext(issue);
  const ids = [...new Set(itemIds)];
  const repoRoots = issueRepoRoots(issueId, workspacePath, planHome);
  const lockPath = await taskStateLockPath(planHome);
  let states: Record<string, ContinueItemState>;
  try {
    states = await withTaskStateLock(lockPath, async () => {
      const result = await markItemsDone(planHome, issueId, ids, { requirePushed: true, repoRoots });
      await commitContinue(planHome, issueId);
      return result;
    });
  } catch (error) {
    if (error instanceof ItemNotVerifiable) throw new Error(notDoneMessage(ids, repoRoots, error));
    throw error;
  }
  const results = ids.map((itemId) => ({ itemId, ...states[itemId] }));
  if (results.length === 1) print(results[0], options.json);
  else if (options.json) console.log(JSON.stringify(results, null, 2));
  else for (const result of results) console.log(`${result.itemId}\t${result.status}`);
}

export async function runTaskStatus(
  status: 'blocked' | 'pending' | 'cancelled',
  issue: string,
  itemId: string,
  options: TaskOptions,
): Promise<void> {
  const { issueId, planHome } = resolveTaskContext(issue);
  const lockPath = await taskStateLockPath(planHome);
  await withTaskStateLock(lockPath, async () => {
    setItemStatus(planHome, issueId, itemId, status);
    await commitContinue(planHome, issueId);
  });
  print({ itemId, status }, options.json);
}

export interface TaskBlockOptions extends TaskOptions {
  on?: string[];
}

/**
 * PAN-4451: `pan task block`. With `--on`, the refs are validated before
 * anything is written, and the declaration is journaled as
 * `blocked.declared` so the blocker-wake patrol can wake the agent once every
 * blocker has merged. Without `--on` it is the plain status write.
 */
export async function runTaskBlock(issue: string, itemId: string, options: TaskBlockOptions): Promise<void> {
  if (!options.on) return runTaskStatus('blocked', issue, itemId, options);
  const { issueId, planHome, workspacePath } = resolveTaskContext(issue);
  const refs = parseBlockerRefs(options.on, {
    blockedIssueId: issueId,
    isKnownIssue: (id) => resolveProjectFromIssueSync(id) !== null,
    blockedIssueRepo: () => {
      const resolved = resolveGitHubIssue(issueId);
      return resolved.isGitHub ? `${resolved.owner}/${resolved.repo}` : null;
    },
  });
  const lockPath = await taskStateLockPath(planHome);
  await withTaskStateLock(lockPath, async () => {
    setItemStatus(planHome, issueId, itemId, 'blocked');
    await commitContinue(planHome, issueId);
  });
  const blockers = refs.map(formatBlockerRef);
  appendPipelineEntry(workspacePath, {
    type: 'blocked.declared',
    issueId,
    source: 'pan-task-block',
    data: { item: itemId, blockers },
  });
  if (options.json) print({ itemId, status: 'blocked', blockers }, true);
  else console.log(`${itemId}\tblocked\twaits on ${blockers.join(', ')}`);
}

export function registerTaskCommands(program: Command): void {
  const task = program.command('task').description('Read and update xBRIEF item state for one issue');
  task.command('next <issue>').option('--json', 'Print JSON')
    .action(async (issue, options) => taskAction(() => runTaskRead('next', issue, undefined, options)));
  task.command('show <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskRead('show', issue, item, options)));
  task.command('claim <issue> <item>').option('--json', 'Print JSON')
    .option('--steal', 'Claim even when a running agent holds this item or an overlapping one (foreman/operator override)')
    .action(async (issue, item, options) => taskAction(() => runTaskClaim(issue, item, options)));
  task.command('done <issue> <items...>').option('--json', 'Print JSON')
    .description('Record one or more items as done in one continue commit. Each id needs a commit carrying "Item: <id>" on a pushed branch; if any id lacks one, nothing is written.')
    .action(async (issue, items, options) => taskAction(() => runTaskDone(issue, items, options)));
  task.command('block <issue> <item>').option('--json', 'Print JSON')
    .option('--on <refs...>', 'Issues or PRs this item waits on (PAN-123, #45, owner/repo#45, PR URL); Overdeck wakes the agent when all have merged')
    .action(async (issue, item, options) => taskAction(() => runTaskBlock(issue, item, options)));
  task.command('unblock <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('pending', issue, item, options)));
  task.command('reopen <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('pending', issue, item, options)));
  task.command('cancel <issue> <item>').option('--json', 'Print JSON')
    .action(async (issue, item, options) => taskAction(() => runTaskStatus('cancelled', issue, item, options)));
}
