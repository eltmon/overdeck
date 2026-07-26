import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getForgeAdapter, type ForgeType } from '../forge.js';
import {
  ensureMergeSetForIssueSync,
  upsertMergeSetSync,
  withRepoArtifactUrlSync,
  withRepoStateSync,
  type MergeSet,
} from '../merge-set.js';
import { resolveProjectReposForIssueSync } from '../project-repos.js';

const execAsync = promisify(exec);

export type MergeCompletenessRepoState = 'merged' | 'no-changes' | 'unmerged' | 'unverifiable';

export interface MergeCompletenessRepoResult {
  repoKey: string;
  state: MergeCompletenessRepoState;
  aheadCount: number;
  artifactUrl?: string;
  reason: string;
}

export interface MergeCompletenessResult {
  complete: boolean;
  repos: MergeCompletenessRepoResult[];
  summary: string;
}

export interface ForgeMergeObservationResult extends MergeCompletenessResult {
  hasPositiveMergedEvidence: boolean;
  mergeSet: MergeSet | null;
}

export interface StrandedRepoReconciliationResult {
  mergeSet: MergeSet;
  blockers: MergeCompletenessRepoResult[];
}

export interface RepoToAssess {
  repoKey: string;
  repoPath: string;
  forge: ForgeType;
  sourceBranch: string;
  targetBranch: string;
  required: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const stderr = 'stderr' in error ? String(error.stderr || '') : '';
  return `${error.message} ${stderr}`.trim();
}

function isMissingSourceBranch(error: unknown, sourceBranch: string): boolean {
  const message = errorMessage(error);
  return message.includes("couldn't find remote ref") && message.includes(sourceBranch);
}

async function fetchBranches(repo: RepoToAssess): Promise<boolean> {
  try {
    await execAsync(
      `git fetch origin ${shellQuote(repo.sourceBranch)} ${shellQuote(repo.targetBranch)}`,
      { cwd: repo.repoPath, encoding: 'utf-8' },
    );
    return true;
  } catch (error) {
    if (!isMissingSourceBranch(error, repo.sourceBranch)) throw error;
    await execAsync(
      `git fetch origin ${shellQuote(repo.targetBranch)}`,
      { cwd: repo.repoPath, encoding: 'utf-8' },
    );
    return false;
  }
}

function resolveRepos(
  issueId: string,
  labels: string[],
): { mergeSet: MergeSet | null; repos: RepoToAssess[] | null } {
  const mergeSet = ensureMergeSetForIssueSync(issueId, labels);
  return {
    mergeSet,
    repos: mergeSet?.repos ?? resolveProjectReposForIssueSync(issueId, labels),
  };
}

function buildSummary(repos: MergeCompletenessRepoResult[], complete: boolean): string {
  if (repos.length === 0) return 'Merge completeness is unverifiable because no repositories resolved';
  if (complete) return `Merge complete across ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'}`;

  const blockers = repos.filter((repo) => repo.state === 'unmerged' || repo.state === 'unverifiable');
  return blockers.map((repo) => repo.reason).join('; ');
}

export async function assessRepoMergeCompleteness(repo: RepoToAssess): Promise<MergeCompletenessRepoResult> {
  if (!repo.required) {
    return {
      repoKey: repo.repoKey,
      state: 'no-changes',
      aheadCount: 0,
      reason: `${repo.repoKey} is readonly and not required for merge completeness`,
    };
  }

  try {
    const sourceExists = await fetchBranches(repo);
    if (!sourceExists) {
      return {
        repoKey: repo.repoKey,
        state: 'no-changes',
        aheadCount: 0,
        reason: `${repo.repoKey} source branch ${repo.sourceBranch} does not exist on origin`,
      };
    }

    const { stdout } = await execAsync(
      `git rev-list --count origin/${shellQuote(repo.targetBranch)}..origin/${shellQuote(repo.sourceBranch)}`,
      { cwd: repo.repoPath, encoding: 'utf-8' },
    );
    const aheadCount = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(aheadCount) || aheadCount < 0) {
      throw new Error(`Invalid ahead count: ${stdout.trim()}`);
    }

    if (aheadCount === 0) {
      return {
        repoKey: repo.repoKey,
        state: 'no-changes',
        aheadCount,
        reason: `${repo.repoKey} has no commits ahead of ${repo.targetBranch}`,
      };
    }

    const artifact = await getForgeAdapter(repo.forge).findMergedArtifact({
      sourceBranch: repo.sourceBranch,
      cwd: repo.repoPath,
    });
    if (artifact) {
      return {
        repoKey: repo.repoKey,
        state: 'merged',
        aheadCount,
        artifactUrl: artifact.url,
        reason: `${repo.repoKey} has a merged review artifact for ${repo.sourceBranch}`,
      };
    }

    return {
      repoKey: repo.repoKey,
      state: 'unmerged',
      aheadCount,
      reason: `${repo.repoKey} has ${aheadCount} commits on ${repo.sourceBranch} ahead of ${repo.targetBranch} with no merged review artifact`,
    };
  } catch (error) {
    return {
      repoKey: repo.repoKey,
      state: 'unverifiable',
      aheadCount: 0,
      reason: `${repo.repoKey} merge state is unverifiable: ${errorMessage(error)}`,
    };
  }
}

