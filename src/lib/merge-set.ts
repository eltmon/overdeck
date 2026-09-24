import {
  deleteMergeSet as dbDelete,
  getAllMergeSetsFromDb,
  getMergeSetFromDb,
  patchMergeSetRepo as dbPatchRepo,
  patchMergeSetRepos as dbPatchRepos,
  type MergeSetRepoPatch,
  upsertMergeSet as dbUpsert,
} from './overdeck/merge-sync.js';
import type { ForgeType } from './forge.js';
import { resolveProjectFromIssueSync } from './projects.js';
import { resolveProjectReposFromResolvedIssueSync } from './project-repos.js';
import { resolveIssueIdSync } from './issue-id.js';

export type MergeSetStatus = 'draft' | 'reviewing' | 'ready' | 'merging' | 'merged' | 'failed';
export type MergeSetGateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped';
export type MergeSetRebaseStatus = 'pending' | 'requested' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped';
export type MergeSetRepoMergeStatus = 'pending' | 'ready' | 'merging' | 'merged' | 'failed' | 'blocked' | 'skipped';

export interface MergeSetRepoState {
  repoKey: string;
  repoPath: string;
  forge: ForgeType;
  sourceBranch: string;
  targetBranch: string;
  artifactUrl?: string;
  artifactId?: string;
  repoReview: MergeSetGateStatus;
  repoTests: MergeSetGateStatus;
  rebaseStatus: MergeSetRebaseStatus;
  repoVerification: MergeSetGateStatus;
  repoMerge: MergeSetRepoMergeStatus;
  mergeOrder: number;
  required: boolean;
}

export interface MergeSet {
  issueId: string;
  projectKey: string;
  projectPath: string;
  workspaceType: 'monorepo' | 'polyrepo';
  status: MergeSetStatus;
  createdAt: string;
  updatedAt: string;
  repos: MergeSetRepoState[];
}

export function upsertMergeSetSync(mergeSet: MergeSet): void {
  dbUpsert({ ...mergeSet, issueId: resolveIssueIdSync(mergeSet.issueId) });
}

/** Fetch a merge-set by issue id; throws on a merge-set DB failure. */
export function getMergeSetSync(issueId: string): MergeSet | null {
  return getMergeSetFromDb(resolveIssueIdSync(issueId));
}

export function getAllMergeSetsSync(projectKey?: string): MergeSet[] {
  return getAllMergeSetsFromDb(projectKey);
}

export function deleteMergeSetSync(issueId: string): void {
  dbDelete(resolveIssueIdSync(issueId));
}

export function buildMergeSetForIssueSync(issueId: string, labels: string[] = []): MergeSet | null {
  const resolved = resolveProjectFromIssueSync(issueId, labels);
  if (!resolved) return null;

  const repos = resolveProjectReposFromResolvedIssueSync(issueId, resolved);
  if (!repos) return null;

  const now = new Date().toISOString();
  return {
    issueId,
    projectKey: resolved.projectKey,
    projectPath: resolved.projectPath,
    workspaceType: repos.length > 1 ? 'polyrepo' : 'monorepo',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    repos: repos.map(repo => ({
      repoKey: repo.repoKey,
      repoPath: repo.repoPath,
      forge: repo.forge,
      sourceBranch: repo.sourceBranch,
      targetBranch: repo.targetBranch,
      repoReview: 'pending',
      repoTests: 'pending',
      rebaseStatus: 'pending',
      repoVerification: 'pending',
      repoMerge: 'pending',
      mergeOrder: repo.mergeOrder,
      required: repo.required,
    })),
  };
}

export function ensureMergeSetForIssueSync(issueId: string, labels: string[] = []): MergeSet | null {
  const existing = getMergeSetSync(issueId);
  if (existing) return existing;

  const built = buildMergeSetForIssueSync(issueId, labels);
  if (built) {
    upsertMergeSetSync(built);
  }
  return built;
}

export function withRepoArtifactUrlSync(
  mergeSet: MergeSet,
  repoKey: string,
  artifactUrl: string,
  artifactId?: string
): MergeSet {
  return {
    ...mergeSet,
    updatedAt: new Date().toISOString(),
    repos: mergeSet.repos.map(repo => (
      repo.repoKey === repoKey
        ? { ...repo, artifactUrl, artifactId }
        : repo
    )),
  };
}

export function withRepoStateSync(
  mergeSet: MergeSet,
  repoKey: string,
  patch: Partial<MergeSetRepoState>
): MergeSet {
  return {
    ...mergeSet,
    updatedAt: new Date().toISOString(),
    repos: mergeSet.repos.map(repo => (
      repo.repoKey === repoKey
        ? { ...repo, ...patch }
        : repo
    )),
  };
}

export function patchMergeSetRepoSync(
  issueId: string,
  repoKey: string,
  expected: Pick<MergeSetRepoState, 'sourceBranch' | 'targetBranch' | 'artifactUrl' | 'artifactId'>,
  patch: Partial<Pick<MergeSetRepoState, 'artifactUrl' | 'artifactId' | 'repoMerge'>>,
): boolean {
  return dbPatchRepo(resolveIssueIdSync(issueId), repoKey, expected, patch);
}

export function patchMergeSetReposSync(issueId: string, patches: MergeSetRepoPatch[]): boolean {
  return dbPatchRepos(resolveIssueIdSync(issueId), patches);
}
