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
 *   - the executor's kill switch (`OVERDECK_DISABLE_AUTO_MERGE=1`) is off.
 *     The merge-train flag no longer skips a project (PAN-4753 D4): with the
 *     train off every ready PR merges on its own, and with it on the door's
 *     policy check below refuses only the normal-priority PRs that batch;
 *   - it has an open PR on its `feature/<id>` or `strike/<id>` branch with
 *     green checks. PAN-4753 WI-6: a strike PR is a candidate once its
 *     expedited review approved its head (`strike-review.ts`); strikes are
 *     walked before features in each project, scheduled as `kind: 'strike'`,
 *     and the executor merges due strike rows first (R5). A strike keeps the
 *     5-minute cancel window, like every high-priority merge (D4);
 *   - the door's policy check passes, which reads no forge: the issue is not
 *     held for UAT, and its merge route is per-PR (train off, high priority,
 *     or dropped from a batch; `merge-route.ts`). A strike branch is high
 *     priority, so only a UAT hold keeps it from scheduling (R4): it then
 *     waits for the operator's strike Merge button;
 *   - the one merge gate, `evaluateIssueMergeGate`, says the PR is ready: its
 *     approval is a GitHub review of the exact head commit or a trusted
 *     verdict marker whose `sha=` names it;
 *   - the issue's latest auto-merge row allows a new one
 *     ({@link latestAutoMergeAllowsSchedule}): nothing pending or merging, no
 *     operator cancel on the issue, and no failed merge at this same PR head;
 *   - the schedule door accepts it (the gate again, and no blocker label). The
 *     insert re-checks the latest row in its transaction, so a cancel that
 *     lands during the pass is never overwritten.
 *
 * GitLab projects are skipped with a log line: their MRs are not listed here.
 *
 * PAN-5036: the pass never schedules nothing silently. The listing is read
 * with `readOpenRepoPullRequests` (PAN-5042: the open-only read, since a
 * schedule candidate is always an open PR), so a failed forge read (`null`)
 * is told apart from "no PRs": the project gets a "PR listing unavailable"
 * skip reason. An
 * open gate-linked PR the listing rules out (checks not green, or conflicting)
 * is still walked through the free checks above, then skipped with a reason
 * naming its head instead of vanishing from `notScheduled`.
 *
 * PAN-4772: when the gate refuses a feature PR whose approval is stale
 * (approved at an older head), the pass re-requests review once per head
 * (`stale-approval-rereview.ts`). A strike's new head gets its expedited
 * review from the strike review tick instead. Every completed pass's skip reasons are kept
 * (`auto-merge-skip-reasons.ts`) and served as `notScheduled` on
 * `GET /api/merge-train/auto-merge/pending`; a reason is logged only when it
 * changes.
 */
import { resolve } from 'node:path';
import type { ProjectConfig } from '../../../lib/projects.js';
import type { PendingAutoMerge } from '../../../lib/overdeck/merge-sync.js';
import type { MergeReadiness, PrFacts } from '../../../lib/cloister/pr-facts.js';
import type { GhPrRow } from '../../../lib/overdeck/derived-issue-state.js';
import { recordSchedulerOutcomes } from './auto-merge-skip-reasons.js';
import type { StaleApprovalFacts } from './stale-approval-rereview.js';

type DoorResult = { status: number; body: unknown };
type GateAnswer = MergeReadiness & { facts: Pick<PrFacts, 'url' | 'headSha'> & StaleApprovalFacts };
/** The re-arm rule, asked again with the latest row inside the insert transaction. */
type CanSchedule = (latest: PendingAutoMerge) => boolean;

/** A PR the merge train can merge automatically (PAN-4753: a feature or a strike). */
export interface GateCandidate {
  issueId: string;
  kind: 'feature' | 'strike';
  branch: string;
}

/** An open gate-linked PR the listing ruled out, and why (PAN-5036). */
export interface DroppedScheduleCandidate extends GateCandidate {
  /** The PR head the listing judged, when it carried one. */
  head?: string;
  reason: string;
}

/** One project's listing, read for scheduling. */
export interface ScheduleCandidates {
  /** PRs that are open, green and not conflicting, on a branch the merge gate can link. */
  candidates: readonly GateCandidate[];
  dropped: readonly DroppedScheduleCandidate[];
}

/** PAN-5036: the project-level skip reason when the forge read failed. */
export const PR_LISTING_UNAVAILABLE_REASON =
  'PR listing unavailable: the forge read failed, so no PR in this project can be scheduled until it answers';

