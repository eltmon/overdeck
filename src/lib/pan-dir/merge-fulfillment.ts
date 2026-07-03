import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';

import { getPullRequestState, isGitHubAppConfigured } from '../github-app.js';
import { extractNumberSync } from '../issue-id.js';
import { cleanupMergedLabels } from '../lifecycle/label-cleanup.js';
import type { LifecycleContext, StepResult } from '../lifecycle/types.js';
import { getProjectSync, loadProjectsConfigSync, resolveProjectFromIssueSync, type ProjectConfig } from '../projects.js';
import { setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { WORKFLOW_LABELS } from '../lifecycle/close-issue.js';
import { readIssueRecordSync, RECORD_DIRNAME, type PanIssueRecord } from './record.js';

const execAsync = promisify(exec);

export type MergeFulfillmentVerdict = 'merged' | 'stranded' | 'unknown';

export interface MergeFulfillmentResult {
  verdict: MergeFulfillmentVerdict;
  evidence: string;
}

export interface MergeFulfillmentDeps {
  readRecord(project: ProjectConfig, issueId: string): PanIssueRecord | null;
  exec(command: string, options: { cwd: string }): Promise<{ stdout: string; stderr: string }>;
  isGitHubAppConfigured(): boolean;
  getPullRequestState(owner: string, repo: string, number: number): Promise<{ merged: boolean; state?: string }>;
  setReviewStatus?(issueId: string, update: Partial<ReviewStatus>): ReviewStatus;
  cleanupMergedLabels?(ctx: LifecycleContext): Promise<StepResult>;
}

const defaultDeps: MergeFulfillmentDeps = {
  readRecord: readIssueRecordSync,
  exec: (command, options) => execAsync(command, options),
  isGitHubAppConfigured,
  getPullRequestState: async (owner, repo, number) => Effect.runPromise(getPullRequestState(owner, repo, number)),
  setReviewStatus: setReviewStatusSync,
  cleanupMergedLabels: (ctx) => Effect.runPromise(cleanupMergedLabels(ctx)),
};

type ResolvedMergeFulfillmentDeps = MergeFulfillmentDeps & Required<Pick<MergeFulfillmentDeps, 'setReviewStatus' | 'cleanupMergedLabels'>>;

export interface ReconcileMergedIssueOptions {
  closed?: boolean;
  dryRun?: boolean;
}

export interface ReconcileMergedIssueResult {
  issueId: string;
  dryRun: boolean;
  skipped: boolean;
  actions: string[];
  branchActions: Array<{
    branch: string;
    status: 'deleted' | 'kept' | 'missing' | 'planned-delete' | 'planned-keep';
    reason: string;
  }>;
}

export interface ReconcileMergeFulfillmentOptions {
  issueId?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

export interface ReconcileMergeFulfillmentDetail {
  issueId: string;
  action: 'reconciled' | 'would-reconcile' | 'flagged' | 'skipped' | 'failed';
  verdict?: MergeFulfillmentVerdict;
  evidence?: string;
  reason?: string;
}

export interface ReconcileMergeFulfillmentResult {
  reconciled: number;
  flagged: number;
  skipped: number;
  failed: number;
  details: ReconcileMergeFulfillmentDetail[];
}

const CLOSED_OUT_LABEL = 'closed-out';
const CLOSED_OUT_COLOR = '1d4ed8';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveDeps(deps: Partial<MergeFulfillmentDeps>): ResolvedMergeFulfillmentDeps {
  return { ...defaultDeps, ...deps } as ResolvedMergeFulfillmentDeps;
}

function parseGitHubPullRequestUrl(url: string | undefined): { owner: string; repo: string; number: number } | null {
  const match = url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number.parseInt(match[3]!, 10),
  };
}

function prRefFromRecord(project: ProjectConfig, record: PanIssueRecord | null): { owner: string; repo: string; number: number } | null {
  const fromUrl = parseGitHubPullRequestUrl(record?.pipeline?.prUrl);
  if (fromUrl) return fromUrl;
  const prNumber = record?.pipeline?.prNumber;
  if (!prNumber || !project.github_repo) return null;
  const [owner, repo] = project.github_repo.split('/');
  return owner && repo ? { owner, repo, number: prNumber } : null;
}

function isExitOne(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 1;
}

async function prMerged(
  issueId: string,
  project: ProjectConfig,
  record: PanIssueRecord | null,
  deps: MergeFulfillmentDeps,
): Promise<MergeFulfillmentResult | null> {
  const pr = prRefFromRecord(project, record);
  if (!pr) return null;

  if (deps.isGitHubAppConfigured()) {
    try {
      const state = await deps.getPullRequestState(pr.owner, pr.repo, pr.number);
      if (state.merged) {
        return { verdict: 'merged', evidence: `${issueId} PR #${pr.number} reports merged via GitHub App` };
      }
      return null;
    } catch (err) {
      return {
        verdict: 'unknown',
        evidence: `${issueId} PR #${pr.number} state could not be resolved via GitHub App: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  try {
    const { stdout } = await deps.exec(
      `gh pr view ${pr.number} --repo ${shellQuote(`${pr.owner}/${pr.repo}`)} --json merged,mergedAt,mergeCommit,state`,
      { cwd: project.path },
    );
    const parsed = JSON.parse(stdout || '{}') as { merged?: boolean; mergedAt?: string | null; mergeCommit?: unknown; state?: string };
    if (parsed.merged === true || parsed.mergedAt || parsed.mergeCommit) {
      return { verdict: 'merged', evidence: `${issueId} PR #${pr.number} reports merged via gh` };
    }
    return null;
  } catch (err) {
    return {
      verdict: 'unknown',
      evidence: `${issueId} PR #${pr.number} state could not be resolved via gh: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function branchExists(branch: string, project: ProjectConfig, deps: MergeFulfillmentDeps): Promise<boolean | 'unknown'> {
  try {
    await deps.exec(`git rev-parse --verify ${shellQuote(branch)}`, { cwd: project.path });
    return true;
  } catch (err) {
    return isExitOne(err) ? false : 'unknown';
  }
}

async function branchIsMerged(branch: string, project: ProjectConfig, deps: MergeFulfillmentDeps): Promise<boolean | 'unknown'> {
  try {
    await deps.exec(`git merge-base --is-ancestor ${shellQuote(branch)} origin/main`, { cwd: project.path });
    return true;
  } catch (err) {
    return isExitOne(err) ? false : 'unknown';
  }
}

function lifecycleContext(issueId: string, project: ProjectConfig): LifecycleContext {
  const github = project.github_repo && extractNumberSync(issueId) !== null
    ? (() => {
        const [owner, repo] = project.github_repo!.split('/');
        const number = extractNumberSync(issueId);
        return owner && repo && number !== null ? { owner, repo, number } : undefined;
      })()
    : undefined;

  return {
    issueId,
    projectPath: project.path,
    projectName: project.name,
    ...(github ? { github } : {}),
  };
}

async function collectRecordIssueIdsFromDir(dir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!existsSync(dir)) return ids;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^([a-z]+-\d+)\.json$/i);
      if (match) ids.add(match[1]!.toUpperCase());
    }
  } catch {
    // Directory may be unreadable; skip it.
  }
  return ids;
}

async function collectRecordIssueIds(projects: ProjectConfig[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const project of projects) {
    for (const id of await collectRecordIssueIdsFromDir(join(project.path, '.pan', RECORD_DIRNAME))) ids.add(id);

    const workspacesDir = join(project.path, project.workspace?.workspaces_dir ?? 'workspaces');
    if (!existsSync(workspacesDir)) continue;
    try {
      const workspaces = await readdir(workspacesDir, { withFileTypes: true });
      for (const workspace of workspaces) {
        if (!workspace.isDirectory()) continue;
        const recordsDir = join(workspacesDir, workspace.name, '.pan', RECORD_DIRNAME);
        for (const id of await collectRecordIssueIdsFromDir(recordsDir)) ids.add(id);
      }
    } catch {
      // Workspaces directory may be absent or unreadable; skip it.
    }
  }
  return ids;
}

async function readIssueRecordFromKnownPaths(project: ProjectConfig, issueId: string): Promise<PanIssueRecord | null> {
  const direct = readIssueRecordSync(project, issueId);
  if (direct) return direct;

  const workspacesDir = join(project.path, project.workspace?.workspaces_dir ?? 'workspaces');
  if (!existsSync(workspacesDir)) return null;
  try {
    const workspaces = await readdir(workspacesDir, { withFileTypes: true });
    for (const workspace of workspaces) {
      if (!workspace.isDirectory()) continue;
      const path = join(workspacesDir, workspace.name, '.pan', RECORD_DIRNAME, `${issueId.toLowerCase()}.json`);
      try {
        return JSON.parse(await readFile(path, 'utf-8')) as PanIssueRecord;
      } catch {
        // Try the next workspace.
      }
    }
  } catch {
    return null;
  }
  return null;
}

function shouldApplyClosedOutLabel(record: PanIssueRecord | null): boolean {
  return record?.pipeline?.closedOut === true || Boolean(record?.closeOut?.closedAt);
}

async function applyClosedOutLabel(issueId: string, project: ProjectConfig, deps: MergeFulfillmentDeps): Promise<string> {
  if (!project.github_repo) {
    return 'skipped closed-out label: project has no GitHub repo';
  }
  const number = extractNumberSync(issueId);
  if (number === null) {
    return 'skipped closed-out label: issue number could not be parsed';
  }
  const [owner, repo] = project.github_repo.split('/');
  if (!owner || !repo) {
    return 'skipped closed-out label: project GitHub repo is invalid';
  }

  const repoSlug = `${owner}/${repo}`;
  await deps.exec(
    `gh label create ${shellQuote(CLOSED_OUT_LABEL)} --repo ${shellQuote(repoSlug)} --color ${shellQuote(CLOSED_OUT_COLOR)} --description ${shellQuote('Verified and closed out')} --force`,
    { cwd: project.path },
  );
  for (const label of WORKFLOW_LABELS) {
    await deps.exec(
      `gh issue edit ${number} --repo ${shellQuote(repoSlug)} --remove-label ${shellQuote(label)}`,
      { cwd: project.path },
    ).catch(() => ({ stdout: '', stderr: '' }));
  }
  await deps.exec(
    `gh issue edit ${number} --repo ${shellQuote(repoSlug)} --add-label ${shellQuote(CLOSED_OUT_LABEL)}`,
    { cwd: project.path },
  );
  return `applied closed-out label to ${issueId}`;
}

async function reconcileBranch(
  branch: string,
  project: ProjectConfig,
  dryRun: boolean,
  deps: MergeFulfillmentDeps,
): Promise<ReconcileMergedIssueResult['branchActions'][number]> {
  const exists = await branchExists(branch, project, deps);
  if (exists === 'unknown') {
    return { branch, status: 'kept', reason: 'branch existence could not be resolved' };
  }
  if (!exists) {
    return { branch, status: 'missing', reason: 'branch was not found' };
  }

  const merged = await branchIsMerged(branch, project, deps);
  if (merged !== true) {
    return {
      branch,
      status: dryRun ? 'planned-keep' : 'kept',
      reason: merged === 'unknown' ? 'branch ancestry could not be resolved' : 'branch is not an ancestor of origin/main',
    };
  }

  if (dryRun) {
    return { branch, status: 'planned-delete', reason: 'branch is an ancestor of origin/main' };
  }

  await deps.exec(`git branch -D ${shellQuote(branch)}`, { cwd: project.path });
  await deps.exec(`git push origin --delete ${shellQuote(branch)}`, { cwd: project.path }).catch(() => ({ stdout: '', stderr: '' }));
  return { branch, status: 'deleted', reason: 'branch is an ancestor of origin/main' };
}

export async function verifyIssueMergeFulfillment(
  issueId: string,
  project: ProjectConfig,
  deps: Partial<MergeFulfillmentDeps> = {},
): Promise<MergeFulfillmentResult> {
  const normalized = issueId.toUpperCase();
  const mergedDeps = resolveDeps(deps);
  const record = mergedDeps.readRecord(project, normalized);

  const prResult = await prMerged(normalized, project, record, mergedDeps);
  if (prResult) return prResult;

  const branches = [`feature/${normalized.toLowerCase()}`, `strike/${normalized.toLowerCase()}`];
  let sawExistingBranch = false;
  for (const branch of branches) {
    const exists = await branchExists(branch, project, mergedDeps);
    if (exists === 'unknown') {
      return { verdict: 'unknown', evidence: `${normalized} branch ${branch} existence could not be resolved` };
    }
    if (!exists) continue;
    sawExistingBranch = true;

    const merged = await branchIsMerged(branch, project, mergedDeps);
    if (merged === true) {
      return { verdict: 'merged', evidence: `${branch} is an ancestor of origin/main` };
    }
    if (merged === 'unknown') {
      return { verdict: 'unknown', evidence: `${normalized} branch ${branch} ancestry could not be resolved` };
    }
  }

  if (sawExistingBranch) {
    return { verdict: 'stranded', evidence: `${normalized} has a branch that is not an ancestor of origin/main and no merged PR was found` };
  }

  return { verdict: 'unknown', evidence: `${normalized} has no resolvable merged PR and no feature/strike branch` };
}

export async function reconcileMergedIssue(
  issueId: string,
  project: ProjectConfig,
  opts: ReconcileMergedIssueOptions = {},
  deps: Partial<MergeFulfillmentDeps> = {},
): Promise<ReconcileMergedIssueResult> {
  const normalized = issueId.toUpperCase();
  const dryRun = opts.dryRun === true;
  const mergedDeps = resolveDeps(deps);
  const record = mergedDeps.readRecord(project, normalized);

  if (record?.pipeline?.mergeStatus === 'merged') {
    return {
      issueId: normalized,
      dryRun,
      skipped: true,
      actions: ['skipped: record already has mergeStatus=merged'],
      branchActions: [],
    };
  }

  const actions: string[] = [];
  if (dryRun) {
    actions.push('would set mergeStatus=merged, reviewStatus=passed, readyForMerge=false');
    actions.push('would apply merged label');
    if (opts.closed) actions.push('would apply closed-out label');
  } else {
    mergedDeps.setReviewStatus(normalized, {
      mergeStatus: 'merged',
      reviewStatus: 'passed',
      readyForMerge: false,
    });
    actions.push('set mergeStatus=merged, reviewStatus=passed, readyForMerge=false');

    const labelResult = await mergedDeps.cleanupMergedLabels(lifecycleContext(normalized, project));
    actions.push(labelResult.success ? 'applied merged label' : `merged label cleanup failed: ${labelResult.error ?? 'unknown error'}`);

    if (opts.closed) {
      actions.push(await applyClosedOutLabel(normalized, project, mergedDeps));
    }
  }

  const branchActions: ReconcileMergedIssueResult['branchActions'] = [];
  for (const branch of [`feature/${normalized.toLowerCase()}`, `strike/${normalized.toLowerCase()}`]) {
    branchActions.push(await reconcileBranch(branch, project, dryRun, mergedDeps));
  }

  return {
    issueId: normalized,
    dryRun,
    skipped: false,
    actions,
    branchActions,
  };
}

async function reconcileOneFulfilledMerge(
  issueId: string,
  options: ReconcileMergeFulfillmentOptions,
  deps: Partial<MergeFulfillmentDeps>,
): Promise<ReconcileMergeFulfillmentDetail> {
  const normalized = issueId.toUpperCase();
  const resolved = resolveProjectFromIssueSync(normalized);
  if (!resolved) {
    return { issueId: normalized, action: 'failed', reason: 'could not resolve project' };
  }

  const project = getProjectSync(resolved.projectKey);
  if (!project) {
    return { issueId: normalized, action: 'failed', reason: 'project not found' };
  }

  const record = await readIssueRecordFromKnownPaths(project, normalized);
  if (!record) {
    return { issueId: normalized, action: 'skipped', reason: 'no record' };
  }
  if (record.pipeline?.mergeStatus === 'merged') {
    return { issueId: normalized, action: 'skipped', reason: 'record already has mergeStatus=merged' };
  }

  const verdict = await verifyIssueMergeFulfillment(normalized, project, {
    ...deps,
    readRecord: () => record,
  });
  if (verdict.verdict !== 'merged') {
    return {
      issueId: normalized,
      action: 'flagged',
      verdict: verdict.verdict,
      evidence: verdict.evidence,
      reason: `${verdict.verdict}: ${verdict.evidence}`,
    };
  }

  await reconcileMergedIssue(
    normalized,
    project,
    { closed: shouldApplyClosedOutLabel(record), dryRun: options.dryRun },
    {
      ...deps,
      readRecord: () => record,
    },
  );

  return {
    issueId: normalized,
    action: options.dryRun ? 'would-reconcile' : 'reconciled',
    verdict: verdict.verdict,
    evidence: verdict.evidence,
  };
}

export async function reconcileMergeFulfillment(
  options: ReconcileMergeFulfillmentOptions = {},
  deps: Partial<MergeFulfillmentDeps> = {},
): Promise<ReconcileMergeFulfillmentResult> {
  const config = loadProjectsConfigSync();
  const projects = Object.values(config.projects);

  const issueIds = options.issueId
    ? new Set([options.issueId.toUpperCase()])
    : await collectRecordIssueIds(projects);

  const result: ReconcileMergeFulfillmentResult = {
    reconciled: 0,
    flagged: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const issueId of issueIds) {
    if (options.verbose) {
      console.log(`[merge-fulfillment] ${issueId} ...`);
    }

    const detail = await reconcileOneFulfilledMerge(issueId, options, deps);
    result.details.push(detail);

    if (detail.action === 'reconciled' || detail.action === 'would-reconcile') result.reconciled++;
    else if (detail.action === 'flagged') result.flagged++;
    else if (detail.action === 'skipped') result.skipped++;
    else result.failed++;

    if (options.verbose) {
      console.log(`[merge-fulfillment] ${issueId} -> ${detail.action}${detail.reason ? ` (${detail.reason})` : ''}`);
    }
  }

  return result;
}
