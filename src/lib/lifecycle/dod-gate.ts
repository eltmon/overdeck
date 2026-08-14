/** Mechanical Definition-of-Done row checks. */

import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CanonicalState } from '../../core/state-mapping.js';
import { Effect } from 'effect';
import { listRunningAgents, type AgentState } from '../agents.js';
import { getDashboardApiUrlSync } from '../config.js';
import { rehydrateHeadAnchor } from '../git-utils.js';
import { getReviewStatus, setReviewStatusSync, type ReviewStatus, type ReviewStatusUpdate } from '../review-status.js';
import type { StrikeLandingStatus } from '../strike-landing.js';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecord,
  resolveProjectForIssue,
  type PanIssuePipelineRecord,
  type PanIssueShipRecord,
} from '../pan-dir/record.js';
import type { ProjectConfig } from '../projects.js';
import { getAutoCloseOutCanonicalState } from '../cloister/deacon-canonical-state.js';
import { aggregateGenerationShipStatus, loadShipRecords } from '../cloister/ship-status.js';
import { isTrackerIssueClosed } from '../cloister/issue-closed.js';
import {
  fetchCommitCheckRuns,
  fetchIssuePullRequest,
  fetchRequiredStatusChecks,
  type CommitCheckRuns,
} from '../overdeck/pull-requests.js';
import { listUatGenerationsSync, type UatGeneration } from '../overdeck/merge-sync.js';
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
  readDurableMerges?: (ctx: LifecycleContext) => Promise<string[]>;
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
  readDurableMerges: async ctx => {
    const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
    return (await readIssueRecord(project, ctx.issueId))?.closeOut.merges ?? [];
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
  readMergeStatus: (issueId: string) => Awaitable<string | undefined>;
  listAgents: () => Awaitable<Array<Pick<AgentState, 'id' | 'issueId' | 'role' | 'status'>>>;
  readStrikeLanded?: (issueId: string) => Awaitable<boolean>;
}

const defaultPostMergeRowDeps: PostMergeRowDeps = {
  readStrikeLanded: async issueId => strikeLanded((await loadStatus(issueId, defaultDeps))?.status),
  readCanonicalState: async ctx => {
    return getAutoCloseOutCanonicalState(ctx.issueId) as Promise<CanonicalState | null>;
  },
  // PAN-3025: same live→journal fallback as the verdict rows — after close-out
  // clears live status, the durable record is the only place mergeStatus survives.
  readMergeStatus: async issueId => (await loadStatus(issueId, defaultDeps))?.status.mergeStatus,
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

interface ShipRowDeps {
  readProject: (ctx: LifecycleContext) => ProjectConfig | null;
  readPipeline: (ctx: LifecycleContext) => Promise<PanIssuePipelineRecord | null>;
  findPromotedBatch: (ctx: LifecycleContext) => UatGeneration | null;
  readBatchShip: (project: ProjectConfig, generation: UatGeneration) => Promise<PanIssueShipRecord | null>;
}

const defaultShipRowDeps: ShipRowDeps = {
  readProject: ctx => resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath),
  readPipeline: async ctx => {
    const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
    return (await readIssueRecord(project, ctx.issueId))?.pipeline ?? null;
  },
  findPromotedBatch: ctx => {
    const project = resolveProjectForIssue(ctx.issueId) ?? getProjectConfigFromWorkspacePath(ctx.projectPath);
    return listUatGenerationsSync({ projectRoot: resolve(project.path), statuses: ['promoted'] })
      .find(generation => generation.members.some(member => member.issueId.toUpperCase() === ctx.issueId.toUpperCase())) ?? null;
  },
  readBatchShip: async (project, generation) => aggregateGenerationShipStatus(
    generation,
    await loadShipRecords(project, [generation]),
  ),
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
  ship: (ctx: LifecycleContext) => DodRowResult | Promise<DodRowResult>;
  deploy: (ctx: LifecycleContext, merge: {
    mergedAt?: string;
    mergeCommit?: string;
    mergedRowStatus?: DodRowResult['status'];
    mainVerifyRowStatus?: DodRowResult['status'];
  }) => DodRowResult | Promise<DodRowResult>;
  trackerClosed?: (issueId: string) => Awaitable<boolean>;
  reconcileContainedStrike?: (ctx: LifecycleContext, merged: MergedDodRowResult) => Awaitable<void>;
  now: () => string;
}

