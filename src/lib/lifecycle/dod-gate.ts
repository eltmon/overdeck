/** Mechanical Definition-of-Done row checks. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mapGitHubStateToCanonical, type CanonicalState } from '../../core/state-mapping.js';
import { listRunningAgentsSync, type AgentState } from '../agents.js';
import { getReviewStatusSync, type ReviewStatus } from '../review-status.js';
import {
  getProjectConfigFromWorkspacePath,
  readIssueRecordSync,
  resolveProjectForIssue,
  type PanIssuePipelineRecord,
} from '../pan-dir/record.js';
import { DOD_ROWS, type DodRowId, type DodRowResult } from './dod.js';
import type { LifecycleContext, StepResult } from './types.js';

const execFileAsync = promisify(execFile);

type StatusSource =
  | { source: 'live'; status: ReviewStatus }
  | { source: 'journal'; status: PanIssuePipelineRecord }
  | null;

export interface DodStatusRowDeps {
  getReviewStatus: (issueId: string) => ReviewStatus | null;
  getJournalStatus: (issueId: string) => PanIssuePipelineRecord | null;
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
  verifyMerged: async ctx => {
    // Dynamic import prevents a static workflows -> dod-gate -> workflows cycle
    // when closeOut begins evaluating the gate.
    const { verifyBranchMergedImpl } = await import('./workflows.js');
    return verifyBranchMergedImpl(ctx);
  },
  readPullRequest: async (ctx, branchName) => {
    if (!ctx.github) return {};
    const { stdout } = await execFileAsync('gh', [
      'pr', 'view', branchName,
      '--repo', `${ctx.github.owner}/${ctx.github.repo}`,
      '--json', 'number,state,mergedAt,mergeCommit',
    ], { encoding: 'utf-8', timeout: 10000 });
    return JSON.parse(stdout);
  },
};

interface PostMergeRowDeps {
  readCanonicalState: (ctx: LifecycleContext) => Promise<CanonicalState | null>;
  readMergeStatus: (issueId: string) => string | undefined;
  listAgents: () => Array<Pick<AgentState, 'id' | 'issueId' | 'role' | 'status'>>;
}

const defaultPostMergeRowDeps: PostMergeRowDeps = {
  readCanonicalState: async ctx => {
    if (!ctx.github) return null;
    const { stdout } = await execFileAsync('gh', [
      'issue', 'view', String(ctx.github.number),
      '--repo', `${ctx.github.owner}/${ctx.github.repo}`,
      '--json', 'state,labels',
    ], { encoding: 'utf-8', timeout: 10000 });
    const parsed = JSON.parse(stdout) as { state?: string; labels?: Array<string | { name?: string }> };
    const labels = (parsed.labels ?? [])
      .map(label => typeof label === 'string' ? label : label.name)
      .filter((label): label is string => typeof label === 'string');
    return mapGitHubStateToCanonical(parsed.state ?? 'open', labels);
  },
  readMergeStatus: issueId => getReviewStatusSync(issueId)?.mergeStatus,
  listAgents: listRunningAgentsSync,
};

const defaultDeps: DodStatusRowDeps = {
  getReviewStatus: getReviewStatusSync,
  getJournalStatus: issueId => {
    const project = resolveProjectForIssue(issueId) ?? getProjectConfigFromWorkspacePath(process.cwd());
    return readIssueRecordSync(project, issueId)?.pipeline ?? null;
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

function loadStatus(issueId: string, deps: DodStatusRowDeps): StatusSource {
  try {
    const live = deps.getReviewStatus(issueId);
    if (live) return { source: 'live', status: live };
    const journal = deps.getJournalStatus(issueId);
    return journal ? { source: 'journal', status: journal } : null;
  } catch {
    return null;
  }
}

function checkVerdict(
  issueId: string,
  id: 'review' | 'tests',
  field: 'reviewStatus' | 'testStatus',
  deps: DodStatusRowDeps,
): DodRowResult {
  const loaded = loadStatus(issueId, deps);
  if (!loaded) return result(id, 'miss', 'no review status or journal record found');

  const value = loaded.status[field];
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const observed = `${field}: ${value ?? 'missing'}${source}${policy}`;
  return result(id, value === 'passed' || value === 'skipped' ? 'pass' : 'miss', observed);
}

export function checkReviewRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): DodRowResult {
  return checkVerdict(issueId, 'review', 'reviewStatus', deps);
}

export function checkTestsRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): DodRowResult {
  return checkVerdict(issueId, 'tests', 'testStatus', deps);
}

export function checkVerificationRow(issueId: string, deps: DodStatusRowDeps = defaultDeps): DodRowResult {
  const loaded = loadStatus(issueId, deps);
  if (!loaded) return result('verification', 'miss', 'no review status or journal record found');

  const value = loaded.status.verificationStatus;
  const commit = loaded.status.lastVerifiedCommit;
  const source = loaded.source === 'journal' ? ' from pipeline journal' : '';
  const policy = value === 'skipped' ? ' (skipped per issue policy)' : '';
  const commitNote = commit ? ` at ${commit}` : '';
  const observed = `verificationStatus: ${value ?? 'missing'}${commitNote}${source}${policy}`;
  const acceptedStatus = value === 'passed' || value === 'skipped';
  const hasRequiredCommit = loaded.source === 'journal' || Boolean(commit);
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
    const mergeStatus = deps.readMergeStatus(ctx.issueId);
    const issueId = ctx.issueId.toUpperCase();
    const runningAgents = deps.listAgents().filter(agent =>
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
