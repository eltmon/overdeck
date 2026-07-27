/** Mechanical Definition-of-Done row checks. */

import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CanonicalState } from '../../core/state-mapping.js';
import { Effect } from 'effect';
import { listRunningAgents, type AgentState } from '../agents.js';
import { getDashboardApiUrlSync } from '../config.js';
import { getReviewStatus, type ReviewStatus } from '../review-status.js';
import type { StrikeLandingStatus } from '../strike-landing.js';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecord,
  resolveProjectForIssue,
  type PanIssuePipelineRecord,
} from '../pan-dir/record.js';
import { getAutoCloseOutCanonicalState } from '../cloister/deacon-canonical-state.js';
import { isIssueClosed } from '../cloister/issue-closed.js';
import { fetchCommitCheckRuns, fetchIssuePullRequest } from '../overdeck/pull-requests.js';
import {
  gatherIssueBranchContainment,
  type IssueBranchContainment,
} from '../pipeline-membership-gather.js';
import {
  acceptFlagFor,
  BRANCH_ABSENT_MERGE_ERROR,
  canAcceptDodMisses,
  DOD_ROWS,
  type DodGateResult,
  type DodRowId,
  type DodRowResult,
} from './dod.js';
import type { LifecycleContext, StepResult } from './types.js';

const execFileAsync = promisify(execFile);

type StatusSource =
  | { source: 'live'; status: ReviewStatus }
  | { source: 'journal'; status: PanIssuePipelineRecord }
  | null;
type Awaitable<T> = T | Promise<T>;

export interface DodStatusRowDeps {
  getReviewStatus: (issueId: string) => Awaitable<ReviewStatus | null>;
  getJournalStatus: (issueId: string) => Awaitable<PanIssuePipelineRecord | null>;
}

export interface MergedDodRowResult extends DodRowResult {
  mergedAt?: string;
  mergeCommit?: string;
  evidence?: 'branch-containment';
}

interface MergedRowDeps {
  verifyMerged: (ctx: LifecycleContext) => Promise<StepResult>;
  readPullRequest: (ctx: LifecycleContext, branchName: string) => Promise<{
    number?: number;
    state?: string;
    mergedAt?: string;
    mergeCommit?: { oid?: string } | string | null;
  }>;
  readDurableMerges?: (ctx: LifecycleContext) => Promise<string[]>;
  readBranchContainment?: (ctx: LifecycleContext) => Promise<IssueBranchContainment>;
}

const defaultMergedRowDeps: MergedRowDeps = {
  verifyMerged: async () => ({
    step: 'close-out:verify-merged',
    success: false,
    skipped: false,
    error: 'merge verifier was not supplied',
  }),
  readPullRequest: async (ctx, branchName) => {
    if (!ctx.github) return {};
    void branchName;
    const response = await fetchIssuePullRequest(ctx.issueId);
    if (response.error) throw new Error(response.error);
    return response.pr ?? {};
  },
  readDurableMerges: async ctx => {
    const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
    return (await readIssueRecord(project, ctx.issueId))?.closeOut.merges ?? [];
  },
  readBranchContainment: async ctx => {
    const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
    if (!project) return { unmergedRefs: [], mergedWorkRefs: [], pointerRefs: [] };
    return gatherIssueBranchContainment(project, ctx.issueId);
  },
};

interface PostMergeRowDeps {
  readCanonicalState: (ctx: LifecycleContext) => Promise<CanonicalState | null>;
  readMergeStatus: (issueId: string) => Awaitable<string | undefined>;
  listAgents: () => Awaitable<Array<Pick<AgentState, 'id' | 'issueId' | 'role' | 'status'>>>;
  readStrikeLanded?: (issueId: string) => Awaitable<boolean>;
}

const defaultPostMergeRowDeps: PostMergeRowDeps = {
  readStrikeLanded: async issueId => strikeLanded((await loadStatus(issueId, defaultDeps))?.status),
  readCanonicalState: async ctx => {
    return getAutoCloseOutCanonicalState(ctx.issueId) as Promise<CanonicalState | null>;
  },
  readMergeStatus: async issueId => (await Effect.runPromise(getReviewStatus(issueId)))?.mergeStatus,
  listAgents: async () => Effect.runPromise(listRunningAgents()),
};

