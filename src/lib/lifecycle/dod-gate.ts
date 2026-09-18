/** Mechanical Definition-of-Done row checks. */

import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CanonicalState } from '../../core/state-mapping.js';
import { Effect } from 'effect';
import { listRunningAgents, type AgentState } from '../agents.js';
import { getDashboardApiUrlSync } from '../config.js';
import {
  getIssueWorkspacePath,
  getProjectConfigFromWorkspacePath,
  resolveProjectForIssue,
} from '../overdeck/issue-projects.js';
import type { ProjectConfig } from '../projects.js';
import { getAutoCloseOutCanonicalState } from '../cloister/deacon-canonical-state.js';
import { isTrackerIssueClosed } from '../cloister/issue-closed.js';
import { readVerificationArtifact, type VerificationArtifact } from '../cloister/verification-artifact.js';
import {
  fetchCommitCheckRuns,
  fetchIssuePullRequest,
  fetchRequiredStatusChecks,
  type CommitCheckRuns,
  type IssuePullRequestData,
} from '../overdeck/pull-requests.js';
import { getForgeAdapter } from '../forge.js';
import { resolveProjectReposForIssueSync } from '../project-repos.js';
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

type Awaitable<T> = T | Promise<T>;

/**
 * PAN-3917: the verdict rows read their owners, not a stored copy. Review is the
 * PR's review decision, tests are the PR's check-run rollup, and verification is
 * the workspace's `verification-latest.json` artifact (FR-8).
 */
export interface DodStatusRowDeps {
  readPullRequest: (issueId: string) => Awaitable<IssuePullRequestData | null>;
  readVerification: (issueId: string) => Awaitable<VerificationArtifact | null>;
}

/** Landing evidence the verdict rows need; `checkMergedRow` computes it from git and the forge. */
export interface LandingEvidence {
  /** The work reached main through `strike/<id>` rather than a PR. */
  strikeLanded: boolean;
}

export interface MergedDodRowResult extends DodRowResult {
  mergedAt?: string;
  mergeCommit?: string;
  evidence?: 'branch-containment';
  containedStrikeHead?: string;
}

interface MergedForgeArtifact {
  forge: string;
  url?: string;
  id?: string;
}

interface MergedRowDeps {
  verifyMerged: (ctx: LifecycleContext) => Promise<StepResult>;
  readPullRequest: (ctx: LifecycleContext, branchName: string) => Promise<{
    number?: number;
    state?: string;
    mergedAt?: string;
    mergeCommit?: { oid?: string } | string | null;
  }>;
  readMergedForgeArtifacts?: (ctx: LifecycleContext) => Promise<MergedForgeArtifact[]>;
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
  readMergedForgeArtifacts: async ctx => {
    const repos = resolveProjectReposForIssueSync(ctx.issueId)?.filter(repo => repo.required) ?? [];
    const artifacts = await Promise.all(repos.map(repo => getForgeAdapter(repo.forge).findMergedArtifact({
      sourceBranch: repo.sourceBranch,
      targetBranch: repo.targetBranch,
      cwd: repo.repoPath,
    })));
    return artifacts.filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null);
  },
  readBranchContainment: async ctx => {
    const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
    if (!project) return { unmergedRefs: [], mergedWorkRefs: [], pointerRefs: [] };
    return gatherIssueBranchContainment(project, ctx.issueId);
  },
};

interface PostMergeRowDeps {
  readCanonicalState: (ctx: LifecycleContext) => Promise<CanonicalState | null>;
  /** The PR's own merge timestamp — the forge owns "merged", not a record. */
  readMergedAt: (issueId: string) => Awaitable<string | undefined>;
  listAgents: () => Awaitable<Array<Pick<AgentState, 'id' | 'issueId' | 'role' | 'status'>>>;
}

const defaultPostMergeRowDeps: PostMergeRowDeps = {
  readCanonicalState: async ctx => {
    return getAutoCloseOutCanonicalState(ctx.issueId) as Promise<CanonicalState | null>;
  },
  readMergedAt: async issueId => (await defaultDeps.readPullRequest(issueId))?.mergedAt,
  listAgents: async () => Effect.runPromise(listRunningAgents()),
};

export const DEFAULT_MAIN_VERIFY_REQUIRED_CHECKS = ['test', 'lint', 'build (22)', 'guard'];