const defaultEvaluateDodGateDeps: EvaluateDodGateDeps = {
  review: (issueId, settlement) => checkReviewRow(issueId, defaultDeps, settlement),
  tests: (issueId, settlement) => checkTestsRow(issueId, defaultDeps, settlement),
  verification: (issueId, settlement) => checkVerificationRow(issueId, defaultDeps, settlement),
  merged: checkMergedRow,
  postMerge: checkPostMergeRow,
  mainVerify: checkMainVerifyRow,
  ship: checkShipRow,
  deploy: checkDeployRow,
  trackerClosed: isTrackerIssueClosed,
  reconcileContainedStrike,
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
  // An out-of-band merge never enters merge-ops, so the CI-green skip cannot
  // record its normal verification verdict. Once rows 4 and 6 prove the landed
  // work and main CI green, that evidence satisfies row 3 without an override.
  if (value === undefined && settlement?.landedWork && settlement.mainVerifyStatus === 'pass') {
    return result('verification', 'pass', `${observed}; verification satisfied by green main CI after landing`);
  }
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
  let forgeArtifacts: MergedForgeArtifact[] = [];

  if (branchAbsent) {
    try {
      durableMerges = await (deps.readDurableMerges ?? defaultMergedRowDeps.readDurableMerges!)(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      merged.observed = `${merged.observed}; durable merge evidence unavailable: ${message}`;
    }
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
    if (durableMerges.length > 0 || forgeMerged || forgeArtifacts.length > 0) {
      merged.status = 'pass';
      if (durableMerges.length > 0) {
        merged.observed = `${merged.observed}; durable close-out record contains ${durableMerges.length} merge artifact(s)`;
      }
    } else {
      merged.observed = `${merged.observed}; no merged forge artifact or durable close-out merge record found`;
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

const NEGATIVE_STRIKE_VERDICTS = new Set(['failed', 'blocked', 'dispatch_failed']);

/**
 * Reconcile an out-of-band strike landing only when its durable ready marker
 * names the exact strike tip proven contained in main. This is the evidence a
 * normal merge-door landing consumes before it clears the marker.
 */
export async function reconcileContainedStrike(
  ctx: LifecycleContext,
  merged: MergedDodRowResult,
  deps: {
    getStatus?: (issueId: string) => Awaitable<ReviewStatus | null>;
    setStatus?: typeof setReviewStatusSync;
  } = {},
): Promise<void> {
  const head = merged.evidence === 'branch-containment' ? merged.containedStrikeHead : undefined;
  if (!head) return;
  const current = await (deps.getStatus ?? (issueId => Effect.runPromise(getReviewStatus(issueId))))(ctx.issueId);
  if (!current || current.strikeReadyHead !== head) return;

  const update: ReviewStatusUpdate = {};
  if (!NEGATIVE_STRIKE_VERDICTS.has(current.reviewStatus)) update.reviewStatus = 'passed';
  if (!NEGATIVE_STRIKE_VERDICTS.has(current.testStatus)) update.testStatus = 'passed';
  if (!NEGATIVE_STRIKE_VERDICTS.has(current.verificationStatus ?? '')) {
    update.verificationStatus = 'passed';
    update.verificationNotes = `Contained strike ${head} matched durable strike readiness evidence`;
    update.lastVerifiedCommit = rehydrateHeadAnchor(head);
  }
  update.mergeStatus = 'merged';
  update.strikeLandingState = 'landed';
  update.strikeReadyHead = undefined;
  update.strikeReadyAt = undefined;

  const changed = Object.entries(update).some(([key, value]) => current[key as keyof ReviewStatus] !== value);
  if (changed) (deps.setStatus ?? setReviewStatusSync)(ctx.issueId, update);
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
  if (!project?.version_sync) {
    return result('ship', 'skip', 'project declares no version_sync; ship step not applicable');
  }

  const promotedBatch = deps.findPromotedBatch(ctx);
  const ship = promotedBatch
    ? await deps.readBatchShip(project, promotedBatch)
    : (await deps.readPipeline(ctx))?.ship;
  if (!ship) {
    if (promotedBatch) {
      return result(
        'ship',
        'miss',
        `batch ${promotedBatch.name} includes this issue but no durable ship settlement was recorded`,
      );
    }
    return result('ship', 'skip', 'merged outside a batch; ship is batch-scoped');
  }
  if (ship.status === 'passed') {
    return result(
      'ship',
      'pass',
      `version ${ship.version ?? 'unknown'} shipped for batch ${ship.batch}; ${ship.paths?.length ?? 0} path(s) verified`,
    );
  }
  if (ship.status === 'pending') {
    return result(
      'ship',
      'miss',
      `batch ${ship.batch} merged but no version was shipped — use the Ship version action on the batch card for ${ship.batch}`,
    );
  }
  if (ship.status === 'partial') {
    const failing = ship.paths?.filter(path => !path.ok).map(path => path.path) ?? [];
    return result(
      'ship',
      'miss',
      `batch ${ship.batch} partially propagated version ${ship.version ?? 'unknown'}; failing paths: ${failing.join(', ') || 'unknown'}`,
    );
  }
  return result(
    'ship',
    'miss',
    `batch ${ship.batch} version ship failed (${ship.errorCode ?? 'unknown-failure'}): ${ship.error ?? ship.reason ?? 'inspect the local dashboard log'}`,
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
  await (deps.reconcileContainedStrike ?? defaultEvaluateDodGateDeps.reconcileContainedStrike!)(ctx, merged);
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
  const [review, tests, verification, postMerge, ship, deploy] = await Promise.all([
    deps.review(ctx.issueId, settlement),
    deps.tests(ctx.issueId, settlement),
    deps.verification(ctx.issueId, settlement),
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
 * PAN-3025: completion witness for the close-out ceremony. Returns closedOutAt
 * only when the journal is terminal AND the live row is gone (the ceremony's
 * final mutating step). closedOut with live status present means a prior run
 * aborted mid-ceremony and must fall through to complete it.
 */
export async function readCompletedCloseOut(issueId: string, projectPath: string): Promise<string | null> {
  try {
    const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(projectPath);
    const record = await readIssueRecord(project, issueId.toUpperCase());
    if (!record?.pipeline.closedOut) return null;
    // Fail closed: a read error means we cannot confirm absence, so return null (incomplete)
    const live = await Effect.runPromise(getReviewStatus(issueId)).catch(() => 'unknown');
    if (live === 'unknown') return null; // Reject the idempotent path on any read failure
    return live ? null : (record.pipeline.closedOutAt ?? 'unknown');
  } catch {
    // On any error (record read, etc.), fail closed
    return null;
  }
}
