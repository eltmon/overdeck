/**
 * Batch auto-promote (PAN-4753 D4).
 *
 * With the merge train on, a batch in an auto GitHub monorepo project merges
 * with no human click once its combined CI is green. "Combined CI" is the
 * `CI` workflow run on the batch branch's head commit: `.github/workflows/ci.yml`
 * runs on pushes to `uat/**`, and the assembly engine pushes every batch.
 *
 * Each tick (the 60 s UAT-train tick), per project where the window applies
 * (`batchWindowAppliesToProject`, and the train on):
 *
 *   - take the newest `ready` window-lane generation (`uat/<prefix>-train-…`;
 *     UAT-lane batches of held features are the operator's to promote, D2).
 *     Skip it when a member has become held for UAT since it was assembled;
 *   - read the `CI` workflow run for its head commit (`push` event). Green
 *     needs positive evidence: the newest run is `completed` with conclusion
 *     `success`. No run yet, a run in progress, or a cancelled run means
 *     wait. (Check runs alone are not enough: jobs behind `needs:` have no
 *     check run until their dependencies finish.) CodeRabbit is not a
 *     workflow run, and the non-blocking flake lane cannot fail the run;
 *   - all green: promote through the same door an operator's click uses
 *     (`postUatGenerationPromotePayload`), which re-runs the merge gate for
 *     every member against fresh PR reads and refuses the merge when `main`
 *     moved under a member's files;
 *   - any failed: drop one member so it never blocks the rest. The drop rule
 *     is deterministic: the member with the highest `mergeOrder`, the last
 *     one merged onto the branch. The generation is marked `invalidated` (not
 *     `failed`, whose consecutive-failure cutoff would hold the healthy
 *     members back for hours) and the dropped member moves from its
 *     `members` to its `heldOut` with a `combined CI failed …` reason (one
 *     row per issue: the members table is keyed on generation + issue). `droppedFromBatch`
 *     (`merge-route.ts`) reads that entry, so the member takes the per-PR path
 *     and the next reconcile assembles the rest.
 *
 * One tick runs at a time: a tick that starts while another is still
 * promoting returns at once, so a slow promote is never started twice.
 *
 * Imported only by the dashboard entry point (`main.ts`); it reaches
 * `uat-train.ts` only through a dynamic import, which closes no cycle.
 */
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { UatGeneration } from '../../../lib/overdeck/merge-sync.js';
import type { CommitCheckRuns } from '../../../lib/overdeck/pull-requests.js';
import type { PromoteResult, UatPromoteDeps } from '../../../lib/cloister/uat-promote.js';
import { isAdvisoryCheckName } from '../../../lib/advisory-checks.js';
import {
  CANCELLED_BATCH_CI_PREFIX,
  COMBINED_CI_DROP_PREFIX,
  NO_BATCH_CI_PREFIX,
} from '../../../lib/cloister/merge-route.js';
import { batchWindowAppliesToProject, isWindowBatch, needsHumanMerge } from './merge-train-batching.js';

const execFileAsync = promisify(execFile);

/** Check names that never gate a batch, besides the advisory set (CodeRabbit). */
function isNonGatingCheck(name: string): boolean {
  return isAdvisoryCheckName(name) || /^non-blocking/i.test(name.trim());
}

/**
 * The batch head's CI state: `none` (no `CI` run for this commit yet),
 * `running` (queued or in progress), `green`, `failed`, or `cancelled`.
 */
export type BatchCiVerdict = 'none' | 'running' | 'green' | 'failed' | 'cancelled';

/**
 * How long a ready window batch may wait for a `CI` run to appear (or for a
 * cancelled run to be replaced) before it is dissolved and its members merge
 * one at a time. A batch never waits forever.
 */
export const BATCH_CI_APPEAR_TIMEOUT_MS = 10 * 60 * 1000;

/** One GitHub Actions workflow run for a commit (`GET /repos/:o/:r/actions/runs?head_sha=`). */
export interface WorkflowRunSummary {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
  run_attempt?: number | null;
  created_at?: string | null;
}

/** The workflow whose run is the batch's combined CI (`.github/workflows/ci.yml`). */
export const BATCH_CI_WORKFLOW = 'CI';

const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

/**
 * The batch head's CI state from its `CI` workflow runs. Pure. The newest run
 * (then the newest attempt) decides: completed + success is green; a failed
 * conclusion is failed; cancelled (or skipped, neutral, stale) is cancelled;
 * anything not completed is running; no `CI` run at all is none.
 */