interface MainVerifyRowDeps {
  readCheckRuns: (ctx: LifecycleContext, commit: string) => Promise<CommitCheckRuns>;
  readRequiredChecks?: (ctx: LifecycleContext) => Promise<string[]>;
  /**
   * PAN-3202: default-branch commits that contain `mergeCommit`, newest first.
   * These are the candidate heads for the later-green-run evidence form.
   */
  readContainingDefaultBranchCommits?: (ctx: LifecycleContext, mergeCommit: string) => Promise<string[]>;
}

function configuredMainVerifyChecks(ctx: LifecycleContext): string[] {
  const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
  return project?.main_verify_required_checks?.length
    ? project.main_verify_required_checks
    : DEFAULT_MAIN_VERIFY_REQUIRED_CHECKS;
}

export async function readContainingDefaultBranchCommits(
  ctx: LifecycleContext,
  mergeCommit: string,
): Promise<string[]> {
  const options = { cwd: ctx.projectPath, encoding: 'utf-8' as const, timeout: 10000, maxBuffer: 8 * 1024 * 1024 };
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', mergeCommit, 'origin/main'], options);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) return [];
    throw error;
  }

  const { stdout } = await execFileAsync(
    'git',
    ['rev-list', '--first-parent', `${mergeCommit}..origin/main`],
    options,
  );
  return stdout.split('\n').map(line => line.trim()).filter(Boolean);
}

const defaultMainVerifyRowDeps: MainVerifyRowDeps = {
  readCheckRuns: async (ctx, commit) => {
    if (!ctx.github) return { total: 0, names: [], successful: [], failed: [], pending: [] };
    return fetchCommitCheckRuns(ctx.github.owner, ctx.github.repo, commit);
  },
  readRequiredChecks: async ctx => {
    if (!ctx.github) return configuredMainVerifyChecks(ctx);
    return fetchRequiredStatusChecks(ctx.github.owner, ctx.github.repo, 'main', configuredMainVerifyChecks(ctx));
  },
  readContainingDefaultBranchCommits,
};

/**
 * PAN-3917 (D6): a ship is a git tag plus the version strings it propagated.
 * `readShippedVersion` is the newest release tag reachable from `origin/main`;
 * `readExpectPath` is a declared `version_sync.expect` file read at that same
 * commit. Nothing is stored: the row re-derives from the repo every time.
 */
interface ShipRowDeps {
  readProject: (ctx: LifecycleContext) => ProjectConfig | null;
  readShippedVersion: (ctx: LifecycleContext) => Promise<string | null>;
  readExpectPath: (ctx: LifecycleContext, path: string) => Promise<string | null>;
}

const gitOptions = (cwd: string) => ({ cwd, encoding: 'utf-8' as const, timeout: 10000, maxBuffer: 8 * 1024 * 1024 });

