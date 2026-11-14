/**
 * PAN-4753 WI-5: the strike expedited review (operator decision D1).
 *
 * A strike PR (`strike/<id>`, PAN-3973) skips planning and is authored as the
 * operator, who cannot approve it. Each strike PR gets one quick-mode review
 * (a single reviewer, no convoy) per head, dispatched automatically. Its
 * APPROVED verdict is a GitHub review by the App bot, or a trusted `sha=`
 * verdict marker when the forge refuses the self-review, so the merge gate
 * gets a head approval with no new trust rule. A CHANGES_REQUESTED verdict
 * stops the strike: nothing reworks it automatically (`done.ts` skips feedback
 * delivery for a strike).
 *
 * The strike agent already ran the quality gates and pushed, so this skips
 * verification and push and calls the review dispatcher directly with the
 * strike workspace and branch. The reviewer keeps the id `agent-<id>-review`,
 * so the verdict caller guard accepts it.
 *
 * "Once per head" is the strike workspace's pipeline journal: a
 * `review.requested` entry naming the head, unless a later
 * `review.dispatch-failed` entry names the same head (a dispatch the conflict
 * gate or a liveness probe held started no review, so the next tick asks
 * again). Nothing else is stored.
 *
 * The tick runs on the UAT-train reconciler tick for every GitHub project,
 * whatever its merge-train flag: since D4 that flag decides batching only, and
 * a strike in a train-off project still needs a head approval to auto-merge.
 * `OVERDECK_DISABLE_AUTO_MERGE=1` stops it, as it stops the scheduler. GitLab
 * projects are skipped: strike review on GitLab is out of scope.
 */
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { resolveReviewTarget, type ReviewTarget } from '../../../lib/cloister/review-target.js';
import {
  appendPipelineEntry,
  readPipelineJournal,
  type PipelineJournalEntry,
} from '../../../lib/cloister/pipeline-journal.js';
import type { PrFacts } from '../../../lib/cloister/pr-facts.js';
import type { GhPrRow } from '../../../lib/overdeck/pr-listing.js';
import type { ProjectConfig } from '../../../lib/projects.js';

const execFileAsync = promisify(execFile);

/** Reviews started per tick, so a deploy does not launch one for every open strike at once. */
export const STRIKE_REVIEWS_PER_TICK = 2;
/** A tick still running after this is abandoned, so a hung forge read cannot stop strike reviews. */
export const STRIKE_REVIEW_PASS_TIMEOUT_MS = 5 * 60_000;

const STRIKE_BRANCH = /^strike\/([a-z][a-z0-9]*-\d+)$/i;
const SOURCE = 'strike-review';

type DispatchResult = { success: boolean; message: string; error?: string };

export interface StrikeReviewDeps {
  target?: (issueId: string) => ReviewTarget | null;
  /** The strike PR's facts, read fresh on `strike/<id>`, with a GitHub approval at head proven. */
  facts?: (issueId: string, branch: string) => Promise<PrFacts>;
  /** The commit checked out in the strike workspace; the reviewer reads that tree. */
  workspaceHead?: (workspacePath: string) => Promise<string | null>;
  journal?: (workspacePath: string) => PipelineJournalEntry[];
  append?: (workspacePath: string, entry: Omit<PipelineJournalEntry, 'at'>) => void;
  reviewerAlive?: (issueId: string) => Promise<boolean>;
  dispatch?: (opts: { issueId: string; workspace: string; branch: string; prUrl?: string; force?: boolean }) => Promise<DispatchResult>;
}

export type StrikeReviewSkipReason =
  | 'not-strike' | 'no-pr' | 'checks-not-green' | 'draft' | 'workspace-head-mismatch'
  | 'already-reviewed-at-head' | 'review-in-flight' | 'dispatch-failed';

export type StrikeReviewOutcome =
  | { started: true; headSha: string }
  | { started: false; reason: StrikeReviewSkipReason; detail?: string };

async function defaultFacts(issueId: string, branch: string): Promise<PrFacts> {
  const { getPrFacts, withForgeApprovalAtHead } = await import('../../../lib/cloister/pr-facts.js');
  return withForgeApprovalAtHead(await getPrFacts(issueId, {}, { preferBranch: branch, fresh: true }));
}

