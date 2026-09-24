import {
  getMergeSetFromDb,
  upsertMergeSet as dbUpsert,
} from './overdeck/merge-sync.js';
import type { ForgeType } from './forge.js';
import { resolveProjectFromIssueSync } from './projects.js';
import { resolveProjectReposFromResolvedIssue } from './project-repos.js';
import { resolveIssueId } from './issue-id.js';

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

export function upsertMergeSet(mergeSet: MergeSet): void {
  dbUpsert({ ...mergeSet, issueId: resolveIssueId(mergeSet.issueId) });
}

/** Fetch a merge-set by issue id; throws on a merge-set DB failure. */
export function getMergeSet(issueId: string): MergeSet | null {
  return getMergeSetFromDb(resolveIssueId(issueId));
}

export function buildMergeSetForIssue(issueId: string, labels: string[] = []): MergeSet | null {
  const resolved = resolveProjectFromIssueSync(issueId, labels);
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