interface MainVerifyRowDeps {
  readCheckRuns: (ctx: LifecycleContext, mergeCommit: string) => Promise<{
    total: number;
    failed: string[];
    pending: string[];
  }>;
}

const defaultMainVerifyRowDeps: MainVerifyRowDeps = {
  readCheckRuns: async (ctx, mergeCommit) => {
    if (!ctx.github) return { total: 0, failed: [], pending: [] };
    return fetchCommitCheckRuns(ctx.github.owner, ctx.github.repo, mergeCommit);
  },
};

interface DeployRowDeps {
  dashboardUrl: () => string;
  readJson: (url: string) => Promise<Record<string, unknown>>;
  commitContains: (repoRoot: string, mergeCommit: string, buildCommit: string) => Promise<boolean>;
}

export interface TerminalVerdictSettlement {
  trackerClosed: boolean;
  landedWork: boolean;
  mainVerifyStatus: DodRowResult['status'];
}

export interface EvaluateDodGateDeps {
  review: (issueId: string, settlement?: TerminalVerdictSettlement) => DodRowResult | Promise<DodRowResult>;
  tests: (issueId: string, settlement?: TerminalVerdictSettlement) => DodRowResult | Promise<DodRowResult>;
  verification: (issueId: string, settlement?: TerminalVerdictSettlement) => DodRowResult | Promise<DodRowResult>;
  merged: (ctx: LifecycleContext) => MergedDodRowResult | Promise<MergedDodRowResult>;
  postMerge: (ctx: LifecycleContext, merged?: MergedDodRowResult) => DodRowResult | Promise<DodRowResult>;
  mainVerify: (ctx: LifecycleContext, mergeCommit?: string) => DodRowResult | Promise<DodRowResult>;
  deploy: (ctx: LifecycleContext, merge: {
    mergedAt?: string;
    mergeCommit?: string;
    mergedRowStatus?: DodRowResult['status'];
    mainVerifyRowStatus?: DodRowResult['status'];
  }) => DodRowResult | Promise<DodRowResult>;
  trackerClosed?: (issueId: string) => Awaitable<boolean>;
  now: () => string;
}

const defaultEvaluateDodGateDeps: EvaluateDodGateDeps = {
  review: (issueId, settlement) => checkReviewRow(issueId, defaultDeps, settlement),
  tests: (issueId, settlement) => checkTestsRow(issueId, defaultDeps, settlement),
  verification: (issueId, settlement) => checkVerificationRow(issueId, defaultDeps, settlement),
  merged: checkMergedRow,
  postMerge: checkPostMergeRow,
  mainVerify: checkMainVerifyRow,
  deploy: checkDeployRow,
  trackerClosed: isIssueClosed,
  now: () => new Date().toISOString(),
};