export function batchCiVerdict(runs: readonly WorkflowRunSummary[]): BatchCiVerdict {
  const ci = runs.filter((run) => run.name === BATCH_CI_WORKFLOW);
  if (ci.length === 0) return 'none';
  const newest = [...ci].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '') || (b.run_attempt ?? 0) - (a.run_attempt ?? 0))[0]!;
  if (newest.status !== 'completed') return 'running';
  if (newest.conclusion === 'success') return 'green';
  if (FAILED_CONCLUSIONS.has(newest.conclusion ?? '')) return 'failed';
  return 'cancelled';
}

/** The failed check names worth naming in a drop reason (advisory and non-blocking checks left out). */
export function failedGatingChecks(runs: CommitCheckRuns): string[] {
  return runs.failed.filter((name) => !isNonGatingCheck(name));
}

/** The member to drop when the combined CI fails: the last one merged onto the branch. */
export function memberToDrop(gen: UatGeneration): UatGeneration['members'][number] | null {
  return [...gen.members].sort((a, b) => b.mergeOrder - a.mergeOrder)[0] ?? null;
}

export interface BatchAutoPromoteDeps {
  listProjects?: () => Array<{ key: string; config: ProjectConfig }>;
  isTrainOn?: (config: ProjectConfig) => boolean;
  forgeOf?: (projectPath: string) => 'github' | 'gitlab';
  isRequireUatBeforeMerge?: () => boolean;
  getIssueLabels?: (issueId: string) => readonly string[];
  /** Why only a human may merge this member, or null; `needsHumanMerge` by default. */
  humanMerge?: (issueId: string, projectPath: string, config: ProjectConfig) => Promise<string | null>;
  /** The project has no batch CI; `projectLacksBatchCi` by default. */
  lacksBatchCi?: (projectRoot: string) => boolean;
  /** One activity-feed notice; `emitActivityEntry` by default. */
  notify?: (entry: { message: string; level: 'warn' }) => void;
  now?: () => number;
  /** Live `ready` generations for the project (both lanes), newest first. */
  listReady?: (projectRoot: string) => UatGeneration[];
  /** The batch branch's head SHA on origin, or null when it is not there. */
  branchHead?: (projectPath: string, branch: string) => Promise<string | null>;
  /** The head commit's workflow runs from `push` events. */
  workflowRuns?: (projectPath: string, sha: string) => Promise<WorkflowRunSummary[]>;
  /** The head commit's check runs, read only to name the failed checks. */
  checkRuns?: (projectPath: string, sha: string) => Promise<CommitCheckRuns>;
  promote?: (name: string) => Promise<PromoteResult>;
  markDropped?: (gen: UatGeneration, patch: Pick<UatGeneration, 'members' | 'heldOut'>) => void;
  teardownStack?: (gen: UatGeneration) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

export type BatchAutoPromoteOutcome =
  | { projectKey: string; generation: string; action: 'promoted' | 'promote-refused' | 'waiting-ci' | 'held'; detail?: string }
  | { projectKey: string; generation: string; action: 'dropped'; issueId: string; detail: string }
  /** The batch got no usable CI run in time; every member merges one at a time. */
  | { projectKey: string; generation: string; action: 'dissolved'; detail: string };

/** Projects already told this process that batching needs a `uat/**` CI trigger. */
const noBatchCiNoticeSent = new Set<string>();

/** Test seam. */
export function _resetBatchAutoPromoteForTests(): void {
  noBatchCiNoticeSent.clear();
  lastLogged.clear();
}

async function defaultBranchHead(projectPath: string, branch: string): Promise<string | null> {
  const { stdout } = await execFileAsync('git', ['ls-remote', 'origin', `refs/heads/${branch}`], {
    cwd: projectPath, encoding: 'utf-8', timeout: 20_000,
  });
  return stdout.trim().split(/\s+/)[0] || null;
}

async function originRepo(projectPath: string): Promise<{ owner: string; name: string }> {
  const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd: projectPath, encoding: 'utf-8', timeout: 10_000 });
  const { githubRepoFromRemoteUrl } = await import('../../../lib/projects/infer-tracker.js');
  const repo = githubRepoFromRemoteUrl(stdout.trim());
  if (!repo) throw new Error(`origin of ${projectPath} is not a GitHub repository`);
  const [owner, name] = repo.split('/');
  return { owner: owner!, name: name! };
}

async function defaultWorkflowRuns(projectPath: string, sha: string): Promise<WorkflowRunSummary[]> {
  const { owner, name } = await originRepo(projectPath);
  const { stdout } = await execFileAsync('gh', [
    'api', `repos/${owner}/${name}/actions/runs?head_sha=${encodeURIComponent(sha)}&event=push&per_page=20`,
  ], { encoding: 'utf-8', timeout: 20_000, maxBuffer: 8 * 1024 * 1024 });
  return (JSON.parse(stdout) as { workflow_runs?: WorkflowRunSummary[] }).workflow_runs ?? [];
}

