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
 *   - its project's effective merge-train flag is on;
 *   - the one merge gate, `evaluateIssueMergeGate`, says the PR is ready;
 *   - the issue has no earlier auto-merge row still standing: a pending or
 *     merging row is already scheduled, and a cancelled, blocked, or failed row
 *     is the operator's call, which a tick must not overwrite;
 *   - the schedule door accepts it: the train is on globally, the issue is opted
 *     in to auto-merge (not held for UAT), it carries no blocker label, and it
 *     derives `ready`.
 */
import { resolve } from 'node:path';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { PendingAutoMerge } from '../../../lib/overdeck/merge-sync.js';
import type { MergeReadiness } from '../../../lib/cloister/pr-facts.js';

export interface AutoMergeSchedulerDeps {
  listProjects?: () => Array<{ key: string; config: ProjectConfig }>;
  isTrainEnabledForProject?: (config: ProjectConfig) => boolean;
  /** Cheap forge prefilter: open, approved, green, mergeable PRs in the project. */
  listReady?: (projectPath: string) => Promise<ReadonlyArray<{ issueId: string }>>;
  latestAutoMerge?: (issueId: string) => PendingAutoMerge | null;
  mergeGate?: (issueId: string) => Promise<MergeReadiness>;
  /** The schedule door; `postAutoMergeSchedulePayload` by default. */
  schedule?: (issueId: string) => Promise<{ status: number; body: unknown }>;
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

async function defaultListReady(projectPath: string): Promise<ReadonlyArray<{ issueId: string }>> {
  const { listReadyIssuesForProject } = await import('./derived-issue-state.js');
  return listReadyIssuesForProject(projectPath);
}

async function defaultMergeGate(issueId: string): Promise<MergeReadiness> {
  const { evaluateIssueMergeGate } = await import('../../../lib/cloister/merge-gate.js');
  return evaluateIssueMergeGate(issueId);
}

async function defaultSchedule(issueId: string): Promise<{ status: number; body: unknown }> {
  const { postAutoMergeSchedulePayload } = await import('../routes/merge-train.js');
  return postAutoMergeSchedulePayload({ issueId });
}

/** The reason in a schedule door refusal body, when it carries one. */
function refusalReason(result: { status: number; body: unknown }): string {
  const body = result.body;
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `schedule returned ${result.status}`;
}

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
  const listReady = deps.listReady ?? defaultListReady;
  const mergeGate = deps.mergeGate ?? defaultMergeGate;
  const schedule = deps.schedule ?? defaultSchedule;

  const outcomes: AutoMergeScheduleOutcome[] = [];
  for (const { key, config } of listProjects()) {
    if (!isTrainEnabledForProject(config)) continue;

    let ready: ReadonlyArray<{ issueId: string }>;
    try {
      ready = await listReady(resolve(config.path));
    } catch (error) {
      log(`[auto-merge-scheduler] ready set for ${key} failed: ${errorMessage(error)}`);
      continue;
    }

    for (const { issueId: rawIssueId } of ready) {
      const issueId = rawIssueId.toUpperCase();
      const skip = (reason: string) => outcomes.push({ projectKey: key, issueId, scheduled: false, reason });
      try {
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
