/**
 * The merge train's scheduling crank (#3983).
 *
 * `pending_auto_merges` rows are written only by the schedule door,
 * `postAutoMergeSchedulePayload` (`POST /api/merge-train/auto-merge/schedule`).
 * Before PAN-3917 the flywheel run loop called that route every tick; the cut
 * deleted the loop and nothing took its place, so approved green PRs sat
 * unmerged. This pass runs on the UAT-train reconciler tick and schedules every
 * PR the forge says is ready, through the same door an operator uses.
 *
 * Nothing merges here. A scheduled row waits out the cooldown, and the
 * auto-merge executor then merges it through `triggerMerge`, which consults the
 * merge gate again. An issue is scheduled only when all of these hold:
 *
 *   - its project's effective merge-train flag is on, and the executor's kill
 *     switch (`OVERDECK_DISABLE_AUTO_MERGE=1`) is off;
 *   - it has an open PR on a branch the merge gate links to it
 *     (`feature/<id>` or `strike/<id>`) with green checks;
 *   - the door's policy check passes, which reads no forge: the issue is opted
 *     in to auto-merge (not held for UAT) and the train is on globally;
 *   - the issue has no earlier auto-merge row still standing: a pending or
 *     merging row is already scheduled, and a cancelled, blocked, or failed row
 *     is the operator's call, which a tick must not overwrite;
 *   - the one merge gate, `evaluateIssueMergeGate`, says the PR is ready: its
 *     approval is a forge review or a trusted verdict marker comment;
 *   - the schedule door accepts it (the gate again, and no blocker label).
 *
 * GitLab projects are skipped with a log line: their MRs are not listed here.
 */
import { resolve } from 'node:path';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { PendingAutoMerge } from '../../../lib/overdeck/merge-sync.js';
import type { MergeReadiness } from '../../../lib/cloister/pr-facts.js';
import type { listRepoPullRequests } from './derived-issue-state.js';

type DoorResult = { status: number; body: unknown };
type ListedPr = Awaited<ReturnType<typeof listRepoPullRequests>>[number];

export interface AutoMergeSchedulerDeps {
  listProjects?: () => Array<{ key: string; config: ProjectConfig }>;
  isTrainEnabledForProject?: (config: ProjectConfig) => boolean;
  /** The project's forge; GitLab projects are skipped. */
  forgeOf?: (projectPath: string) => 'github' | 'gitlab';
  /** Issues with an open, green PR the merge gate can link; {@link listScheduleCandidates} by default. */
  listCandidates?: (projectPath: string) => Promise<readonly string[]>;
  /** The door's forge-free policy check; `autoMergePolicyRefusal` by default. */
  policyRefusal?: (issueId: string) => DoorResult | null;
  latestAutoMerge?: (issueId: string) => PendingAutoMerge | null;
  mergeGate?: (issueId: string) => Promise<MergeReadiness>;
  /** The schedule door; `postAutoMergeSchedulePayload` by default. */
  schedule?: (issueId: string) => Promise<DoorResult>;
  log?: (message: string) => void;
  /** Read for the `OVERDECK_DISABLE_AUTO_MERGE=1` kill switch; `process.env` by default. */
  env?: NodeJS.ProcessEnv;
}