const defaultShipRowDeps: ShipRowDeps = {
  readProject: ctx => resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath),
  readShippedVersion: async ctx => {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['describe', '--tags', '--abbrev=0', '--match', 'v*', 'origin/main'],
        gitOptions(ctx.projectPath),
      );
      return stdout.trim().replace(/^v/, '') || null;
    } catch {
      return null;
    }
  },
  readExpectPath: async (ctx, path) => {
    try {
      const { stdout } = await execFileAsync('git', ['show', `origin/main:${path}`], gitOptions(ctx.projectPath));
      return stdout;
    } catch {
      return null;
    }
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
  review: (issueId: string, settlement?: TerminalVerdictSettlement, landing?: LandingEvidence) => DodRowResult | Promise<DodRowResult>;
  tests: (issueId: string, settlement?: TerminalVerdictSettlement, landing?: LandingEvidence) => DodRowResult | Promise<DodRowResult>;
  verification: (issueId: string, settlement?: TerminalVerdictSettlement, landing?: LandingEvidence) => DodRowResult | Promise<DodRowResult>;
  merged: (ctx: LifecycleContext) => MergedDodRowResult | Promise<MergedDodRowResult>;
  postMerge: (ctx: LifecycleContext, merged?: MergedDodRowResult) => DodRowResult | Promise<DodRowResult>;
  mainVerify: (ctx: LifecycleContext, mergeCommit?: string) => DodRowResult | Promise<DodRowResult>;
  ship: (ctx: LifecycleContext) => DodRowResult | Promise<DodRowResult>;
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
  review: (issueId, settlement, landing) => checkReviewRow(issueId, defaultDeps, settlement, landing),
  tests: (issueId, settlement, landing) => checkTestsRow(issueId, defaultDeps, settlement, landing),
  verification: (issueId, settlement, landing) => checkVerificationRow(issueId, defaultDeps, settlement, landing),
  merged: checkMergedRow,
  postMerge: checkPostMergeRow,
  mainVerify: checkMainVerifyRow,
  ship: checkShipRow,
  deploy: checkDeployRow,
  trackerClosed: isTrackerIssueClosed,
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
  readPullRequest: async issueId => {
    const response = await fetchIssuePullRequest(issueId);
    return response.error ? null : response.pr;
  },
  readVerification: issueId => {
    const workspacePath = getIssueWorkspacePath(issueId);
    return workspacePath ? readVerificationArtifact(workspacePath) : null;
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

/** The PR's check-run rollup, collapsed to the one question row 2 asks. */
function checksOutcome(pr: IssuePullRequestData): { state: 'green' | 'red' | 'pending' | 'none'; detail: string } {
  const runs = pr.statusCheckRollup ?? [];
  if (runs.length === 0) return { state: 'none', detail: 'no checks reported on the pull request' };
  const verdict = (run: { conclusion?: string | null; status?: string | null; state?: string | null }) =>
    (run.conclusion ?? run.state ?? run.status ?? '').toUpperCase();
  const failed = runs.filter(run => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(verdict(run)));
  if (failed.length > 0) return { state: 'red', detail: `${failed.length} of ${runs.length} check(s) not green` };
  const pending = runs.filter(run => !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(verdict(run)));
  if (pending.length > 0) return { state: 'pending', detail: `${pending.length} of ${runs.length} check(s) still running` };
  return { state: 'green', detail: `all ${runs.length} check(s) green` };
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
  deps: DodStatusRowDeps,
  settlement?: TerminalVerdictSettlement,
  landing?: LandingEvidence,
): Promise<DodRowResult> {
  const pr = await Promise.resolve(deps.readPullRequest(issueId)).catch(() => null);

  if (!pr) {
    const observed = 'no pull request found on the forge for this issue';
    if (landing?.strikeLanded) {
      return result(id, 'skip', `${observed}; skipped by the strike path — ${STRIKE_BYPASS_NOTE[id]}`);
    }
    return terminalVerdictSettlement(id, undefined, observed, settlement) ?? result(id, 'miss', observed);
  }

  if (id === 'review') {
    const decision = pr.reviewDecision ?? 'none';
    const observed = `PR #${pr.number} reviewDecision: ${decision}`;
    if (decision === 'APPROVED') return result('review', 'pass', observed);
    if (landing?.strikeLanded && decision !== 'CHANGES_REQUESTED') {
      return result('review', 'skip', `${observed}; skipped by the strike path — ${STRIKE_BYPASS_NOTE.review}`);
    }
    const negative = decision === 'CHANGES_REQUESTED' ? 'failed' : undefined;
    return terminalVerdictSettlement('review', negative, observed, settlement) ?? result('review', 'miss', observed);
  }

  const checks = checksOutcome(pr);
  const observed = `PR #${pr.number} checks: ${checks.detail}`;
  if (checks.state === 'green') return result('tests', 'pass', observed);
  if (landing?.strikeLanded && checks.state !== 'red') {
    return result('tests', 'skip', `${observed}; skipped by the strike path — ${STRIKE_BYPASS_NOTE.tests}`);
  }
  const negative = checks.state === 'red' ? 'failed' : undefined;
  return terminalVerdictSettlement('tests', negative, observed, settlement) ?? result('tests', 'miss', observed);
}

export function checkReviewRow(
  issueId: string,
  deps: DodStatusRowDeps = defaultDeps,
  settlement?: TerminalVerdictSettlement,
  landing?: LandingEvidence,
): Promise<DodRowResult> {
  return checkVerdict(issueId, 'review', deps, settlement, landing);
}

export function checkTestsRow(
  issueId: string,
  deps: DodStatusRowDeps = defaultDeps,
  settlement?: TerminalVerdictSettlement,
  landing?: LandingEvidence,
): Promise<DodRowResult> {
  return checkVerdict(issueId, 'tests', deps, settlement, landing);
}

/**
 * Row 3 reads the verification artifact the runner writes into the workspace
 * (FR-8). A missing artifact is a real miss: nothing ran, or the workspace is
 * already gone — in which case a landed, green main settles the row below.
 */
export async function checkVerificationRow(
  issueId: string,
  deps: DodStatusRowDeps = defaultDeps,
  settlement?: TerminalVerdictSettlement,
  landing?: LandingEvidence,
): Promise<DodRowResult> {
  const artifact = await Promise.resolve(deps.readVerification(issueId)).catch(() => null);
  const outcome = artifact?.outcome;
  const observed = artifact
    ? `verification artifact: ${outcome}${artifact.ranAt ? ` at ${artifact.ranAt}` : ''}${
        artifact.failedCheck ? ` (${artifact.failedCheck})` : ''
      }`
    : 'no verification artifact in the workspace';

  if (outcome === 'passed') return result('verification', 'pass', observed);
  if (landing?.strikeLanded && outcome !== 'failed') {
    return result('verification', 'skip', `${observed}; no verification gate runs on the strike path`);
  }
  // An out-of-band merge never enters merge-ops, so the CI-green skip cannot
  // record its normal verification verdict. Once rows 4 and 6 prove the landed
  // work and main CI green, that evidence satisfies row 3 without an override.
  if (!artifact && settlement?.landedWork && settlement.mainVerifyStatus === 'pass') {
    return result('verification', 'pass', `${observed}; verification satisfied by green main CI after landing`);
  }
  const negative = outcome === 'failed' ? 'failed' : undefined;
  return terminalVerdictSettlement('verification', negative, observed, settlement) ??
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
  let forgeArtifacts: MergedForgeArtifact[] = [];

  if (branchAbsent) {
    if (!ctx.github && deps.readMergedForgeArtifacts) {
      try {
        forgeArtifacts = await deps.readMergedForgeArtifacts(ctx);
        const labels = forgeArtifacts.map(artifact => {
          const label = artifact.forge === 'gitlab'
            ? (artifact.id ? `MR !${artifact.id}` : 'GitLab MR')
            : (artifact.id ? `PR #${artifact.id}` : 'GitHub PR');
          return `${label} merged${artifact.url ? ` (${artifact.url})` : ''}`;
        });
        if (labels.length > 0) merged.observed = `${merged.observed}; ${labels.join('; ')}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        merged.observed = `${merged.observed}; forge artifact evidence unavailable: ${message}`;
      }
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
    if (forgeMerged || forgeArtifacts.length > 0) {
      merged.status = 'pass';
    } else {
      merged.observed = `${merged.observed}; no merged forge artifact found`;
    }
  }

  // A successful ancestry check proves that the branch head reached main, but
  // only containment can identify that result as a non-PR landing for row 5.
  const needsContainmentEvidence = merged.status === 'miss' || (
    verified.success &&
    ctx.github !== undefined &&
    pullRequestState?.toUpperCase() !== 'MERGED'
  );
  if (needsContainmentEvidence) {
    try {
      const containment = await (deps.readBranchContainment ?? defaultMergedRowDeps.readBranchContainment!)(ctx);
      if (containment.mergedWorkRefs.length > 0 && containment.unmergedRefs.length === 0) {
        merged.status = 'pass';
        merged.evidence = 'branch-containment';
        merged.observed = `${merged.observed}; branch work contained in default branch with no merged PR — non-PR landing (membership L2-work lens): ${containment.mergedWorkRefs.join(', ')}`;
        const strikeSuffix = `:strike/${ctx.issueId.toLowerCase()}`;
        merged.containedStrikeHead = containment.mergedWorkHeads
          ?.find(candidate => candidate.ref.endsWith(strikeSuffix))?.head;
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
    const mergedAt = await deps.readMergedAt(ctx.issueId);
    const issueId = ctx.issueId.toUpperCase();
    const runningAgents = (await deps.listAgents()).filter(agent =>
      agent.issueId.toUpperCase() === issueId &&
      (agent.role === 'work' || agent.role === 'plan') &&
      (agent.status === 'starting' || agent.status === 'running'),
    );
    const stateObserved = canonicalState
      ? `canonical state: ${canonicalState}`
      : `canonical state unavailable; PR mergedAt: ${mergedAt ?? 'not merged'}`;
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
    const lifecycleObserved = canonicalState === 'verifying_on_main' || Boolean(mergedAt);
    // PAN-3180: `postMergeLifecycle()` is the work-agent handoff — it pauses the
    // work/planning agents, stops the workspace stack, and applies
    // `verifying-on-main`. A strike has no work agent to pause and its landing is
    // owned by the Deacon's merge door, so the marker this row looks for is never
    // written and its absence proves nothing. What a strike does still owe is
    // quiescence, so a live work/planning agent remains a real miss.
    if (!lifecycleObserved && merged?.containedStrikeHead) {
      return result(
        'post-merge',
        runningAgents.length === 0 ? 'skip' : 'miss',
        `strike landing (strike/${ctx.issueId.toLowerCase()} contained in main) — the work-agent post-merge handoff is not the strike path's lifecycle; ${stateObserved}; ${agentsObserved}`,
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

/**
 * PAN-3202: how many default-branch heads above the merge commit are probed for
 * the later-green-run evidence form. The tip of main is often mid-CI, so a single
 * candidate would usually read as pending; five reaches back far enough to find
 * the newest concluded green head without turning one row into a check-run storm.
 */
const LATER_GREEN_CANDIDATE_LIMIT = 5;

/**
 * PAN-3202: the fallback evidence form for DoD row 6. When a merge lands inside a
 * red-main window, the merge commit's own check-runs can never turn green, so the
 * row was permanently unsatisfiable even after main went green hundreds of times
 * with the commit included. A later default-branch head whose check-runs all
 * concluded green, and which contains the merge commit, is strictly stronger
 * evidence than the original run: it proves main is healthy *with* the merge in it,
 * which is exactly what "verified on main" means. Row 7 (deploy) already reasons
 * this way through the same containment relation.
 */
function requiredChecksOutcome(checks: CommitCheckRuns, required: string[]): {
  missing: string[];
  unsuccessful: string[];
} {
  return {
    missing: required.filter(check => !checks.names.includes(check)),
    unsuccessful: required.filter(check => checks.names.includes(check) && !checks.successful.includes(check)),
  };
}

function hasRequiredChecksGreen(checks: CommitCheckRuns, required: string[]): boolean {
  const outcome = requiredChecksOutcome(checks, required);
  return outcome.missing.length === 0 && outcome.unsuccessful.length === 0;
}

async function findLaterGreenDefaultBranchRun(
  ctx: LifecycleContext,
  mergeCommit: string,
  required: string[],
  deps: MainVerifyRowDeps,
): Promise<{ run: { sha: string; total: number } | null; note: string }> {
  const readCandidates =
    deps.readContainingDefaultBranchCommits ?? defaultMainVerifyRowDeps.readContainingDefaultBranchCommits!;
  let candidates: string[];
  try {
    candidates = await readCandidates(ctx, mergeCommit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { run: null, note: `later-run evidence unavailable: ${message}` };
  }

  const probed = candidates.slice(0, LATER_GREEN_CANDIDATE_LIMIT);
  for (const sha of probed) {
    try {
      const checks = await deps.readCheckRuns(ctx, sha);
      if (hasRequiredChecksGreen(checks, required)) {
        return { run: { sha, total: checks.total }, note: '' };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { run: null, note: `later-run evidence unavailable: ${message}` };
    }
  }
  return {
    run: null,
    note: probed.length === 0
      ? 'no later default-branch commit contains the merge'
      : `no green CI run among the ${probed.length} newest default-branch commit(s) containing the merge`,
  };
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
    const requiredChecks = await (deps.readRequiredChecks ?? defaultMainVerifyRowDeps.readRequiredChecks!)(ctx);
    const checks = await deps.readCheckRuns(ctx, mergeCommit);
    const outcome = requiredChecksOutcome(checks, requiredChecks);
    if (hasRequiredChecksGreen(checks, requiredChecks)) {
      return result('main-verify', 'pass', `required checks concluded successfully on ${mergeCommit}: ${requiredChecks.join(', ')}`);
    }

    // The merge commit's own run stays the primary evidence, so its outcome is
    // always recorded first; the later-green-run form only appends to it.
    const parts = [
      ...(outcome.missing.length > 0 ? [`missing required checks on ${mergeCommit}: ${outcome.missing.join(', ')}`] : []),
      ...(outcome.unsuccessful.length > 0 ? [`required checks not successful: ${outcome.unsuccessful.join(', ')}`] : []),
    ];
    const primary = parts.join('; ');

    const later = await findLaterGreenDefaultBranchRun(ctx, mergeCommit, requiredChecks, deps);
    if (later.run) {
      return result(
        'main-verify',
        'pass',
        `${primary}; verified on main by later green CI run ${later.run.sha} containing the merge (required checks concluded successfully: ${requiredChecks.join(', ')})`,
      );
    }
    return result('main-verify', 'miss', `${primary}; ${later.note}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result('main-verify', 'miss', `could not read merge-commit check-runs: ${message}`);
  }
}

export async function checkShipRow(
  ctx: LifecycleContext,
  deps: ShipRowDeps = defaultShipRowDeps,
): Promise<DodRowResult> {
  const project = deps.readProject(ctx);
  const expect = project?.version_sync?.expect ?? [];
  if (!project?.version_sync) {
    return result('ship', 'skip', 'project declares no version_sync; ship step not applicable');
  }
  if (expect.length === 0) {
    return result('ship', 'skip', 'version_sync declares no expect paths; nothing to verify');
  }

  const version = await deps.readShippedVersion(ctx);
  if (!version) {
    return result('ship', 'miss', 'no release tag reachable from origin/main \u2014 run `pan release stable --version <x.y.z>`');
  }

  const majorMinor = version.split('.').slice(0, 2).join('.');
  const failing: string[] = [];
  for (const entry of expect) {
    const content = await deps.readExpectPath(ctx, entry.path);
    if (content === null) {
      failing.push(`${entry.path} (unreadable at origin/main)`);
      continue;
    }
    const pattern = entry.pattern
      .replace(/\{version\}/g, version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .replace(/\{majorMinor\}/g, majorMinor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    try {
      if (!new RegExp(pattern, 'm').test(content)) failing.push(entry.path);
    } catch {
      failing.push(`${entry.path} (invalid expect pattern)`);
    }
  }

  if (failing.length === 0) {
    return result('ship', 'pass', `version ${version} present in all ${expect.length} declared version_sync path(s) on origin/main`);
  }
  return result(
    'ship',
    'miss',
    `version ${version} not propagated to ${failing.length} of ${expect.length} declared path(s): ${failing.join(', ')}`,
  );
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
  // PAN-3917: "this landed as a strike" is derived from branch containment on
  // row 4, not from a stored strikeLandingState.
  const landing: LandingEvidence = { strikeLanded: Boolean(merged.containedStrikeHead) };
  const [review, tests, verification, postMerge, ship, deploy] = await Promise.all([
    deps.review(ctx.issueId, settlement, landing),
    deps.tests(ctx.issueId, settlement, landing),
    deps.verification(ctx.issueId, settlement, landing),
    deps.postMerge(ctx, merged),
    deps.ship(ctx),
    deps.deploy(ctx, {
      mergedAt: merged.mergedAt,
      mergeCommit: merged.mergeCommit,
      mergedRowStatus: merged.status,
      mainVerifyRowStatus: mainVerify.status,
    }),
  ]);
  const rows = [review, tests, verification, merged, postMerge, mainVerify, ship, deploy];
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

/**
 * Completion witness for the close-out ceremony (PAN-3917). The ceremony's
 * terminal act is closing the tracker issue and stamping the `closed-out`
 * label; that label on a closed issue IS the witness. Nothing is stored.
 */
export async function readCompletedCloseOut(issueId: string, projectPath: string): Promise<string | null> {
  void projectPath;
  try {
    const { resolveGitHubIssueSync } = await import('../tracker-utils.js');
    const gh = resolveGitHubIssueSync(issueId);
    if (!gh.isGitHub || !gh.number) return null;
    const { stdout } = await execFileAsync(
      'gh',
      [
        'issue', 'view', String(gh.number),
        '--repo', `${gh.owner}/${gh.repo}`,
        '--json', 'state,closedAt,labels',
      ],
      { encoding: 'utf-8', timeout: 15000 },
    );
    const issue = JSON.parse(stdout) as {
      state?: string;
      closedAt?: string;
      labels?: Array<{ name?: string }>;
    };
    if ((issue.state ?? '').toUpperCase() !== 'CLOSED') return null;
    const closedOut = (issue.labels ?? []).some(label => label.name?.toLowerCase() === 'closed-out');
    return closedOut ? (issue.closedAt ?? 'unknown') : null;
  } catch {
    // Fail closed: a read error means we cannot confirm close-out.
    return null;
  }
}