async function defaultWorkspaceHead(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workspacePath, encoding: 'utf-8', timeout: 15_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function defaultReviewerAlive(issueId: string): Promise<boolean> {
  const { isAlive } = await import('../../../lib/agents/liveness.js');
  try {
    return (await isAlive(`agent-${issueId.toLowerCase()}-review`)).alive;
  } catch {
    // An unanswerable probe is not proof of a dead reviewer; hold this tick.
    return true;
  }
}

async function defaultDispatch(opts: { issueId: string; workspace: string; branch: string; prUrl?: string; force?: boolean }): Promise<DispatchResult> {
  const { spawnReviewRoleForIssue } = await import('../../../lib/cloister/review-agent.js');
  return Effect.runPromise(spawnReviewRoleForIssue({ ...opts, reviewMode: 'quick', reviewKind: 'strike', force: true }));
}

function sameCommit(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.startsWith(y) || y.startsWith(x);
}

function headOf(entry: PipelineJournalEntry): string | null {
  const head = entry.data?.['headSha'];
  return typeof head === 'string' && head ? head : null;
}

/**
 * Whether this head already has a strike review (requested, or a verdict
 * journaled for it). A `review.dispatch-failed` for the head after its last
 * request means no review started.
 */
function reviewedAtHead(entries: readonly PipelineJournalEntry[], head: string): boolean {
  let requested = false;
  for (const entry of entries) {
    const entryHead = headOf(entry);
    if (!entryHead || !sameCommit(entryHead, head)) continue;
    if (entry.type === 'review.requested' || entry.type === 'review.verdict') requested = true;
    else if (entry.type === 'review.dispatch-failed') requested = false;
  }
  return requested;
}

/** Start the expedited review of `issueId`'s strike PR at its current head, unless it already has one. */
export async function startStrikeReview(
  issueId: string,
  opts: { force?: boolean } = {},
  deps: StrikeReviewDeps = {},
): Promise<StrikeReviewOutcome> {
  const id = issueId.toUpperCase();
  const target = (deps.target ?? resolveReviewTarget)(id);
  if (target?.kind !== 'strike') return { started: false, reason: 'not-strike' };

  const facts = await (deps.facts ?? defaultFacts)(id, target.branch);
  if (facts.error || !facts.exists || !facts.open || !facts.headSha) {
    return { started: false, reason: 'no-pr', ...(facts.error ? { detail: facts.error } : {}) };
  }
  if (facts.draft) return { started: false, reason: 'draft' };
  if (facts.checks !== 'green') return { started: false, reason: 'checks-not-green', detail: `checks ${facts.checks}` };
  const head = facts.headSha;

  // The run id and the reviewed tree come from the workspace HEAD; reviewing
  // another commit would put the approval on the wrong head.
  const workspaceHead = await (deps.workspaceHead ?? defaultWorkspaceHead)(target.workspacePath);
  if (!workspaceHead || !sameCommit(workspaceHead, head)) {
    return {
      started: false,
      reason: 'workspace-head-mismatch',
      detail: `the strike workspace is at ${workspaceHead?.slice(0, 8) ?? 'an unreadable HEAD'}, the PR at ${head.slice(0, 8)}`,
    };
  }

  if (!opts.force) {
    if (facts.approvedAtHead === true) return { started: false, reason: 'already-reviewed-at-head' };
    if (reviewedAtHead((deps.journal ?? readPipelineJournal)(target.workspacePath), head)) {
      return { started: false, reason: 'already-reviewed-at-head' };
    }
    if (await (deps.reviewerAlive ?? defaultReviewerAlive)(id)) return { started: false, reason: 'review-in-flight' };
  }

  const append = deps.append ?? appendPipelineEntry;
  append(target.workspacePath, { type: 'review.requested', issueId: id, source: SOURCE, data: { headSha: head, kind: 'strike' } });
  let result: DispatchResult;
  try {
    result = await (deps.dispatch ?? defaultDispatch)({
      issueId: id,
      workspace: target.workspacePath,
      branch: target.branch,
      ...(facts.url ? { prUrl: facts.url } : {}),
    });
  } catch (error) {
    result = { success: false, message: error instanceof Error ? error.message : String(error) };
  }
  if (!result.success) {
    const detail = result.error ?? result.message;
    append(target.workspacePath, { type: 'review.dispatch-failed', issueId: id, source: SOURCE, data: { headSha: head, kind: 'strike', error: detail } });
    return { started: false, reason: 'dispatch-failed', detail };
  }
  return { started: true, headSha: head };
}

/**
 * `POST /api/review/:issueId/request` for a strike-only issue, or null when
 * the issue's review target is not a strike (the route then goes on as before).
 */
export async function strikeReviewRequestAnswer(
  issueId: string,
  opts: { force?: boolean } = {},
  deps: StrikeReviewDeps = {},
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if ((deps.target ?? resolveReviewTarget)(issueId.toUpperCase())?.kind !== 'strike') return null;
  const outcome = await startStrikeReview(issueId, opts, deps);
  if (outcome.started) {
    return { status: 202, body: { success: true, message: `Strike review dispatched at ${outcome.headSha.slice(0, 8)}` } };
  }
  const message = `Strike review not started: ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ''}`;
  switch (outcome.reason) {
    case 'already-reviewed-at-head':
    case 'review-in-flight':
      return { status: 200, body: { success: true, message } };
    case 'no-pr':
      return { status: 404, body: { success: false, error: message } };
    case 'dispatch-failed':
      return { status: 500, body: { success: false, error: message } };
    default:
      return { status: 409, body: { success: false, error: message } };
  }
}

export interface DispatchStrikeReviewsDeps extends StrikeReviewDeps {
  listProjects?: () => Array<{ key: string; config: ProjectConfig }>;
  forgeOf?: (projectPath: string) => 'github' | 'gitlab';
  listPullRequests?: (projectPath: string) => Promise<readonly GhPrRow[] | null>;
  start?: (issueId: string) => Promise<StrikeReviewOutcome>;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
  /** False once the tick abandoned this pass; set by {@link runStrikeReviewTick}. */
  isCurrent?: () => boolean;
}

/** GitLab projects already reported this process, so the skip logs once. */
const gitlabSkipsLogged = new Set<string>();

/**
 * One pass: every open, non-draft, green strike PR in a GitHub project,
 * oldest first, until {@link STRIKE_REVIEWS_PER_TICK} reviews started. One
 * issue's failure is logged and never stops the rest.
 */
export async function dispatchStrikeReviews(deps: DispatchStrikeReviewsDeps = {}): Promise<Array<{ issueId: string; outcome: StrikeReviewOutcome }>> {
  if ((deps.env ?? process.env).OVERDECK_DISABLE_AUTO_MERGE === '1') return [];
  const log = deps.log ?? console.log;
  const isCurrent = deps.isCurrent ?? (() => true);
  const listProjects = deps.listProjects ?? (await import('../../../lib/projects.js')).listProjectsSync;
  const listing = await import('./derived-issue-state.js');
  const forgeOf = deps.forgeOf ?? listing.forgeForProject;
  const listPullRequests = deps.listPullRequests ?? listing.readOpenRepoPullRequests;
  const start = deps.start ?? ((issueId: string) => startStrikeReview(issueId, {}, deps));

  const outcomes: Array<{ issueId: string; outcome: StrikeReviewOutcome }> = [];
  let started = 0;
  for (const { key, config } of listProjects()) {
    if (!isCurrent() || started >= STRIKE_REVIEWS_PER_TICK) break;
    const projectPath = resolve(config.path);
    let rows: readonly GhPrRow[] | null;
    try {
      if (forgeOf(projectPath) === 'gitlab') {
        if (!gitlabSkipsLogged.has(key)) {
          gitlabSkipsLogged.add(key);
          log(`[strike-review] ${key} is a GitLab project; its strike merge requests get no expedited review`);
        }
        continue;
      }
      rows = await listPullRequests(projectPath);
    } catch (error) {
      log(`[strike-review] PR listing for ${key} failed: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const strikes = (rows ?? [])
      .filter((row) => (row.state ?? 'OPEN').toUpperCase() === 'OPEN' && !row.mergedAt && !row.isDraft)
      .filter((row) => STRIKE_BRANCH.test(row.headRefName ?? '') && listing.toChecksState(row.statusCheckRollup) === 'green')
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    for (const row of strikes) {
      if (!isCurrent() || started >= STRIKE_REVIEWS_PER_TICK) break;
      const issueId = STRIKE_BRANCH.exec(row.headRefName ?? '')![1]!.toUpperCase();
      try {
        const outcome = await start(issueId);
        outcomes.push({ issueId, outcome });
        if (outcome.started) {
          started += 1;
          log(`[strike-review] dispatched the expedited review of ${issueId} at ${outcome.headSha.slice(0, 8)}`);
        } else if (outcome.reason === 'dispatch-failed' || outcome.reason === 'workspace-head-mismatch') {
          log(`[strike-review] ${issueId} not reviewed: ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ''}`);
        }
      } catch (error) {
        log(`[strike-review] ${issueId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return outcomes;
}

let activePass: Promise<unknown> | null = null;
/** The generation of the pass allowed to act; bumped when a pass is abandoned. */
let passGeneration = 0;

/** Single-flight: a tick that lands while a pass runs joins it instead of starting a second one. */
export function runStrikeReviewTick(
  deps: DispatchStrikeReviewsDeps = {},
  timeoutMs = STRIKE_REVIEW_PASS_TIMEOUT_MS,
): Promise<unknown> {
  if (activePass) return activePass;
  const log = deps.log ?? console.log;
  const generation = ++passGeneration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<[]>((resolveTimeout) => {
    timer = setTimeout(() => {
      passGeneration += 1;
      log(`[strike-review] pass still running after ${timeoutMs}ms; abandoning it so the next tick can run`);
      resolveTimeout([]);
    }, timeoutMs);
    timer.unref?.();
  });
  const pass: Promise<unknown> = Promise.race([
    dispatchStrikeReviews({ ...deps, isCurrent: () => generation === passGeneration }),
    timedOut,
  ]).finally(() => {
    clearTimeout(timer);
    if (activePass === pass) activePass = null;
  });
  activePass = pass;
  return pass;
}
