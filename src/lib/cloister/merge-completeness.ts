import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { getForgeAdapter, type ForgeType } from '../forge.js';
import {
  ensureMergeSetForIssueSync,
  getMergeSetSync,
  patchMergeSetRepoSync,
  patchMergeSetReposSync,
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
  artifactId?: string;
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
  artifactUrl?: string;
  artifactId?: string;
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
      { cwd: repo.repoPath, encoding: 'utf-8', timeout: 30000 },
    );
    return true;
  } catch (error) {
    if (!isMissingSourceBranch(error, repo.sourceBranch)) throw error;
    await execAsync(
      `git fetch origin ${shellQuote(repo.targetBranch)}`,
      { cwd: repo.repoPath, encoding: 'utf-8', timeout: 30000 },
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
      { cwd: repo.repoPath, encoding: 'utf-8', timeout: 30000 },
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

    const artifactInput = {
      sourceBranch: repo.sourceBranch,
      cwd: repo.repoPath,
    };
    if (repo.forge === 'gitlab') {
      const { stdout: headStdout } = await execAsync(
        `git rev-parse ${shellQuote(`origin/${repo.sourceBranch}`)}`,
        { cwd: repo.repoPath, encoding: 'utf-8', timeout: 10000 },
      );
      const headSha = headStdout.trim();
      if (!headSha) throw new Error(`Unable to resolve origin/${repo.sourceBranch}`);
      Object.assign(artifactInput, {
        targetBranch: repo.targetBranch,
        headSha,
        artifactUrl: repo.artifactUrl,
        artifactId: repo.artifactId,
      });
    }

    const artifact = await getForgeAdapter(repo.forge).findMergedArtifact(artifactInput);
    if (artifact) {
      return {
        repoKey: repo.repoKey,
        state: 'merged',
        aheadCount,
        artifactUrl: artifact.url,
        artifactId: artifact.id,
        reason: repo.forge === 'gitlab'
          ? `${repo.repoKey} has a merged review artifact for the current ${repo.sourceBranch} head`
          : `${repo.repoKey} has a merged review artifact for ${repo.sourceBranch}`,
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
  let mergeSet = resolved.mergeSet;

  if (mergeSet && !repos.some((repo) => repo.state === 'unverifiable')) {
    for (let index = 0; index < repos.length; index += 1) {
      const result = repos[index]!;
      if (result.state !== 'merged' || !result.artifactUrl) continue;
      const observed = mergeSet.repos.find((repo) => repo.repoKey === result.repoKey);
      const artifactMatches = observed?.artifactUrl === result.artifactUrl
        && (result.artifactId === undefined || observed.artifactId === result.artifactId);
      if (observed?.mergeStatus === 'merged' && artifactMatches) continue;
      const patched = observed && patchMergeSetRepoSync(issueId, result.repoKey, observed, {
        artifactId: result.artifactId,
        artifactUrl: result.artifactUrl,
        mergeStatus: 'merged',
      });
      if (!patched) {
        repos[index] = {
          ...result,
          state: 'unverifiable',
          reason: `${result.repoKey} merge-set row changed during forge observation; retrying on the next patrol`,
        };
      }
    }
    mergeSet = getMergeSetSync(issueId) ?? mergeSet;
  }

  const complete = repos.every((repo) => repo.state === 'merged' || repo.state === 'no-changes');
  return {
    complete,
    hasPositiveMergedEvidence: hasPositiveMergedEvidence(repos),
    mergeSet,
    repos,
    summary: buildSummary(repos, complete),
  };
}

export async function reconcileStrandedRepos(
  initialMergeSet: MergeSet,
): Promise<StrandedRepoReconciliationResult> {
  const issueId = initialMergeSet.issueId;
  let mergeSet = getMergeSetSync(issueId) ?? initialMergeSet;
  const blockers: MergeCompletenessRepoResult[] = [];
  const plannedPatches = new Map<string, Parameters<typeof patchMergeSetReposSync>[1][number]>();

  const planPatch = (
    observed: MergeSet['repos'][number],
    patch: Parameters<typeof patchMergeSetRepoSync>[3],
  ): void => {
    const existing = plannedPatches.get(observed.repoKey);
    plannedPatches.set(observed.repoKey, existing
      ? { ...existing, patch: { ...existing.patch, ...patch } }
      : { repoKey: observed.repoKey, expected: observed, patch });
    mergeSet = {
      ...mergeSet,
      repos: mergeSet.repos.map((repo) => (
        repo.repoKey === observed.repoKey ? { ...repo, ...patch } : repo
      )),
    };
  };

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
        planPatch(repo, { artifactUrl: discovered.url, artifactId: discovered.id });
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
      planPatch(repo, { mergeStatus: 'skipped' });
    } else if (result.state === 'merged' && result.artifactUrl) {
      planPatch(repo, {
        artifactId: result.artifactId,
        artifactUrl: result.artifactUrl,
        mergeStatus: 'merged',
      });
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
    const result = await assessRepoMergeCompleteness(repo);
    if (result.state === 'merged' && result.artifactUrl) {
      planPatch(repo, {
        artifactId: result.artifactId,
        artifactUrl: result.artifactUrl,
        mergeStatus: 'merged',
      });
    } else if (result.state === 'unverifiable') {
      blockers.push(result);
    }
  }

  if (blockers.some((blocker) => blocker.state === 'unverifiable')) {
    return { mergeSet: getMergeSetSync(issueId) ?? initialMergeSet, blockers };
  }

  const patches = [...plannedPatches.values()];
  if (patches.length > 0 && !patchMergeSetReposSync(issueId, patches)) {
    blockers.push({
      repoKey: patches.map((entry) => entry.repoKey).join(', '),
      state: 'unverifiable',
      aheadCount: 0,
      reason: 'Merge-set rows changed during merge reconciliation; retry the merge',
    });
  }

  return { mergeSet: getMergeSetSync(issueId) ?? mergeSet, blockers };
}
