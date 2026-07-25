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

function resolveRepos(issueId: string, labels: string[]): RepoToAssess[] | null {
  const mergeSet = ensureMergeSetForIssueSync(issueId, labels);
  if (mergeSet) return mergeSet.repos;
  return resolveProjectReposForIssueSync(issueId, labels);
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

export async function assessMergeCompleteness(
  issueId: string,
  labels: string[] = [],
): Promise<MergeCompletenessResult> {
  const resolvedRepos = resolveRepos(issueId, labels);
  if (!resolvedRepos || resolvedRepos.length === 0) {
    const repos: MergeCompletenessRepoResult[] = [];
    return { complete: false, repos, summary: buildSummary(repos, false) };
  }

  const repos = await Promise.all(resolvedRepos.map(assessRepoMergeCompleteness));
  const complete = repos.every((repo) => repo.state === 'merged' || repo.state === 'no-changes');
  return { complete, repos, summary: buildSummary(repos, complete) };
}

export async function reconcileStrandedRepos(
  initialMergeSet: MergeSet,
): Promise<StrandedRepoReconciliationResult> {
  let mergeSet = initialMergeSet;
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
        upsertMergeSetSync(mergeSet);
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
      upsertMergeSetSync(mergeSet);
    } else if (result.state === 'merged' && result.artifactUrl) {
      mergeSet = withRepoArtifactUrlSync(mergeSet, repo.repoKey, result.artifactUrl);
      upsertMergeSetSync(mergeSet);
    } else if (result.state === 'unmerged' || result.state === 'unverifiable') {
      blockers.push(result);
    }
  }

  return { mergeSet, blockers };
}
