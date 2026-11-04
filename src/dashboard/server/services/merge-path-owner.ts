/**
 * The merge path owner (PAN-4970).
 *
 * The per-PR auto-merge scheduler (`auto-merge-scheduler.ts`) and the UAT
 * batch reconciler (`uat-reconciler.ts`) both act on every ready feature, so
 * a feature with nothing held for UAT is scheduled AND batched on the same
 * tick: the batch member leaves the ready set the scheduler just claimed,
 * and the generation it was in is invalidated. `mergePathOwner` is the one
 * answer to "which path owns this feature right now" so the reconciler can
 * drop what the scheduler already owns before it ever assembles a batch
 * with it.
 *
 * Rule order, first match wins:
 *
 *   1. the executor's kill switch (`OVERDECK_DISABLE_AUTO_MERGE=1`) is set
 *      => batch (the scheduler never schedules the feature);
 *   2. {@link module:auto-merge-scheduler.policyRefusal}-shaped: the door's
 *      forge-free policy check (`autoMergePolicyRefusal`, held/closed/train
 *      off) refuses => batch;
 *   3. the Deft human-merge hold applies => batch;
 *   4. the issue's newest `pending_auto_merges` row is `pending` or
 *      `merging` => per-pr: the scheduler already owns this one;
 *   5. the project is GitLab, or
 *   6. the project is polyrepo
 *      (the scheduler never schedules either) => batch;
 *   7. the newest row is `cancelled` (the operator stopped it; only the
 *      operator re-schedules) => batch;
 *   8. the newest row is `failed` or `blocked`: per-pr only when
 *      {@link latestAutoMergeAllowsSchedule} says the scheduler can re-arm
 *      it for the PR's current head, else batch (the row's stuck at this
 *      head and nothing re-arms it);
 *   9. otherwise => per-pr: the scheduler owns every ready feature it has
 *      not explicitly skipped above.
 *
 * `perPrTrainActiveForProject` folds rules 1, 5 and 6 into the project-level
 * question the scheduler itself answers before ever reading a PR: a kill
 * switch, a GitLab forge, or a polyrepo workspace all mean the scheduler
 * never runs for this project, so assigning a feature here to "per-pr" would
 * leave it with no merge path at all.
 *
 * This module never writes `pending_auto_merges` — it only reads state the
 * scheduler and the schedule door already own.
 */
import type { ProjectConfig } from '../../../lib/projects.js';
import type { PendingAutoMerge } from '../../../lib/overdeck/merge-sync.js';
import type { PrFacts } from '../../../lib/cloister/pr-facts.js';
import { latestAutoMergeAllowsSchedule } from '../../../lib/cloister/auto-merge-rearm.js';

export type MergePathOwner = 'per-pr' | 'batch';

type PolicyRefusal = { status: number; body: unknown } | null;

export interface MergePathOwnerDeps {
  /** Read for the `OVERDECK_DISABLE_AUTO_MERGE=1` kill switch; `process.env` by default. */
  env?: NodeJS.ProcessEnv;
  /** The project's forge; `forgeForProject` by default. */
  forgeOf?: (projectPath: string) => 'github' | 'gitlab';
  latestAutoMerge?: (issueId: string) => PendingAutoMerge | null;
  /** The door's forge-free policy check; `autoMergePolicyRefusal` by default. */
  policyRefusal?: (issueId: string) => PolicyRefusal;
  /** PAN-4820: the Deft human-merge hold; `deftAutoMergeHold` by default. */
  deftHold?: (issueId: string) => Promise<string | null>;
  /**
   * The issue's current open PR, for the rule-8 head comparison. Defaults to
   * a lookup in the cached `readOpenRepoPullRequests(projectPath)` listing
   * (PAN-5042): the open row whose `headRefName` is `feature/<id lower>`, or
   * null when there is none.
   */
  prOf?: (issueId: string, projectPath: string) => Promise<Pick<PrFacts, 'url' | 'headSha'> | null>;
}