export interface AutoMergeSchedulerDeps {
  listProjects?: () => Array<{ key: string; config: ProjectConfig }>;
  /** The project's forge; GitLab projects are skipped. */
  forgeOf?: (projectPath: string) => 'github' | 'gitlab';
  /**
   * The project's candidates and the PRs its listing ruled out, or null when
   * the listing could not be read; {@link listScheduleCandidates} by default.
   */
  listCandidates?: (projectPath: string) => Promise<ScheduleCandidates | null>;
  /** The door's forge-free policy check; `autoMergePolicyRefusal` by default. A strike passes its branch. */
  policyRefusal?: (issueId: string, options?: { branch?: string }) => DoorResult | null;
  /** PAN-4820: the Deft human-merge hold; `deftAutoMergeHold` by default. */
  deftHold?: (issueId: string) => Promise<string | null>;
  latestAutoMerge?: (issueId: string) => PendingAutoMerge | null;
  /** A strike is gated on its own branch (`preferBranch: strike/<id>`). */
  mergeGate?: (issueId: string, options?: { preferBranch?: string }) => Promise<GateAnswer>;
  /** The schedule door; `postAutoMergeSchedulePayload` with a guarded insert by default. */
  schedule?: (issueId: string, canSchedule: CanSchedule, kind?: GateCandidate['kind']) => Promise<DoorResult>;
  /**
   * PAN-4772: asked when the gate refuses. Re-requests review once per head
   * for a stale approval and answers a clause for the skip reason, or null.
   * `rereviewStaleApproval` by default.
   */
  rereview?: (issueId: string, facts: GateAnswer['facts']) => Promise<string | null>;
  /** Clock for the recorded skip reasons; `Date.now` by default. */
  now?: () => number;
  log?: (message: string) => void;
  /** Read for the `OVERDECK_DISABLE_AUTO_MERGE=1` kill switch; `process.env` by default. */
  env?: NodeJS.ProcessEnv;
  /**
   * False once the tick has abandoned this pass. Checked before every forge
   * read and inside the insert, so an abandoned pass that wakes up later does
   * nothing more. Set by {@link runAutoMergeSchedulerTick}.
   */
  isCurrent?: () => boolean;
}

