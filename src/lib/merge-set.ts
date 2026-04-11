import {
  deleteMergeSet as dbDelete,
  getAllMergeSetsFromDb,
  getMergeSetFromDb,
  upsertMergeSet as dbUpsert,
} from './database/merge-set-db.js';
import type { ForgeType } from './forge.js';
import { resolveProjectFromIssue } from './projects.js';
import { resolveProjectReposFromResolvedIssue } from './project-repos.js';

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
  reviewStatus: MergeSetGateStatus;
  testStatus: MergeSetGateStatus;
  rebaseStatus: MergeSetRebaseStatus;
  verificationStatus: MergeSetGateStatus;
  mergeStatus: MergeSetRepoMergeStatus;
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

export function upsertMergeSet(mergeSet: MergeSet): void {
  dbUpsert(mergeSet);
}

export function getMergeSet(issueId: string): MergeSet | null {
  return getMergeSetFromDb(issueId);
}

export function getAllMergeSets(projectKey?: string): MergeSet[] {
  return getAllMergeSetsFromDb(projectKey);
}

export function deleteMergeSet(issueId: string): void {
  dbDelete(issueId);
}

export function buildMergeSetForIssue(issueId: string, labels: string[] = []): MergeSet | null {
  const resolved = resolveProjectFromIssue(issueId, labels);
  if (!resolved) return null;

  const repos = resolveProjectReposFromResolvedIssue(issueId, resolved);
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
      reviewStatus: 'pending',
      testStatus: 'pending',
      rebaseStatus: 'pending',
      verificationStatus: 'pending',
      mergeStatus: 'pending',
      mergeOrder: repo.mergeOrder,
      required: repo.required,
    })),
  };
}

export function ensureMergeSetForIssue(issueId: string, labels: string[] = []): MergeSet | null {
  const existing = getMergeSet(issueId);
  if (existing) return existing;

  const built = buildMergeSetForIssue(issueId, labels);
  if (built) {
    upsertMergeSet(built);
  }
  return built;
}

export function withRepoArtifactUrl(
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

export function withRepoState(
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
