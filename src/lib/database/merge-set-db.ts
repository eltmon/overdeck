/**
 * Merge Set SQLite Storage.
 *
 * PAN-1249: Effect migration pass — public API stays synchronous to keep
 * the existing call sites unchanged. The DatabaseError tagged error is
 * re-exported from ./index.js so callers can surface typed SQLite
 * failures. Full conversion to @effect/sql-sqlite-bun is deferred to
 * PAN-447.
 */

import { getDatabase, DatabaseError } from './index.js';
import type { MergeSet, MergeSetRepoState } from '../merge-set.js';
export { DatabaseError };

export function upsertMergeSet(mergeSet: MergeSet): void {
  const db = getDatabase();

  const tx = db.transaction((set: MergeSet) => {
    db.prepare(`
      INSERT INTO merge_sets (
        issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(issue_id) DO UPDATE SET
        project_key = excluded.project_key,
        project_path = excluded.project_path,
        workspace_type = excluded.workspace_type,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(
      set.issueId,
      set.projectKey,
      set.projectPath,
      set.workspaceType,
      set.status,
      set.createdAt,
      set.updatedAt,
    );

    db.prepare(`DELETE FROM merge_set_repos WHERE issue_id = ?`).run(set.issueId);

    const insertRepo = db.prepare(`
      INSERT INTO merge_set_repos (
        issue_id, repo_key, repo_path, forge, source_branch, target_branch,
        artifact_url, artifact_id, review_status, test_status, rebase_status,
        verification_status, merge_status, merge_order, required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const repo of set.repos) {
      insertRepo.run(
        set.issueId,
        repo.repoKey,
        repo.repoPath,
        repo.forge,
        repo.sourceBranch,
        repo.targetBranch,
        repo.artifactUrl ?? null,
        repo.artifactId ?? null,
        repo.reviewStatus,
        repo.testStatus,
        repo.rebaseStatus,
        repo.verificationStatus,
        repo.mergeStatus,
        repo.mergeOrder,
        repo.required ? 1 : 0,
      );
    }
  });

  tx(mergeSet);
}

export function getMergeSetFromDb(issueId: string): MergeSet | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
    FROM merge_sets
    WHERE issue_id = ?
  `).get(issueId) as DbMergeSetRow | undefined;

  if (!row) return null;

  return rowToMergeSet(row, getReposFromDb(issueId));
}

export function getAllMergeSetsFromDb(projectKey?: string): MergeSet[] {
  const db = getDatabase();
  const rows = (
    projectKey
      ? db.prepare(`
          SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
          FROM merge_sets
          WHERE project_key = ?
          ORDER BY updated_at DESC
        `).all(projectKey)
      : db.prepare(`
          SELECT issue_id, project_key, project_path, workspace_type, status, created_at, updated_at
          FROM merge_sets
          ORDER BY updated_at DESC
        `).all()
  ) as DbMergeSetRow[];

  return rows.map(row => rowToMergeSet(row, getReposFromDb(row.issue_id)));
}

export function deleteMergeSet(issueId: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM merge_sets WHERE issue_id = ?`).run(issueId);
}

interface DbMergeSetRow {
  issue_id: string;
  project_key: string;
  project_path: string;
  workspace_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface DbMergeSetRepoRow {
  repo_key: string;
  repo_path: string;
  forge: string;
  source_branch: string;
  target_branch: string;
  artifact_url: string | null;
  artifact_id: string | null;
  review_status: string;
  test_status: string;
  rebase_status: string;
  verification_status: string;
  merge_status: string;
  merge_order: number;
  required: number;
}

function getReposFromDb(issueId: string): MergeSetRepoState[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT repo_key, repo_path, forge, source_branch, target_branch, artifact_url, artifact_id,
           review_status, test_status, rebase_status, verification_status, merge_status, merge_order, required
    FROM merge_set_repos
    WHERE issue_id = ?
    ORDER BY merge_order ASC, repo_key ASC
  `).all(issueId) as DbMergeSetRepoRow[];

  return rows.map(row => ({
    repoKey: row.repo_key,
    repoPath: row.repo_path,
    forge: row.forge as MergeSetRepoState['forge'],
    sourceBranch: row.source_branch,
    targetBranch: row.target_branch,
    artifactUrl: row.artifact_url ?? undefined,
    artifactId: row.artifact_id ?? undefined,
    reviewStatus: row.review_status as MergeSetRepoState['reviewStatus'],
    testStatus: row.test_status as MergeSetRepoState['testStatus'],
    rebaseStatus: row.rebase_status as MergeSetRepoState['rebaseStatus'],
    verificationStatus: row.verification_status as MergeSetRepoState['verificationStatus'],
    mergeStatus: row.merge_status as MergeSetRepoState['mergeStatus'],
    mergeOrder: row.merge_order,
    required: row.required === 1,
  }));
}

function rowToMergeSet(row: DbMergeSetRow, repos: MergeSetRepoState[]): MergeSet {
  return {
    issueId: row.issue_id,
    projectKey: row.project_key,
    projectPath: row.project_path,
    workspaceType: row.workspace_type as MergeSet['workspaceType'],
    status: row.status as MergeSet['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repos,
  };
}