export interface AutoMergeScheduleOutcome {
  projectKey: string;
  issueId: string;
  scheduled: boolean;
  /** Why the issue was not scheduled. */
  reason?: string;
  /** PAN-4772: the PR head the merge gate read, when the pass got that far. */
  head?: string;
  /** Skipped only because a pending or merging row already exists. */
  alreadyScheduled?: boolean;
  /** PAN-5036: the whole project was skipped; `issueId` carries the project key. */
  scope?: 'project';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The PR a branch belongs to, for automatic merging: `feature/<id>` or, since
 * PAN-4753, `strike/<id>` — the branches `triggerMerge` lands and the merge
 * gate is bound to. A PR on any other branch is never a candidate.
 */
export function gateCandidateFromBranch(branch: string | undefined): GateCandidate | null {
  const match = /^(feature|strike)\/([a-z][a-z0-9]*-\d+)$/i.exec(branch ?? '');
  if (!match?.[1] || !match[2]) return null;
  return { issueId: match[2].toUpperCase(), kind: match[1].toLowerCase() as GateCandidate['kind'], branch: branch! };
}

function candidateKey(candidate: GateCandidate): string {
  return `${candidate.issueId.toUpperCase()}:${candidate.kind}`;
}

/**
 * The project's schedule candidates from the cached open-PR listing (PAN-5042)
 * the UAT reconciler reads on the same tick: open, non-draft PRs on a
 * gate-linked branch whose checks are green and that do not conflict.
 * Approval is NOT read here: the listing carries only the forge's
 * `reviewDecision`, which is empty without branch protection. The merge gate
 * reads the verdict marker comments.
 *
 * PAN-5036: null when the listing could not be read, never an empty list; an
 * open gate-linked PR ruled out by the listing is returned in `dropped` with
 * the head it judged.
 */
export async function listScheduleCandidates(
  projectPath: string,
  deps: { listPullRequests?: (projectPath: string) => Promise<readonly GhPrRow[] | null> } = {},
): Promise<ScheduleCandidates | null> {
  const { readOpenRepoPullRequests, toChecksState } = await import('./derived-issue-state.js');
  const rows = await (deps.listPullRequests ?? readOpenRepoPullRequests)(projectPath);
  if (!rows) return null;
  const candidates = new Map<string, GateCandidate>();
  const dropped = new Map<string, DroppedScheduleCandidate>();
  for (const row of rows) {
    if ((row.state ?? '').toUpperCase() !== 'OPEN' || row.mergedAt || row.isDraft) continue;
    const candidate = gateCandidateFromBranch(row.headRefName);
    if (!candidate) continue;
    const key = candidateKey(candidate);
    const head = row.headRefOid ?? undefined;
    const at = head ? ` at ${head.slice(0, 8)}` : '';
    const checks = toChecksState(row.statusCheckRollup);
    const reason = checks !== 'green' ? `checks ${checks} in the PR listing${at}`
      : row.mergeable === 'CONFLICTING' ? `PR conflicts with its base in the PR listing${at}`
      : null;
    if (reason) {
      dropped.set(key, { ...candidate, ...(head ? { head } : {}), reason });
      continue;
    }
    candidates.set(key, candidate);
  }
  for (const key of candidates.keys()) dropped.delete(key);
  return { candidates: [...candidates.values()], dropped: [...dropped.values()] };
}

async function defaultForgeOf(): Promise<(projectPath: string) => 'github' | 'gitlab'> {
  const { forgeForProject } = await import('./derived-issue-state.js');
  return forgeForProject;
}

// PAN-4970: moved to lib/cloister/auto-merge-rearm.js to break an import
// cycle through routes/merge-train.js, services/uat-train.js and
// services/merge-path-owner.js. Re-exported so existing importers keep
// resolving it from here.
import { latestAutoMergeAllowsSchedule } from '../../../lib/cloister/auto-merge-rearm.js';
export { latestAutoMergeAllowsSchedule };

async function defaultMergeGate(issueId: string, options?: { preferBranch?: string }): Promise<GateAnswer> {
  const { evaluateIssueMergeGate } = await import('../../../lib/cloister/merge-gate.js');
  return options?.preferBranch ? evaluateIssueMergeGate(issueId, {}, options) : evaluateIssueMergeGate(issueId);
}

async function defaultRereview(issueId: string, facts: GateAnswer['facts']): Promise<string | null> {
  const { rereviewStaleApproval } = await import('./stale-approval-rereview.js');
  return rereviewStaleApproval(issueId, facts);
}

async function defaultPolicyRefusal(): Promise<(issueId: string, options?: { branch?: string }) => DoorResult | null> {
  const { autoMergePolicyRefusal } = await import('../routes/merge-train.js');
  return (issueId, options) => autoMergePolicyRefusal(issueId, {}, options);
}

async function defaultSchedule(issueId: string, canSchedule: CanSchedule, kind: GateCandidate['kind'] = 'feature'): Promise<DoorResult> {
  const [{ postAutoMergeSchedulePayload }, { scheduleAutoMergeWithResult }] = await Promise.all([
    import('../routes/merge-train.js'),
    import('../../../lib/overdeck/merge-sync.js'),
  ]);
  return postAutoMergeSchedulePayload({ issueId, kind }, {
    schedule: (input) => scheduleAutoMergeWithResult({ ...input, canSchedule }),
  });
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
  const latestAutoMerge = deps.latestAutoMerge
    ?? (await import('../../../lib/overdeck/merge-sync.js')).getLatestAutoMerge;
  const forgeOf = deps.forgeOf ?? await defaultForgeOf();
  const listCandidates = deps.listCandidates ?? ((projectPath: string) => listScheduleCandidates(projectPath));
  const policyRefusal = deps.policyRefusal ?? await defaultPolicyRefusal();
  const deftHold = deps.deftHold ?? (await import('../../../lib/deft/policy.js')).deftAutoMergeHold;
  const mergeGate = deps.mergeGate ?? defaultMergeGate;
  const schedule = deps.schedule ?? defaultSchedule;
  const rereview = deps.rereview ?? defaultRereview;
  const isCurrent = deps.isCurrent ?? (() => true);

  const outcomes: AutoMergeScheduleOutcome[] = [];
  for (const { key, config } of listProjects()) {
    if (!isCurrent()) return outcomes;
    const projectPath = resolve(config.path);

    let listing: ScheduleCandidates | null;
    try {
      if (forgeOf(projectPath) === 'gitlab') {
        if (!gitlabSkipsLogged.has(key)) {
          gitlabSkipsLogged.add(key);
          log(`[auto-merge-scheduler] ${key} is a GitLab project; its merge requests are not auto-scheduled`);
        }
        continue;
      }
      listing = await listCandidates(projectPath);
    } catch (error) {
      log(`[auto-merge-scheduler] candidates for ${key} failed: ${errorMessage(error)}`);
      continue;
    }
    if (!listing) {
      outcomes.push({ projectKey: key, issueId: key, scope: 'project', scheduled: false, reason: PR_LISTING_UNAVAILABLE_REASON });
      continue;
    }
    // PAN-4753 R5: strikes first; within a kind, listed candidates before ruled-out PRs.
    const walk: Array<GateCandidate & { reason?: string; head?: string }> = [...listing.candidates, ...listing.dropped]
      .sort((a, b) => (a.kind === 'strike' ? 0 : 1) - (b.kind === 'strike' ? 0 : 1));

    for (const candidate of walk) {
      if (!isCurrent()) return outcomes;
      const issueId = candidate.issueId.toUpperCase();
      const strike = candidate.kind === 'strike';
      let head: string | undefined;
      const skip = (reason: string, extra: { alreadyScheduled?: true } = {}) =>
        outcomes.push({ projectKey: key, issueId, scheduled: false, reason, ...(head ? { head } : {}), ...extra });
      try {
        // Free checks first: a held or already-scheduled issue costs no forge read.
        const refusal = strike ? policyRefusal(issueId, { branch: candidate.branch }) : policyRefusal(issueId);
        if (refusal) {
          skip(refusalReason(refusal));
          continue;
        }
        const hold = await deftHold(issueId);
        if (hold) {
          skip(hold);
          continue;
        }
        const latest = latestAutoMerge(issueId);
        if (latest?.status === 'pending' || latest?.status === 'merging') {
          skip(`auto-merge already ${latest.status}`, { alreadyScheduled: true });
          continue;
        }
        if (latest?.status === 'cancelled') {
          skip('auto-merge cancelled by the operator; re-schedule it to resume');
          continue;
        }
        // PAN-5036: ruled out by the listing; say so with the head it judged.
        if (candidate.reason) {
          head = candidate.head;
          skip(candidate.reason);
          continue;
        }

        // A feature read keeps the 60 s PR-facts cache; a strike is read on its own branch.
        const gate = strike ? await mergeGate(issueId, { preferBranch: candidate.branch }) : await mergeGate(issueId);
        head = gate.facts.headSha ?? undefined;
        if (!gate.ready) {
          const reason = gate.reason ?? 'merge gate says not ready';
          let stale: string | null = null;
          if (isCurrent() && !strike) {
            try {
              stale = await rereview(issueId, gate.facts);
            } catch (error) {
              stale = `stale-approval re-review failed: ${errorMessage(error)}`;
            }
          }
          skip(stale ? `${reason}; ${stale}` : reason);
          continue;
        }
        if (!latestAutoMergeAllowsSchedule(latest, gate.facts)) {
          skip(`auto-merge ${latest?.status} for this PR head`);
          continue;
        }
        if (!isCurrent()) return outcomes;

        let refusedInInsert: PendingAutoMerge | null = null;
        const canSchedule: CanSchedule = (fresh) => {
          // An abandoned pass writes nothing, even mid-door.
          const allowed = isCurrent() && latestAutoMergeAllowsSchedule(fresh, gate.facts);
          if (!allowed) refusedInInsert = fresh;
          return allowed;
        };
        const result = strike ? await schedule(issueId, canSchedule, 'strike') : await schedule(issueId, canSchedule);
        if (result.status !== 200) {
          skip(refusalReason(result));
          continue;
        }
        if (refusedInInsert) {
          skip(`auto-merge became ${(refusedInInsert as PendingAutoMerge).status} during the pass`);
          continue;
        }
        outcomes.push({ projectKey: key, issueId, scheduled: true });
        log(`[auto-merge-scheduler] scheduled ${strike ? 'strike ' : ''}auto-merge for ${issueId}`);
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
 * An abandoned pass that later resumes starts no forge read and writes no row:
 * its generation is no longer current.
 */
export const AUTO_MERGE_SCHEDULER_PASS_TIMEOUT_MS = 5 * 60_000;

let activePass: Promise<AutoMergeScheduleOutcome[]> | null = null;
/** The generation of the pass allowed to act; bumped when a pass is abandoned. */
let passGeneration = 0;

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
  const generation = ++passGeneration;
  const isCurrent = () => generation === passGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<AutoMergeScheduleOutcome[]>((resolveTimeout) => {
    timer = setTimeout(() => {
      passGeneration += 1;
      log(`[auto-merge-scheduler] pass still running after ${timeoutMs}ms; abandoning it so the next tick can run`);
      resolveTimeout([]);
    }, timeoutMs);
    timer.unref?.();
  });
  const pass: Promise<AutoMergeScheduleOutcome[]> = Promise.race([scheduleReadyAutoMerges({ ...deps, isCurrent }), timedOut])
    .then((outcomes) => {
      // PAN-4772: only a pass that ran to completion replaces the visible skips.
      if (isCurrent()) recordSchedulerOutcomes(outcomes, { log, ...(deps.now ? { now: deps.now } : {}) });
      return outcomes;
    })
    .finally(() => {
      clearTimeout(timer);
      if (activePass === pass) activePass = null;
    });
  activePass = pass;
  return pass;
}