async function defaultCheckRuns(projectPath: string, sha: string): Promise<CommitCheckRuns> {
  const { owner, name } = await originRepo(projectPath);
  const { fetchCommitCheckRuns } = await import('../../../lib/overdeck/pull-requests.js');
  return fetchCommitCheckRuns(owner, name, sha);
}

/** Per-generation last-logged line, so a waiting batch logs once per change. */
const lastLogged = new Map<string, string>();

/** The tick in progress, so a slow promote never overlaps the next tick. */
let activeTick: Promise<BatchAutoPromoteOutcome[]> | null = null;

export async function runBatchAutoPromoteTick(
  firePostMerge: UatPromoteDeps['firePostMerge'],
  deps: BatchAutoPromoteDeps = {},
): Promise<BatchAutoPromoteOutcome[]> {
  if (activeTick) return [];
  activeTick = runTick(firePostMerge, deps).finally(() => { activeTick = null; });
  return activeTick;
}

async function runTick(
  firePostMerge: UatPromoteDeps['firePostMerge'],
  deps: BatchAutoPromoteDeps,
): Promise<BatchAutoPromoteOutcome[]> {
  // The kill switch stops batch merges too.
  if ((deps.env ?? process.env).OVERDECK_DISABLE_AUTO_MERGE === '1') return [];
  const log = deps.log ?? console.log;
  const listProjects = deps.listProjects ?? (await import('../../../lib/projects.js')).listProjectsSync;
  const isTrainOn = deps.isTrainOn ?? (await import('../../../lib/overdeck/merge-sync.js')).isMergeTrainEnabledForProject;
  const forgeOf = deps.forgeOf ?? (await import('./derived-issue-state.js')).forgeForProject;
  const listReady = deps.listReady ?? (await (async () => {
    const { listUatGenerations } = await import('../../../lib/overdeck/merge-sync.js');
    return (projectRoot: string) => listUatGenerations({ projectRoot, statuses: ['ready'], limit: 10 });
  })());
  const promote = deps.promote ?? (async (name: string) => {
    const { postUatGenerationPromotePayload } = await import('./uat-train.js');
    return postUatGenerationPromotePayload(name, firePostMerge);
  });
  const markDropped = deps.markDropped ?? (await (async () => {
    const { buildUatGenerationStore } = await import('../../../lib/cloister/uat-generation-deps.js');
    const store = buildUatGenerationStore();
    return (gen: UatGeneration, patch: Pick<UatGeneration, 'members' | 'heldOut'>) =>
      store.update(gen.name, { status: 'invalidated', ...patch });
  })());
  const teardownStack = deps.teardownStack
    ?? (await import('../../../lib/cloister/uat-stack.js')).teardownUatStack;
  const branchHead = deps.branchHead ?? defaultBranchHead;
  const workflowRuns = deps.workflowRuns ?? defaultWorkflowRuns;
  const checkRuns = deps.checkRuns ?? defaultCheckRuns;
  const humanMerge = deps.humanMerge ?? ((issueId: string, projectPath: string, config: ProjectConfig) =>
    needsHumanMerge(issueId, projectPath, config, deps.getIssueLabels ? { getIssueLabels: deps.getIssueLabels } : {}));
  const now = deps.now ?? Date.now;
  const notify = deps.notify ?? (await (async () => {
    const { emitActivityEntry } = await import('../../../lib/activity-logger.js');
    return (entry: { message: string; level: 'warn' }) => emitActivityEntry({ source: 'dashboard', link: '/flywheel', ...entry });
  })());
  const say = (gen: string, line: string) => {
    if (lastLogged.get(gen) === line) return;
    lastLogged.set(gen, line);
    log(`[batch-auto-promote] ${line}`);
  };

  const outcomes: BatchAutoPromoteOutcome[] = [];
  for (const { key, config } of listProjects()) {
    const projectPath = resolve(config.path);
    try {
      if (!isTrainOn(config)) continue;
      if (!batchWindowAppliesToProject(projectPath, config, {
        forgeOf,
        ...(deps.isRequireUatBeforeMerge ? { isRequireUatBeforeMerge: deps.isRequireUatBeforeMerge } : {}),
        ...(deps.lacksBatchCi ? { lacksBatchCi: deps.lacksBatchCi } : {}),
      })) continue;
      const gen = listReady(projectPath).find((g) => isWindowBatch(g.name));
      if (!gen) continue;

      // A member that only a human may merge stops the automatic merge (the
      // lane split keeps them out; this covers a change since assembly).
      let human: { issueId: string; reason: string } | null = null;
      for (const member of gen.members) {
        const reason = await humanMerge(member.issueId, projectPath, config);
        if (reason) { human = { issueId: member.issueId, reason }; break; }
      }
      if (human) {
        say(gen.name, `${gen.name} waits for the operator: ${human.issueId} — ${human.reason}`);
        outcomes.push({ projectKey: key, generation: gen.name, action: 'held', detail: human.issueId });
        continue;
      }

      const sha = await branchHead(projectPath, gen.name);
      const verdict: BatchCiVerdict = sha ? batchCiVerdict(await workflowRuns(projectPath, sha)) : 'none';
      if (verdict === 'none' || verdict === 'running' || verdict === 'cancelled') {
        const readyAt = Date.parse(gen.updatedAt || gen.createdAt || '');
        const waited = Number.isFinite(readyAt) ? now() - readyAt : Number.POSITIVE_INFINITY;
        if (verdict === 'running' || waited < BATCH_CI_APPEAR_TIMEOUT_MS) {
          say(gen.name, `${gen.name} waits for its combined CI${sha ? ` at ${sha.slice(0, 10)}` : ' (branch not on origin yet)'} (${verdict})`);
          outcomes.push({ projectKey: key, generation: gen.name, action: 'waiting-ci' });
          continue;
        }
        // Never wait forever: no CI run appeared (or the run was cancelled and
        // nothing replaced it) within the bound. Dissolve the batch; every
        // member merges one at a time, as with the train off.
        const minutes = Math.round(BATCH_CI_APPEAR_TIMEOUT_MS / 60_000);
        const prefix = verdict === 'none' ? NO_BATCH_CI_PREFIX : CANCELLED_BATCH_CI_PREFIX;
        const why = verdict === 'none'
          ? `${prefix} for ${gen.name} within ${minutes} min (batching needs a workflow named ${BATCH_CI_WORKFLOW} that runs on uat/** pushes)`
          : `${prefix} on ${gen.name} and not replaced within ${minutes} min`;
        markDropped(gen, {
          members: [],
          heldOut: [
            ...gen.heldOut,
            ...gen.members.map((m) => ({ issueId: m.issueId, branch: m.branch, headSha: m.headSha, reason: `${why}; ${m.issueId} merges on its own` })),
          ],
        });
        lastLogged.delete(gen.name);
        log(`[batch-auto-promote] ${why}; dissolved, ${gen.members.length} member(s) merge one at a time`);
        await teardownStack(gen).catch((err) => {
          log(`[batch-auto-promote] stack teardown for ${gen.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        if (verdict === 'none' && !noBatchCiNoticeSent.has(key)) {
          noBatchCiNoticeSent.add(key);
          notify({
            level: 'warn',
            message: `Merge train batching is paused for ${key}: its CI never ran on batch branch ${gen.name}. `
              + `Add 'uat/**' to the push branches of a workflow named ${BATCH_CI_WORKFLOW}. Until then its PRs merge one at a time (batching is retried after a day).`,
          });
        }
        outcomes.push({ projectKey: key, generation: gen.name, action: 'dissolved', detail: why });
        continue;
      }

      if (verdict === 'green') {
        log(`[batch-auto-promote] ${gen.name}: combined CI green — merging ${gen.members.length} feature(s)`);
        const result = await promote(gen.name);
        lastLogged.delete(gen.name);
        if (result.success) {
          outcomes.push({ projectKey: key, generation: gen.name, action: 'promoted' });
        } else {
          log(`[batch-auto-promote] ${gen.name}: promote refused (${result.reason}): ${result.message}`);
          outcomes.push({ projectKey: key, generation: gen.name, action: 'promote-refused', detail: result.message });
        }
        continue;
      }

      const dropped = memberToDrop(gen);
      if (!dropped || !sha) continue;
      const failedNames = await checkRuns(projectPath, sha).then(failedGatingChecks).catch(() => [] as string[]);
      const detail = `${COMBINED_CI_DROP_PREFIX} on ${gen.name} (${failedNames.length > 0 ? failedNames.join(', ') : BATCH_CI_WORKFLOW}); ${dropped.issueId} merges on its own`;
      markDropped(gen, {
        members: gen.members.filter((m) => m !== dropped),
        heldOut: [
          ...gen.heldOut,
          { issueId: dropped.issueId, branch: dropped.branch, headSha: dropped.headSha, reason: detail },
        ],
      });
      lastLogged.delete(gen.name);
      log(`[batch-auto-promote] ${detail}; the rest re-assemble`);
      await teardownStack(gen).catch((err) => {
        log(`[batch-auto-promote] stack teardown for ${gen.name} failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      outcomes.push({ projectKey: key, generation: gen.name, action: 'dropped', issueId: dropped.issueId, detail });
    } catch (err) {
      log(`[batch-auto-promote] ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return outcomes;
}