export function hasPositiveMergedEvidence(repos: MergeCompletenessRepoResult[]): boolean {
  return repos.some((repo) => repo.state === 'merged');
}

export async function assessMergeCompleteness(
  issueId: string,
  labels: string[] = [],
): Promise<MergeCompletenessResult> {
  const resolved = resolveRepos(issueId, labels);
  if (!resolved.repos || resolved.repos.length === 0) {
    const repos: MergeCompletenessRepoResult[] = [];
    return { complete: false, repos, summary: buildSummary(repos, false) };
  }

  const repos = await Promise.all(resolved.repos.map(assessRepoMergeCompleteness));
  const complete = repos.every((repo) => repo.state === 'merged' || repo.state === 'no-changes');
  return { complete, repos, summary: buildSummary(repos, complete) };
}

export async function observeForgeMergeState(
  issueId: string,
  labels: string[] = [],
): Promise<ForgeMergeObservationResult> {
  const resolved = resolveRepos(issueId, labels);
  if (!resolved.repos || resolved.repos.length === 0) {
    const repos: MergeCompletenessRepoResult[] = [];
    return {
      complete: false,
      hasPositiveMergedEvidence: false,
      mergeSet: resolved.mergeSet,
      repos,
      summary: buildSummary(repos, false),
    };
  }

  const repos = await Promise.all(resolved.repos.map(assessRepoMergeCompleteness));
  const complete = repos.every((repo) => repo.state === 'merged' || repo.state === 'no-changes');
  const positiveMergedEvidence = hasPositiveMergedEvidence(repos);
  let mergeSet = resolved.mergeSet;

  if (mergeSet && !repos.some((repo) => repo.state === 'unverifiable')) {
    let changed = false;
    for (const result of repos) {
      if (result.state !== 'merged' || !result.artifactUrl) continue;
      const current = mergeSet.repos.find((repo) => repo.repoKey === result.repoKey);
      if (!current || (current.mergeStatus === 'merged' && current.artifactUrl === result.artifactUrl)) continue;
      mergeSet = withRepoStateSync(mergeSet, result.repoKey, {
        mergeStatus: 'merged',
        artifactUrl: result.artifactUrl,
      });
      changed = true;
    }
    if (changed) upsertMergeSetSync(mergeSet);
  }

  return {
    complete,
    hasPositiveMergedEvidence: positiveMergedEvidence,
    mergeSet,
    repos,
    summary: buildSummary(repos, complete),
  };
}

export async function reconcileStrandedRepos(
  initialMergeSet: MergeSet,
): Promise<StrandedRepoReconciliationResult> {
  let mergeSet = initialMergeSet;
  let changed = false;
  const blockers: MergeCompletenessRepoResult[] = [];
  const stranded = mergeSet.repos.filter(
    (repo) => repo.required && repo.mergeStatus !== 'skipped' && !repo.artifactUrl,
  );

  for (const repo of stranded) {
    try {
      const discovered = await getForgeAdapter(repo.forge).discoverArtifact({
        sourceBranch: repo.sourceBranch,
        cwd: repo.repoPath,
      });
      if (discovered?.url) {
        mergeSet = withRepoArtifactUrlSync(mergeSet, repo.repoKey, discovered.url, discovered.id);
        changed = true;
        continue;
      }
    } catch (error) {
      blockers.push({
        repoKey: repo.repoKey,
        state: 'unverifiable',
        aheadCount: 0,
        reason: `${repo.repoKey} artifact discovery is unverifiable: ${errorMessage(error)}`,
      });
      continue;
    }

    const result = await assessRepoMergeCompleteness(repo);
    if (result.state === 'no-changes') {
      mergeSet = withRepoStateSync(mergeSet, repo.repoKey, { mergeStatus: 'skipped' });
      changed = true;
    } else if (result.state === 'merged' && result.artifactUrl) {
      mergeSet = withRepoStateSync(mergeSet, repo.repoKey, {
        artifactUrl: result.artifactUrl,
        mergeStatus: 'merged',
      });
      changed = true;
    } else if (result.state === 'unmerged' || result.state === 'unverifiable') {
      blockers.push(result);
    }
  }

  const candidates = mergeSet.repos.filter(
    (repo) => repo.required
      && repo.mergeStatus !== 'skipped'
      && Boolean(repo.artifactUrl)
      && (repo.mergeStatus === 'pending' || repo.mergeStatus === 'failed' || repo.mergeStatus === 'merging'),
  );

  for (const repo of candidates) {
    try {
      const artifact = await getForgeAdapter(repo.forge).findMergedArtifact({
        sourceBranch: repo.sourceBranch,
        cwd: repo.repoPath,
      });
      if (!artifact) continue;
      mergeSet = withRepoStateSync(mergeSet, repo.repoKey, {
        artifactId: artifact.id,
        artifactUrl: artifact.url,
        mergeStatus: 'merged',
      });
      changed = true;
    } catch (error) {
      blockers.push({
        repoKey: repo.repoKey,
        state: 'unverifiable',
        aheadCount: 0,
        reason: `${repo.repoKey} merged artifact lookup is unverifiable: ${errorMessage(error)}`,
      });
    }
  }

  if (blockers.some((blocker) => blocker.state === 'unverifiable')) {
    return { mergeSet: initialMergeSet, blockers };
  }
  if (changed) upsertMergeSetSync(mergeSet);
  return { mergeSet, blockers };
}
