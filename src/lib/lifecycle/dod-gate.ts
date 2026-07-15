/** Mechanical Definition-of-Done row checks. */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CanonicalState } from '../../core/state-mapping.js';
import { Effect } from 'effect';
import { listRunningAgents, type AgentState } from '../agents.js';
import { getDashboardApiUrlSync } from '../config.js';
import { getReviewStatus, type ReviewStatus } from '../review-status.js';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecord,
  resolveProjectForIssue,
  type PanIssuePipelineRecord,
} from '../pan-dir/record.js';
import { getAutoCloseOutCanonicalState } from '../cloister/deacon-canonical-state.js';
import { fetchCommitCheckRuns, fetchIssuePullRequest } from '../overdeck/pull-requests.js';
import { acceptFlagFor, DOD_ROWS, type DodGateResult, type DodRowId, type DodRowResult } from './dod.js';
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
}

interface MergedRowDeps {
  verifyMerged: (ctx: LifecycleContext) => Promise<StepResult>;
  readPullRequest: (ctx: LifecycleContext, branchName: string) => Promise<{
    number?: number;
    state?: string;
    mergedAt?: string;
    mergeCommit?: { oid?: string } | string | null;
  }>;
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
};

interface PostMergeRowDeps {
  readCanonicalState: (ctx: LifecycleContext) => Promise<CanonicalState | null>;
  readMergeStatus: (issueId: string) => Awaitable<string | undefined>;
  listAgents: () => Awaitable<Array<Pick<AgentState, 'id' | 'issueId' | 'role' | 'status'>>>;
}

const defaultPostMergeRowDeps: PostMergeRowDeps = {
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
  serverStartedAt: (port: number) => Promise<Date>;
  distMtime: (repoRoot: string) => Promise<Date>;
}

export interface EvaluateDodGateDeps {
  review: (issueId: string) => DodRowResult | Promise<DodRowResult>;
  tests: (issueId: string) => DodRowResult | Promise<DodRowResult>;
  verification: (issueId: string) => DodRowResult | Promise<DodRowResult>;
  merged: (ctx: LifecycleContext) => MergedDodRowResult | Promise<MergedDodRowResult>;
  postMerge: (ctx: LifecycleContext) => DodRowResult | Promise<DodRowResult>;
  mainVerify: (ctx: LifecycleContext, mergeCommit?: string) => DodRowResult | Promise<DodRowResult>;
  deploy: (ctx: LifecycleContext, merge: { mergedAt?: string; mergeCommit?: string }) => DodRowResult | Promise<DodRowResult>;
  now: () => string;
}

const defaultEvaluateDodGateDeps: EvaluateDodGateDeps = {
  review: checkReviewRow,
  tests: checkTestsRow,
  verification: checkVerificationRow,
  merged: checkMergedRow,
  postMerge: checkPostMergeRow,
  mainVerify: checkMainVerifyRow,
  deploy: checkDeployRow,
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
  serverStartedAt: async port => {
    const { stdout: pidOutput } = await execFileAsync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const pid = pidOutput.trim().split('\n')[0];
    if (!pid) throw new Error(`no dashboard process owns port ${port}`);
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', pid], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    const startedAt = new Date(stdout.trim());
    if (Number.isNaN(startedAt.getTime())) throw new Error(`could not parse dashboard process start time: ${stdout.trim()}`);
    return startedAt;
  },
  distMtime: async repoRoot => new Date((await stat(resolve(repoRoot, 'dist/dashboard/server.js'))).mtime),
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

async function checkVerdict(
  issueId: string,
  id: 'review' | 'tests',
  field: 'reviewStatus' | 'testStatus',
  deps: DodStatusRowDeps,
): Promise<DodRowResult> {
  const loaded = await loadStatus(issueId, deps);
  if (!loaded) return result(id, 'miss', 'no review status or journal record found');

  const value = loaded.status[field];
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const observed = `${field}: ${value ?? 'missing'}${source}${policy}`;
  return result(id, value === 'passed' || value === 'skipped' ? 'pass' : 'miss', observed);
}

export function checkReviewRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): Promise<DodRowResult> {
  return checkVerdict(issueId, 'review', 'reviewStatus', deps);
}

