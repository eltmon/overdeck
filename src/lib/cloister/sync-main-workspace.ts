import { resolveWorkspaceRepoRootsSync } from '../project-repos.js';

export interface SyncMainRepoResult {
  repoKey: string;
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  changedFiles?: string[];
  conflictFiles?: string[];
  reason?: string;
  skipped?: boolean;
}

export interface SyncMainResult {
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  changedFiles?: string[];
  conflictFiles?: string[];
  reason?: string;
  repos?: SyncMainRepoResult[];
}

type SyncRepo = (
  repoDir: string,
  issueId: string,
  targetBranch: string,
  signal?: AbortSignal,
) => Promise<Omit<SyncMainRepoResult, 'repoKey' | 'skipped'>>;

type LogActivity = (action: string, details: string, issueId?: string) => void;

export async function syncMainAcrossWorkspaceRepos(
  projectPath: string,
  issueId: string,
  signal: AbortSignal | undefined,
  syncRepo: SyncRepo,
  logActivity: LogActivity,
): Promise<SyncMainResult> {
  console.log(`[sync-main] Starting sync of main into workspace for ${issueId}`);
  logActivity('sync_main_start', `Starting sync for ${issueId}`);

  const roots = resolveWorkspaceRepoRootsSync(issueId, projectPath);
  const repos: SyncMainRepoResult[] = [];
  let failedRepoKey: string | undefined;

  for (const root of roots) {
    if (failedRepoKey) {
      repos.push({
        repoKey: root.repoKey,
        success: false,
        skipped: true,
        reason: `[${root.repoKey}] Skipped because sync failed in ${failedRepoKey}`,
      });
      continue;
    }

    if (root.isPolyrepo) {
      console.log(`[sync-main] [${root.repoKey}] Syncing origin/${root.targetBranch}`);
      logActivity('sync_main_repo_start', `[${root.repoKey}] Syncing origin/${root.targetBranch}`);
    }
    const result = await syncRepo(root.dir, issueId, root.targetBranch, signal);
    const prefixPaths = (paths: string[] | undefined) => root.isPolyrepo && paths
      ? paths.map(path => `${root.repoKey}/${path}`)
      : paths;
    const repoResult: SyncMainRepoResult = { ...result, repoKey: root.repoKey };
    if (result.changedFiles !== undefined) repoResult.changedFiles = prefixPaths(result.changedFiles);
    if (result.conflictFiles !== undefined) repoResult.conflictFiles = prefixPaths(result.conflictFiles);
    if (result.reason && root.isPolyrepo) repoResult.reason = `[${root.repoKey}] ${result.reason}`;
    repos.push(repoResult);
    if (!result.success) failedRepoKey = root.repoKey;
  }

  const completedRepos = repos.filter(repo => !repo.skipped);
  const changedFiles = completedRepos.flatMap(repo => repo.changedFiles ?? []);
  const conflictFiles = completedRepos.flatMap(repo => repo.conflictFiles ?? []);
  const countedRepos = completedRepos.filter(repo => repo.commitCount !== undefined);
  const failedRepo = completedRepos.find(repo => !repo.success);
  const aggregate: SyncMainResult = { success: !failedRepo, repos };

  if (completedRepos.length > 0 && completedRepos.every(repo => repo.alreadyUpToDate === true)) {
    aggregate.alreadyUpToDate = true;
  }
  if (countedRepos.length > 0) {
    aggregate.commitCount = countedRepos.reduce((sum, repo) => sum + (repo.commitCount ?? 0), 0);
  }
  if (completedRepos.some(repo => repo.changedFiles !== undefined)) aggregate.changedFiles = changedFiles;
  if (completedRepos.some(repo => repo.conflictFiles !== undefined)) aggregate.conflictFiles = conflictFiles;
  if (failedRepo?.reason) aggregate.reason = failedRepo.reason;

  return aggregate;
}
