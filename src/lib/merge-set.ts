import { Effect } from 'effect';
import {
  deleteMergeSet as dbDelete,
  getAllMergeSetsFromDb,
  getMergeSetFromDb,
  upsertMergeSet as dbUpsert,
} from './database/merge-set-db.js';
import type { ForgeType } from './forge.js';
import { resolveProjectFromIssueSync } from './projects.js';
import { resolveProjectReposFromResolvedIssueSync } from './project-repos.js';

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

export function upsertMergeSetSync(mergeSet: MergeSet): void {
  dbUpsert(mergeSet);
}

export function getMergeSetSync(issueId: string): MergeSet | null {
  return getMergeSetFromDb(issueId);
}

export function getAllMergeSetsSync(projectKey?: string): MergeSet[] {
  return getAllMergeSetsFromDb(projectKey);
}

export function deleteMergeSetSync(issueId: string): void {
  dbDelete(issueId);
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// All operations delegate to the SQLite-backed merge-set DB. The underlying
// merge-set-db is sync (better-sqlite3); these wrappers preserve the contract
// and route exceptions through Effect.try so callers in Effect graphs get a
// typed error channel instead of an unchecked throw.

/** Insert-or-update a merge-set in the DB. */
export const upsertMergeSet = (mergeSet: MergeSet): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => upsertMergeSetSync(mergeSet),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** Fetch a merge-set by issue id. */
export const getMergeSet = (issueId: string): Effect.Effect<MergeSet | null, Error> =>
  Effect.try({
    try: () => getMergeSetSync(issueId),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** List all merge-sets (optionally filtered by project). */
export const getAllMergeSets = (projectKey?: string): Effect.Effect<MergeSet[], Error> =>
  Effect.try({
    try: () => getAllMergeSetsSync(projectKey),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** Delete a merge-set by issue id. */
export const deleteMergeSet = (issueId: string): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => deleteMergeSetSync(issueId),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** Build a new merge-set from an issue id + labels (no DB write). Pure. */
export const buildMergeSetForIssue = (
  issueId: string,
  labels: string[] = [],
): Effect.Effect<MergeSet | null> =>
  Effect.sync(() => buildMergeSetForIssueSync(issueId, labels));

/** Build-or-fetch a merge-set; persists when newly built. */
export const ensureMergeSetForIssue = (
  issueId: string,
  labels: string[] = [],
): Effect.Effect<MergeSet | null, Error> =>
  Effect.try({
    try: () => ensureMergeSetForIssueSync(issueId, labels),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

/** Immutably attach an artifact URL/id to a repo entry. Pure. */
export const withRepoArtifactUrl = (
  mergeSet: MergeSet,
  repoKey: string,
  artifactUrl: string,
  artifactId?: string,
): Effect.Effect<MergeSet> =>
  Effect.sync(() => withRepoArtifactUrlSync(mergeSet, repoKey, artifactUrl, artifactId));

/** Immutably patch a repo state entry. Pure. */
export const withRepoState = (
  mergeSet: MergeSet,
  repoKey: string,
  patch: Partial<MergeSetRepoState>,
): Effect.Effect<MergeSet> => Effect.sync(() => withRepoStateSync(mergeSet, repoKey, patch));