export interface AutoMergeScheduleOutcome {
  projectKey: string;
  issueId: string;
  scheduled: boolean;
  /** Why the issue was not scheduled. */
  reason?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The issue a PR branch belongs to, by the branches the merge gate probes for
 * an issue's PR (`resolveIssuePullRequestRef`): `feature/<id>` and
 * `strike/<id>`. A PR on any other branch cannot pass the gate, so it is not a
 * candidate.
 */
export function issueIdFromGateBranch(branch: string | undefined): string | null {
  const match = /^(?:feature|strike)\/([a-z][a-z0-9]*-\d+)$/i.exec(branch ?? '');
  return match?.[1] ? match[1].toUpperCase() : null;
}

/**
 * The project's schedule candidates from the cached `gh pr list` the UAT
 * reconciler reads on the same tick: open, non-draft PRs on a gate-linked
 * branch whose checks are green and that do not conflict. Approval is NOT read
 * here: the listing carries only the forge's `reviewDecision`, which is empty
 * without branch protection. The merge gate reads the verdict marker comments.
 */
export async function listScheduleCandidates(
  projectPath: string,
  deps: { listPullRequests?: (projectPath: string) => Promise<readonly ListedPr[]> } = {},
): Promise<string[]> {
  const { listRepoPullRequests: listPrs, toChecksState } = await import('./derived-issue-state.js');
  const rows = await (deps.listPullRequests ?? listPrs)(projectPath);
  const candidates = new Set<string>();
  for (const row of rows) {
    if ((row.state ?? '').toUpperCase() !== 'OPEN' || row.mergedAt || row.isDraft) continue;
    const issueId = issueIdFromGateBranch(row.headRefName);
    if (!issueId) continue;
    if (toChecksState(row.statusCheckRollup) !== 'green') continue;
    if (row.mergeable === 'CONFLICTING') continue;
    candidates.add(issueId);
  }
  return [...candidates];
}

async function defaultForgeOf(): Promise<(projectPath: string) => 'github' | 'gitlab'> {
  const { forgeForProject } = await import('./derived-issue-state.js');
  return forgeForProject;
}

async function defaultMergeGate(issueId: string): Promise<MergeReadiness> {
  const { evaluateIssueMergeGate } = await import('../../../lib/cloister/merge-gate.js');
  return evaluateIssueMergeGate(issueId);
}

async function defaultPolicyRefusal(): Promise<(issueId: string) => DoorResult | null> {
  const { autoMergePolicyRefusal } = await import('../routes/merge-train.js');
  return (issueId) => autoMergePolicyRefusal(issueId);
}

async function defaultSchedule(issueId: string): Promise<DoorResult> {
  const { postAutoMergeSchedulePayload } = await import('../routes/merge-train.js');
  return postAutoMergeSchedulePayload({ issueId });
}

/** The reason in a schedule door refusal body, when it carries one. */
function refusalReason(result: DoorResult): string {
  const body = result.body;
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `schedule returned ${result.status}`;
}

/** GitLab projects already reported this process, so the skip logs once. */
const gitlabSkipsLogged = new Set<string>();

/**
 * One scheduling pass over every tracked project. One project's or one issue's
 * failure is logged and skipped; it never stops the rest of the pass.
 */
export async function scheduleReadyAutoMerges(deps: AutoMergeSchedulerDeps = {}): Promise<AutoMergeScheduleOutcome[]> {
  // The executor's kill switch stops scheduling too: rows written while the
  // executor is off would all fire together the moment it came back.
  if ((deps.env ?? process.env).OVERDECK_DISABLE_AUTO_MERGE === '1') return [];
  const log = deps.log ?? console.log;
  const listProjects = deps.listProjects ?? (await import('../../../lib/projects.js')).listProjectsSync;
  const isTrainEnabledForProject = deps.isTrainEnabledForProject
    ?? (await import('../../../lib/overdeck/merge-sync.js')).isMergeTrainEnabledForProject;
  const latestAutoMerge = deps.latestAutoMerge
    ?? (await import('../../../lib/overdeck/merge-sync.js')).getLatestAutoMerge;
  const forgeOf = deps.forgeOf ?? await defaultForgeOf();
  const listCandidates = deps.listCandidates ?? ((projectPath: string) => listScheduleCandidates(projectPath));
  const policyRefusal = deps.policyRefusal ?? await defaultPolicyRefusal();
  const mergeGate = deps.mergeGate ?? defaultMergeGate;
  const schedule = deps.schedule ?? defaultSchedule;

  const outcomes: AutoMergeScheduleOutcome[] = [];
  for (const { key, config } of listProjects()) {
    if (!isTrainEnabledForProject(config)) continue;
    const projectPath = resolve(config.path);

    let candidates: readonly string[];
    try {
      if (forgeOf(projectPath) === 'gitlab') {
        if (!gitlabSkipsLogged.has(key)) {
          gitlabSkipsLogged.add(key);
          log(`[auto-merge-scheduler] ${key} is a GitLab project; its merge requests are not auto-scheduled`);
        }
        continue;
      }
      candidates = await listCandidates(projectPath);
    } catch (error) {
      log(`[auto-merge-scheduler] candidates for ${key} failed: ${errorMessage(error)}`);
      continue;
    }

    for (const rawIssueId of candidates) {
      const issueId = rawIssueId.toUpperCase();
      const skip = (reason: string) => outcomes.push({ projectKey: key, issueId, scheduled: false, reason });
      try {
        // Free checks first: a held or already-scheduled issue costs no forge read.
        const refusal = policyRefusal(issueId);
        if (refusal) {
          skip(refusalReason(refusal));
          continue;
        }
        const latest = latestAutoMerge(issueId);
        if (latest && latest.status !== 'merged') {
          skip(`auto-merge already ${latest.status}`);
          continue;
        }

        const gate = await mergeGate(issueId);
        if (!gate.ready) {
          skip(gate.reason ?? 'merge gate says not ready');
          continue;
        }

        const result = await schedule(issueId);
        if (result.status !== 200) {
          skip(refusalReason(result));
          continue;
        }
        outcomes.push({ projectKey: key, issueId, scheduled: true });
        log(`[auto-merge-scheduler] scheduled auto-merge for ${issueId}`);
      } catch (error) {
        log(`[auto-merge-scheduler] ${issueId} failed: ${errorMessage(error)}`);
        skip(errorMessage(error));
      }
    }
  }
  return outcomes;
}

/**
 * A pass that runs longer than this is abandoned: the tick logs it and releases
 * the single-flight slot, so a hung forge read cannot stop scheduling silently.
 * An abandoned pass that later resumes is harmless: the insert re-checks the
 * issue's latest row.
 */
export const AUTO_MERGE_SCHEDULER_PASS_TIMEOUT_MS = 5 * 60_000;

let activePass: Promise<AutoMergeScheduleOutcome[]> | null = null;

/**
 * Single-flight: a tick that lands while the previous pass is still reading the
 * forge joins that pass instead of starting a second one.
 */
export function runAutoMergeSchedulerTick(
  deps: AutoMergeSchedulerDeps = {},
  timeoutMs = AUTO_MERGE_SCHEDULER_PASS_TIMEOUT_MS,
): Promise<AutoMergeScheduleOutcome[]> {
  if (activePass) return activePass;
  const log = deps.log ?? console.log;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<AutoMergeScheduleOutcome[]>((resolveTimeout) => {
    timer = setTimeout(() => {
      log(`[auto-merge-scheduler] pass still running after ${timeoutMs}ms; abandoning it so the next tick can run`);
      resolveTimeout([]);
    }, timeoutMs);
    timer.unref?.();
  });
  const pass: Promise<AutoMergeScheduleOutcome[]> = Promise.race([scheduleReadyAutoMerges(deps), timedOut])
    .finally(() => {
      clearTimeout(timer);
      if (activePass === pass) activePass = null;
    });
  activePass = pass;
  return pass;
}