export function checkTestsRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): Promise<DodRowResult> {
  return checkVerdict(issueId, 'tests', 'testStatus', deps);
}

export async function checkVerificationRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): Promise<DodRowResult> {
  const loaded = await loadStatus(issueId, deps);
  if (!loaded) return result('verification', 'miss', 'no review status or journal record found');

  const value = loaded.status.verificationStatus;
  const commit = loaded.status.lastVerifiedCommit;
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const commitNote = commit ? ` at ${commit}` : '';
  const observed = `verificationStatus: ${value ?? 'missing'}${commitNote}${source}${policy}`;
  const acceptedStatus = value === 'passed' || value === 'skipped';
  const hasRequiredCommit = Boolean(commit);
  return result('verification', acceptedStatus && hasRequiredCommit ? 'pass' : 'miss', observed);
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

  if (!ctx.github) return merged;

  try {
    const branchName = `feature/${ctx.issueId.toLowerCase()}`;
    const pullRequest = await deps.readPullRequest(ctx, branchName);
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

  return merged;
}

export async function checkPostMergeRow(
  ctx: LifecycleContext,
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
    const lifecycleObserved = canonicalState === 'verifying_on_main' || mergeStatus === 'merged';
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
  merge: { mergedAt?: string; mergeCommit?: string },
  deps: DeployRowDeps = defaultDeployRowDeps,
): Promise<DodRowResult> {
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

  try {
    let version: Record<string, unknown> = {};
    try {
      version = await deps.readJson(`${baseUrl}/api/version`);
    } catch {
      // Older servers do not expose version metadata; use the timestamp fallback.
    }
    const buildCommit = typeof version.buildCommit === 'string'
      ? version.buildCommit
      : typeof version.commit === 'string' ? version.commit : undefined;
    if (buildCommit && merge.mergeCommit) {
      const contains = await deps.commitContains(repoRoot, merge.mergeCommit, buildCommit);
      const observed = `build commit ${buildCommit.slice(0, 8)} ${contains ? 'contains' : 'does not contain'} merge ${merge.mergeCommit.slice(0, 8)}`;
      return result('deploy', contains ? 'pass' : 'miss', observed);
    }

    if (!merge.mergedAt) return result('deploy', 'miss', 'cannot resolve merge time for best-effort deploy check');
    const mergedAt = new Date(merge.mergedAt);
    if (Number.isNaN(mergedAt.getTime())) return result('deploy', 'miss', `cannot parse merge time ${merge.mergedAt}`);
    const port = Number(new URL(baseUrl).port || (new URL(baseUrl).protocol === 'https:' ? 443 : 80));
    const [startedAt, builtAt] = await Promise.all([deps.serverStartedAt(port), deps.distMtime(repoRoot)]);
    const fresh = startedAt > mergedAt && builtAt > mergedAt;
    const observed = `best-effort — build commit not exposed (PAN-2713): server started ${startedAt.toISOString()}, dist built ${builtAt.toISOString()}, merge ${mergedAt.toISOString()}`;
    return result('deploy', fresh ? 'pass' : 'miss', observed);
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

  const merged = opts.verifyMerged
    ? await checkMergedRow(ctx, { ...defaultMergedRowDeps, verifyMerged: opts.verifyMerged })
    : await deps.merged(ctx);
  const rows = await Promise.all([
    deps.review(ctx.issueId),
    deps.tests(ctx.issueId),
    deps.verification(ctx.issueId),
    Promise.resolve(merged),
    deps.postMerge(ctx),
    deps.mainVerify(ctx, merged.mergeCommit),
    deps.deploy(ctx, { mergedAt: merged.mergedAt, mergeCommit: merged.mergeCommit }),
  ]);
  const by = opts.acceptedBy ?? process.env.OVERDECK_AGENT_ID ?? userInfo().username;
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