async function defaultForgeOf(): Promise<(projectPath: string) => 'github' | 'gitlab'> {
  const { forgeForProject } = await import('./derived-issue-state.js');
  return forgeForProject;
}

async function defaultPolicyRefusal(): Promise<(issueId: string) => PolicyRefusal> {
  const { autoMergePolicyRefusal } = await import('./auto-merge-door-policy.js');
  return (issueId) => autoMergePolicyRefusal(issueId);
}

async function defaultPrOf(
  issueId: string,
  projectPath: string,
): Promise<Pick<PrFacts, 'url' | 'headSha'> | null> {
  const { readOpenRepoPullRequests } = await import('./derived-issue-state.js');
  const branch = `feature/${issueId.toLowerCase()}`;
  const rows = (await readOpenRepoPullRequests(projectPath)) ?? [];
  const row = rows.find((r) => (r.state ?? '').toUpperCase() === 'OPEN' && r.headRefName === branch);
  return row ? { url: row.url ?? null, headSha: row.headRefOid ?? null } : null;
}

/**
 * Whether the per-PR scheduler can ever schedule anything for this project:
 * the kill switch is off, the forge is GitHub, and the workspace is not
 * polyrepo. Folds rules 1, 5 and 6 — the three reasons the scheduler itself
 * skips a project (`auto-merge-scheduler.ts`'s GitLab skip and kill switch;
 * `gh pr list` in a polyrepo wrapper path yields no PRs).
 */
export async function perPrTrainActiveForProject(
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: MergePathOwnerDeps = {},
): Promise<boolean> {
  if ((deps.env ?? process.env).OVERDECK_DISABLE_AUTO_MERGE === '1') return false;
  if (config?.workspace?.type === 'polyrepo') return false;
  const forgeOf = deps.forgeOf ?? (await defaultForgeOf());
  return forgeOf(projectPath) !== 'gitlab';
}

/**
 * The one merge path owner for a ready feature, so the UAT batch reconciler
 * can drop whatever the per-PR scheduler already owns before assembling.
 * See the module doc for the full rule order.
 */
export async function mergePathOwner(
  issueId: string,
  projectPath: string,
  config: ProjectConfig | undefined,
  deps: MergePathOwnerDeps = {},
): Promise<MergePathOwner> {
  const id = issueId.toUpperCase();

  // Rule 1: the kill switch alone decides, before any forge-free check.
  if ((deps.env ?? process.env).OVERDECK_DISABLE_AUTO_MERGE === '1') return 'batch';

  // Rule 2: the door's policy refusal (held for UAT, train off, closed).
  const policyRefusal = deps.policyRefusal ?? (await defaultPolicyRefusal());
  if (policyRefusal(id)) return 'batch';

  // Rule 3: the Deft human-merge hold.
  const deftHold = deps.deftHold ?? (await import('../../../lib/deft/policy.js')).deftAutoMergeHold;
  if (await deftHold(id)) return 'batch';

  // Rule 4: the scheduler already owns a live row for this issue.
  const latestAutoMerge = deps.latestAutoMerge
    ?? (await import('../../../lib/overdeck/merge-sync.js')).getLatestAutoMerge;
  const latest = latestAutoMerge(id);
  if (latest?.status === 'pending' || latest?.status === 'merging') return 'per-pr';

  // Rules 5 & 6: the scheduler never runs for this project at all.
  if (!(await perPrTrainActiveForProject(projectPath, config, deps))) return 'batch';

  // Rule 7: the operator cancelled the issue's auto-merge; only the operator re-arms it.
  if (latest?.status === 'cancelled') return 'batch';

  // Rule 8: a failed or blocked row re-arms only at a new PR head.
  if (latest?.status === 'failed' || latest?.status === 'blocked') {
    const prOf = deps.prOf ?? defaultPrOf;
    const pr = await prOf(id, projectPath);
    if (pr && latestAutoMergeAllowsSchedule(latest, pr)) return 'per-pr';
    return 'batch';
  }

  // Rule 9: nothing above claimed it; the scheduler owns every other ready feature.
  return 'per-pr';
}