const defaultDeployRowDeps: DeployRowDeps = {
  dashboardUrl: getDashboardApiUrlSync,
  readJson: async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json() as Promise<Record<string, unknown>>;
  },
  commitContains: async (repoRoot, mergeCommit, buildCommit) => {
    try {
      await execFileAsync('git', ['merge-base', '--is-ancestor', mergeCommit, buildCommit], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  },
};

const defaultDeps: DodStatusRowDeps = {
  getReviewStatus: issueId => Effect.runPromise(getReviewStatus(issueId)),
  getJournalStatus: async issueId => {
    const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
    return (await readIssueRecord(project, issueId))?.pipeline ?? null;
  },
};

function rowDefinition(id: DodRowId) {
  const row = DOD_ROWS.find(candidate => candidate.id === id);
  if (!row) throw new Error(`Unknown DoD row: ${id}`);
  return row;
}

function result(id: DodRowId, status: DodRowResult['status'], observed: string): DodRowResult {
  const row = rowDefinition(id);
  return { id, num: row.num, title: row.title, expected: row.expected, observed, status };
}

async function loadStatus(issueId: string, deps: DodStatusRowDeps): Promise<StatusSource> {
  try {
    const live = await deps.getReviewStatus(issueId);
    if (live) return { source: 'live', status: live };
    const journal = await deps.getJournalStatus(issueId);
    return journal ? { source: 'journal', status: journal } : null;
  } catch {
    return null;
  }
}

/**
 * PAN-3180: `landed` is the strike path's own durable statement that this issue's
 * work reached main through `strike/<id>`. It is written by the server merge door
 * (`mergeCompletionStatus` in `merge-strike.ts`) and mirrored into the per-issue
 * record's `pipeline` block, so it outlives review-status clearing. Every earlier
 * landing state (`ready`/`landing`/`recovering`/`needs_you`) is a strike still in
 * flight and earns no waiver.
 */
function strikeLanded(status: StrikeLandingStatus | null | undefined): boolean {
  return status?.strikeLandingState === 'landed';
}

/**
 * PAN-3180: a strike dispatches neither a review nor a test specialist — that
 * bypass is the whole point of the path. So for a strike-landed issue these rows
 * are `skip` (deliberately not run), never `pass` (ran and succeeded) and never
 * `miss` (outstanding). A reader of the close-out record still sees the real
 * verdict and the reason it was never produced.
 */
const STRIKE_BYPASS_NOTE: Record<'review' | 'tests', string> = {
  review: 'no review specialist is dispatched for a strike',
  tests: 'no test specialist is dispatched for a strike',
};

/**
 * A specialist that ran and returned a negative verdict is a different fact from
 * one that was never dispatched, so the strike waiver never covers it — those
 * still block until an operator records an explicit `--accept-<row>` override.
 */
const NEGATIVE_VERDICTS = new Set(['failed', 'blocked', 'dispatch_failed']);

/**
 * PAN-3187: a tracker-closed issue with landed work cannot produce a verdict it
 * never produced while active. Negative test/verification verdicts settle only
 * when main verification proves the landed state green; review negatives remain.
 */
function terminalVerdictSettlement(
  id: 'review' | 'tests' | 'verification',
  value: string | undefined,
  observed: string,
  settlement?: TerminalVerdictSettlement,
): DodRowResult | null {
  if (!settlement?.trackerClosed || !settlement.landedWork) return null;
  if (!NEGATIVE_VERDICTS.has(value ?? '')) {
    return result(
      id,
      'skip',
      `${observed}; settled because the tracker issue is closed and merged work is landed`,
    );
  }
  if (id !== 'review' && settlement.mainVerifyStatus === 'pass') {
    return result(
      id,
      'skip',
      `${observed}; superseded because the tracker issue is closed, merged work is landed, and main verification passed`,
    );
  }
  return null;
}

async function checkVerdict(
  issueId: string,
  id: 'review' | 'tests',
  field: 'reviewStatus' | 'testStatus',
  deps: DodStatusRowDeps,
  settlement?: TerminalVerdictSettlement,
): Promise<DodRowResult> {
  const loaded = await loadStatus(issueId, deps);
  if (!loaded) return result(id, 'miss', 'no review status or journal record found');

  const value = loaded.status[field];
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const observed = `${field}: ${value ?? 'missing'}${source}${policy}`;
  if (value === 'passed' || value === 'skipped') return result(id, 'pass', observed);
  if (strikeLanded(loaded.status) && !NEGATIVE_VERDICTS.has(value ?? '')) {
    return result(
      id,
      'skip',
      `${observed}; skipped by the strike path (strikeLandingState: landed) — ${STRIKE_BYPASS_NOTE[id]}`,
    );
  }
  return terminalVerdictSettlement(id, value, observed, settlement) ?? result(id, 'miss', observed);
}

export function checkReviewRow(
  issueId: string,
  deps: DodStatusRowDeps = defaultDeps,
  settlement?: TerminalVerdictSettlement,
): Promise<DodRowResult> {
  return checkVerdict(issueId, 'review', 'reviewStatus', deps, settlement);
}

export function checkTestsRow(
  issueId: string,
  deps: DodStatusRowDeps = defaultDeps,
  settlement?: TerminalVerdictSettlement,
): Promise<DodRowResult> {
  return checkVerdict(issueId, 'tests', 'testStatus', deps, settlement);
}

export async function checkVerificationRow(
  issueId: string,
  deps: DodStatusRowDeps = defaultDeps,
  settlement?: TerminalVerdictSettlement,
): Promise<DodRowResult> {
  const loaded = await loadStatus(issueId, deps);
  if (!loaded) return result('verification', 'miss', 'no review status or journal record found');

  // PAN-3067: the verdict alone decides this row, exactly like rows 1 and 2.
  // `lastVerifiedCommit` is a best-effort optimization anchor — verification-runner.ts
  // snapshots it inside a try/catch and spreads the field conditionally, and a
  // `skipped` verdict never has one at all — so its absence says nothing about
  // whether verification ran. Requiring it made every issue whose anchor was
  // never written un-closable. The observed string always names the anchor's
  // presence or absence so a reader can never mistake it for a hidden condition.
  const value = loaded.status.verificationStatus;
  const commit = loaded.status.lastVerifiedCommit;
  const accepted = value === 'passed' || value === 'skipped';
  const notes: string[] = [];
  if (loaded.source === 'journal') notes.push('from pipeline journal');
  if (value === 'skipped') notes.push('skipped per issue policy');
  if (accepted && !commit) notes.push('no lastVerifiedCommit recorded');
  const observed = `verificationStatus: ${value ?? 'missing'}${commit ? ` at ${commit}` : ''}${
    notes.length > 0 ? ` (${notes.join('; ')})` : ''
  }`;
  if (accepted) return result('verification', 'pass', observed);
  return terminalVerdictSettlement('verification', value, observed, settlement) ??
    result('verification', 'miss', observed);
}

export async function checkMergedRow(
  ctx: LifecycleContext,
  deps: MergedRowDeps = defaultMergedRowDeps,
): Promise<MergedDodRowResult> {
  const verified: StepResult = await deps.verifyMerged(ctx).catch(error => ({
    step: 'close-out:verify-merged',
    success: false,
    skipped: false,
    error: error instanceof Error ? error.message : String(error),
  }));
  const detail = verified.details?.join('; ');
  const observed = detail || verified.error || (verified.skipped ? 'issue already closed on forge' : 'merge not verified');
  const merged = result('merged', verified.success || verified.skipped ? 'pass' : 'miss', observed) as MergedDodRowResult;
  const branchAbsent = verified.error === BRANCH_ABSENT_MERGE_ERROR;
  let durableMerges: string[] = [];

  if (branchAbsent) {
    try {
      durableMerges = await (deps.readDurableMerges ?? defaultMergedRowDeps.readDurableMerges!)(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      merged.observed = `${merged.observed}; durable merge evidence unavailable: ${message}`;
    }
  }

  let pullRequestState: string | undefined;
  if (ctx.github) {
    try {
      const branchName = `feature/${ctx.issueId.toLowerCase()}`;
      const pullRequest = await deps.readPullRequest(ctx, branchName);
      pullRequestState = pullRequest.state;
      merged.mergedAt = pullRequest.mergedAt;
      merged.mergeCommit = typeof pullRequest.mergeCommit === 'string'
        ? pullRequest.mergeCommit
        : pullRequest.mergeCommit?.oid;
      const number = pullRequest.number ? `PR #${pullRequest.number}` : 'PR';
      const state = pullRequest.state ?? 'state unknown';
      const at = pullRequest.mergedAt ? ` at ${pullRequest.mergedAt}` : '';
      merged.observed = `${merged.observed}; ${number} ${state}${at}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      merged.observed = `${merged.observed}; forge metadata unavailable: ${message}`;
    }
  }

  if (branchAbsent) {
    const forgeMerged = pullRequestState?.toUpperCase() === 'MERGED';
    if (durableMerges.length > 0 || forgeMerged) {
      merged.status = 'pass';
      if (durableMerges.length > 0) {
        merged.observed = `${merged.observed}; durable close-out record contains ${durableMerges.length} merge artifact(s)`;
      }
    } else {
      merged.observed = `${merged.observed}; no merged forge artifact or durable close-out merge record found`;
    }
  }

  if (merged.status === 'miss') {
    try {
      const containment = await (deps.readBranchContainment ?? defaultMergedRowDeps.readBranchContainment!)(ctx);
      if (containment.mergedWorkRefs.length > 0 && containment.unmergedRefs.length === 0) {
        merged.status = 'pass';
        merged.evidence = 'branch-containment';
        merged.observed = `${merged.observed}; branch work contained in default branch with no merged PR — non-PR landing (membership L2-work lens): ${containment.mergedWorkRefs.join(', ')}`;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      merged.observed = `${merged.observed}; branch containment evidence unavailable: ${message}`;
    }
  }

  return merged;
}

export async function checkPostMergeRow(
  ctx: LifecycleContext,
  merged?: MergedDodRowResult,
  deps: PostMergeRowDeps = defaultPostMergeRowDeps,
): Promise<DodRowResult> {
  try {
    const canonicalState = await deps.readCanonicalState(ctx);
    const mergeStatus = await deps.readMergeStatus(ctx.issueId);
    const issueId = ctx.issueId.toUpperCase();
    const runningAgents = (await deps.listAgents()).filter(agent =>
      agent.issueId.toUpperCase() === issueId &&
      (agent.role === 'work' || agent.role === 'plan') &&
      (agent.status === 'starting' || agent.status === 'running'),
    );
    const stateObserved = canonicalState
      ? `canonical state: ${canonicalState}`
      : `canonical state unavailable; mergeStatus: ${mergeStatus ?? 'missing'}`;
    const agentsObserved = runningAgents.length > 0
      ? `running agents: ${runningAgents.map(agent => agent.id).join(', ')}`
      : 'no running work/planning agents';
    // PAN-3188 (row 5): terminal canonical states settle this row. 'done'
    // proves the post-merge lifecycle already ran to close-out; 'canceled'
    // makes it moot. Requiring the transient verifying_on_main marker here
    // wedges every re-evaluated terminal issue (the 11 closed issues that
    // blocked close-out sweeps on 'canonical state: done').
    if (canonicalState === 'done') {
      return result(
        'post-merge',
        runningAgents.length === 0 ? 'pass' : 'miss',
        `terminal canonical state: done — the post-merge lifecycle already ran to close-out; ${agentsObserved}`,
      );
    }
    if (canonicalState === 'canceled') {
      return result(
        'post-merge',
        runningAgents.length === 0 ? 'skip' : 'miss',
        `terminal canonical state: canceled — post-merge lifecycle not applicable; ${agentsObserved}`,
      );
    }
    const lifecycleObserved = canonicalState === 'verifying_on_main' || mergeStatus === 'merged';
    // PAN-3180: `postMergeLifecycle()` is the work-agent handoff — it pauses the
    // work/planning agents, stops the workspace stack, and applies
    // `verifying-on-main`. A strike has no work agent to pause and its landing is
    // owned by the Deacon's merge door, so the marker this row looks for is never
    // written and its absence proves nothing. What a strike does still owe is
    // quiescence, so a live work/planning agent remains a real miss.
    if (!lifecycleObserved && await (deps.readStrikeLanded ?? defaultPostMergeRowDeps.readStrikeLanded!)(ctx.issueId)) {
      return result(
        'post-merge',
        runningAgents.length === 0 ? 'skip' : 'miss',
        `strike landing (strikeLandingState: landed) — the work-agent post-merge handoff is not the strike path's lifecycle; ${stateObserved}; ${agentsObserved}`,
      );
    }
    if (!lifecycleObserved && merged?.evidence === 'branch-containment') {
      return result(
        'post-merge',
        runningAgents.length === 0 ? 'pass' : 'miss',
        `non-PR landing (branch-containment evidence) — post-merge lifecycle not applicable; ${agentsObserved}`,
      );
    }
    return result(
      'post-merge',
      lifecycleObserved && runningAgents.length === 0 ? 'pass' : 'miss',
      `${stateObserved}; ${agentsObserved}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result('post-merge', 'miss', `post-merge evidence unavailable: ${message}`);
  }
}

export async function checkMainVerifyRow(
  ctx: LifecycleContext,
  mergeCommit?: string,
  deps: MainVerifyRowDeps = defaultMainVerifyRowDeps,
): Promise<DodRowResult> {
  if (!ctx.github || !mergeCommit) {
    return result(
      'main-verify',
      'skip',
      'no merge commit resolvable — verified-on-main has no durable marker (see DoD row 6)',
    );
  }

  try {
    const checks = await deps.readCheckRuns(ctx, mergeCommit);
    if (checks.total === 0) {
      return result('main-verify', 'skip', `no CI check-runs on merge commit ${mergeCommit}`);
    }
    if (checks.failed.length > 0 || checks.pending.length > 0) {
      const parts = [
        ...(checks.failed.length > 0 ? [`failed checks: ${checks.failed.join(', ')}`] : []),
        ...(checks.pending.length > 0 ? [`still running: ${checks.pending.join(', ')}`] : []),
      ];
      return result('main-verify', 'miss', `${parts.join('; ')} on ${mergeCommit}`);
    }
    return result('main-verify', 'pass', `${checks.total} check-runs concluded successfully on ${mergeCommit}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result('main-verify', 'miss', `could not read merge-commit check-runs: ${message}`);
  }
}

export async function checkDeployRow(
  ctx: LifecycleContext,
  merge: {
    mergedAt?: string;
    mergeCommit?: string;
    mergedRowStatus?: DodRowResult['status'];
    mainVerifyRowStatus?: DodRowResult['status'];
  },
  deps: DeployRowDeps = defaultDeployRowDeps,
): Promise<DodRowResult> {
  if (!merge.mergeCommit) {
    if (merge.mergedRowStatus === 'miss') {
      return result(
        'deploy',
        'skip',
        'no merge commit resolved because the merged row missed — deploy ancestry depends on row 4; build ancestry unchecked',
      );
    }
    // PAN-3188: row 6 (main-verify) skips whenever no merge commit is
    // resolvable — the no-durable-anchor landing class (e.g. GitLab-backed
    // landings whose row 4 evidence is the merge specialist's confirmation).
    // Row 7 must agree: same missing anchor, same skip. Only when main-verify
    // did NOT skip is the absent commit an integrity problem worth a miss.
    if (merge.mainVerifyRowStatus === 'skip') {
      return result(
        'deploy',
        'skip',
        'verified-on-main skipped — no merge commit resolvable, so deploy build-ancestry has no durable anchor either (same landing class as DoD row 6 skip)',
      );
    }
    return result('deploy', 'miss', 'merged row passed without a resolvable merge commit; build ancestry cannot be checked');
  }

  const baseUrl = deps.dashboardUrl().replace(/\/$/, '');
  let health: Record<string, unknown>;
  try {
    health = await deps.readJson(`${baseUrl}/api/health`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result('deploy', 'miss', `dashboard not reachable at ${baseUrl} — a merged fix is not live if no server is serving it: ${message}`);
  }

  const repoRoot = typeof health.repoRoot === 'string' ? health.repoRoot : '';
  if (!repoRoot) return result('deploy', 'miss', `dashboard at ${baseUrl} did not report repoRoot`);
  if (resolve(repoRoot) !== resolve(ctx.projectPath)) {
    return result('deploy', 'skip', `live dashboard serves ${repoRoot}, not this project — deploy semantics undefined for ${ctx.projectPath}`);
  }

  const buildCommit = typeof health.buildCommit === 'string' && health.buildCommit.trim()
    ? health.buildCommit
    : undefined;
  if (!buildCommit) {
    return result('deploy', 'miss', `dashboard at ${baseUrl} did not report buildCommit; live deployment cannot be proven`);
  }
  try {
    if (health.buildDirty === true) {
      return result(
        'deploy',
        'miss',
        `live build ${buildCommit.slice(0, 8)} was built from a dirty working tree — uncommitted changes may be serving; redeploy canonically with \`pan reload\``,
      );
    }

    const canonical = await deps.commitContains(repoRoot, buildCommit, 'origin/main');
    if (!canonical) {
      return result(
        'deploy',
        'miss',
        `live build commit ${buildCommit.slice(0, 8)} is not an ancestor of origin/main — the server is running a build of local-only commits; redeploy with \`pan reload\``,
      );
    }

    const contains = await deps.commitContains(repoRoot, merge.mergeCommit, buildCommit);
    const observed = `build commit ${buildCommit.slice(0, 8)} ${contains ? 'contains' : 'does not contain'} merge ${merge.mergeCommit.slice(0, 8)}`;
    return result('deploy', contains ? 'pass' : 'miss', observed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result('deploy', 'miss', `deploy evidence unavailable: ${message}`);
  }
}

export async function evaluateDodGate(
  ctx: LifecycleContext,
  opts: {
    acceptedRows?: DodRowId[];
    acceptedBy?: string;
    verifyMerged?: MergedRowDeps['verifyMerged'];
  } = {},
  deps: EvaluateDodGateDeps = defaultEvaluateDodGateDeps,
): Promise<DodGateResult> {
  const acceptedRows = new Set(opts.acceptedRows ?? []);
  const overridable = new Set(DOD_ROWS.filter(row => row.overridable).map(row => row.id));
  for (const id of acceptedRows) {
    if (!overridable.has(id)) throw new TypeError(`DoD row "${id}" cannot be accepted; valid rows: ${[...overridable].join(', ')}`);
  }
  const by = opts.acceptedBy ?? process.env.OVERDECK_AGENT_ID ?? userInfo().username;
  if (acceptedRows.size > 0 && !canAcceptDodMisses(by)) {
    throw new TypeError('The flywheel orchestrator cannot accept missed Definition-of-Done rows; an operator must apply --accept-<row> overrides.');
  }

  const merged = opts.verifyMerged
    ? await checkMergedRow(ctx, { ...defaultMergedRowDeps, verifyMerged: opts.verifyMerged })
    : await deps.merged(ctx);
  // Main-verify computes before deploy because deploy's no-merge-commit
  // branch keys on main-verify's outcome (PAN-3188: row 7 skips when row 6
  // skips — both mean "no durable anchor" for this landing class). The verdict
  // rows also need this landed-state evidence before they can settle terminal issues.
  const mainVerify = await deps.mainVerify(ctx, merged.mergeCommit);
  const trackerClosed = await (deps.trackerClosed ?? defaultEvaluateDodGateDeps.trackerClosed!)(ctx.issueId);
  const settlement: TerminalVerdictSettlement = {
    trackerClosed,
    landedWork: merged.status === 'pass',
    mainVerifyStatus: mainVerify.status,
  };
  const [review, tests, verification, postMerge, deploy] = await Promise.all([
    deps.review(ctx.issueId, settlement),
    deps.tests(ctx.issueId, settlement),
    deps.verification(ctx.issueId, settlement),
    deps.postMerge(ctx, merged),
    deps.deploy(ctx, {
      mergedAt: merged.mergedAt,
      mergeCommit: merged.mergeCommit,
      mergedRowStatus: merged.status,
      mainVerifyRowStatus: mainVerify.status,
    }),
  ]);
  const rows = [review, tests, verification, merged, postMerge, mainVerify, deploy];
  for (const row of rows) {
    if (row.status === 'miss' && acceptedRows.has(row.id)) {
      row.acceptedBy = { flag: acceptFlagFor(rowDefinition(row.id)), by, at: deps.now() };
    }
  }
  const misses = rows.filter(row => row.status === 'miss').map(row => row.id);
  const accepted = rows.filter(row => row.acceptedBy).map(row => row.id);
  return {
    rows,
    misses,
    accepted,
    passed: rows.every(row => row.status !== 'miss' || Boolean(row.acceptedBy)),
  };
}
