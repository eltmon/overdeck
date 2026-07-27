import { getForgeAdapter, type ForgeType } from '../forge.js';
import { getMergeSetSync, type MergeSetRepoState } from '../merge-set.js';
import {
  cancelPending,
  listActiveAutoMerges,
  listProblemAutoMerges,
  markMerged,
  type PendingAutoMerge,
} from '../overdeck/merge-sync.js';
import { readJournalStatusSync } from '../overdeck/review-status-record-sync.js';
import { resolveProjectFromIssueSync } from '../projects.js';

const AUTO_MERGE_RECONCILE_COOLDOWN_MS = 10 * 60 * 1000;
// SQLite LIMIT -1 removes the limit. Patrol reconciliation must inspect the
// whole queue or the oldest unresolved page can starve every newer row.
const UNBOUNDED_ROW_LIMIT = -1;
export const AUTO_MERGE_RECONCILE_FORGE_LIMIT = 4;
const autoMergeReconcileCooldowns = new Map<string, number>();
const autoMergeLastCheckedAt = new Map<string, number>();

export interface AutoMergeReconcileDeps {
  now(): number;
  listProblemAutoMerges: typeof listProblemAutoMerges;
  listActiveAutoMerges: typeof listActiveAutoMerges;
  cancelPending: typeof cancelPending;
  markMerged: typeof markMerged;
  readJournalStatus: typeof readJournalStatusSync;
  getMergeSet: typeof getMergeSetSync;
  resolveProject: typeof resolveProjectFromIssueSync;
  getForgeAdapter: typeof getForgeAdapter;
  log(message: string): void;
  warn(message: string): void;
}

interface ForgeCandidate {
  issueId: string;
  problemRows: PendingAutoMerge[];
  representative: PendingAutoMerge;
  artifactRepo?: MergeSetRepoState;
  projectPath: string;
}

function groupByIssue(rows: PendingAutoMerge[]): Map<string, PendingAutoMerge[]> {
  const grouped = new Map<string, PendingAutoMerge[]>();
  for (const row of rows) {
    const issueRows = grouped.get(row.issueId) ?? [];
    issueRows.push(row);
    grouped.set(row.issueId, issueRows);
  }
  return grouped;
}

function normalizeArtifactUrl(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/+$/, '');
}

function repositoryFromArtifactUrl(url: string, forge: ForgeType): string | undefined {
  try {
    const parsed = new URL(url);
    if (forge === 'github' && parsed.hostname.toLowerCase() !== 'github.com') return undefined;
    const marker = forge === 'gitlab' ? '/-/merge_requests/' : '/pull/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex <= 1) return undefined;
    return parsed.pathname.slice(1, markerIndex);
  } catch {
    return undefined;
  }
}

function pruneTracking(activeIssueIds: Set<string>): void {
  for (const issueId of autoMergeReconcileCooldowns.keys()) {
    if (!activeIssueIds.has(issueId)) autoMergeReconcileCooldowns.delete(issueId);
  }
  for (const issueId of autoMergeLastCheckedAt.keys()) {
    if (!activeIssueIds.has(issueId)) autoMergeLastCheckedAt.delete(issueId);
  }
}

async function reconcileForgeCandidate(
  candidate: ForgeCandidate,
  deps: AutoMergeReconcileDeps,
  now: number,
): Promise<string[]> {
  const { issueId, problemRows, representative, artifactRepo, projectPath } = candidate;
  autoMergeLastCheckedAt.set(issueId, now);

  try {
    const repository = repositoryFromArtifactUrl(representative.prUrl, representative.forge);
    const artifact = await deps.getForgeAdapter(representative.forge).findMergedArtifact({
      sourceBranch: artifactRepo?.sourceBranch ?? `feature/${issueId.toLowerCase()}`,
      ...(artifactRepo?.targetBranch ? { targetBranch: artifactRepo.targetBranch } : {}),
      artifactUrl: representative.prUrl,
      ...(artifactRepo?.artifactId ? { artifactId: artifactRepo.artifactId } : {}),
      ...(repository ? { repository } : {}),
      cwd: artifactRepo?.repoPath ?? projectPath,
    });

    if (!artifact) {
      autoMergeReconcileCooldowns.set(issueId, now + AUTO_MERGE_RECONCILE_COOLDOWN_MS);
      return [];
    }

    const actions: string[] = [];
    for (const row of problemRows) {
      if (!deps.markMerged(row.id)) continue;
      const action = `Reconciled auto-merge row ${row.id} for ${issueId} — forge confirms the merge`;
      actions.push(action);
      deps.log(`[deacon] ${action}`);
    }
    autoMergeReconcileCooldowns.delete(issueId);
    return actions;
  } catch (error) {
    autoMergeReconcileCooldowns.set(issueId, now + AUTO_MERGE_RECONCILE_COOLDOWN_MS);
    deps.warn(`[deacon] Auto-merge row reconciliation failed for ${issueId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function reconcileAutoMergeRowsWithDeps(
  deps: AutoMergeReconcileDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const now = deps.now();
  let rows: PendingAutoMerge[];

  try {
    rows = [
      ...deps.listProblemAutoMerges(UNBOUNDED_ROW_LIMIT),
      ...deps.listActiveAutoMerges(UNBOUNDED_ROW_LIMIT).filter((row) => row.status === 'pending'),
    ];
  } catch (error) {
    deps.warn(`[deacon] Auto-merge row reconciliation failed to list rows: ${error instanceof Error ? error.message : String(error)}`);
    return actions;
  }

  const grouped = groupByIssue(rows);
  pruneTracking(new Set(grouped.keys()));
  const forgeCandidates: ForgeCandidate[] = [];

  for (const [issueId, issueRows] of grouped) {
    const cooledUntil = autoMergeReconcileCooldowns.get(issueId);
    if (cooledUntil && now < cooledUntil) continue;

    try {
      const closedOut = deps.readJournalStatus(issueId)?.durable.closedOut === true;
      if (closedOut) {
        for (const row of issueRows) {
          if (!deps.cancelPending(row.id, 'auto-merge-reconciler')) continue;
          const action = `Cancelled closed-out auto-merge row ${row.id} for ${issueId}`;
          actions.push(action);
          deps.log(`[deacon] ${action}`);
        }
        autoMergeReconcileCooldowns.delete(issueId);
        autoMergeLastCheckedAt.delete(issueId);
        continue;
      }

      const problemRows = issueRows.filter(
        (row) => row.status === 'blocked' || row.status === 'failed',
      );
      if (problemRows.length === 0) continue;

      const representative = problemRows.reduce(
        (latest, row) => row.id > latest.id ? row : latest,
      );
      const project = deps.resolveProject(issueId);
      if (!project) throw new Error(`project resolution failed for ${issueId}`);
      const artifactUrl = normalizeArtifactUrl(representative.prUrl);
      const artifactRepo = deps.getMergeSet(issueId)?.repos.find(
        (repo) => repo.forge === representative.forge
          && repo.artifactUrl !== undefined
          && normalizeArtifactUrl(repo.artifactUrl) === artifactUrl,
      );
      forgeCandidates.push({
        issueId,
        problemRows,
        representative,
        artifactRepo,
        projectPath: project.projectPath,
      });
    } catch (error) {
      autoMergeReconcileCooldowns.set(issueId, now + AUTO_MERGE_RECONCILE_COOLDOWN_MS);
      deps.warn(`[deacon] Auto-merge row reconciliation failed for ${issueId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  forgeCandidates.sort((left, right) => {
    const checkedDelta = (autoMergeLastCheckedAt.get(left.issueId) ?? 0)
      - (autoMergeLastCheckedAt.get(right.issueId) ?? 0);
    return checkedDelta || left.representative.id - right.representative.id;
  });
  const batch = forgeCandidates.slice(0, AUTO_MERGE_RECONCILE_FORGE_LIMIT);
  const reconciled = await Promise.all(
    batch.map((candidate) => reconcileForgeCandidate(candidate, deps, now)),
  );
  for (const candidateActions of reconciled) actions.push(...candidateActions);

  return actions;
}

export async function reconcileAutoMergeRows(): Promise<string[]> {
  return reconcileAutoMergeRowsWithDeps({
    now: Date.now,
    listProblemAutoMerges,
    listActiveAutoMerges,
    cancelPending,
    markMerged,
    readJournalStatus: readJournalStatusSync,
    getMergeSet: getMergeSetSync,
    resolveProject: resolveProjectFromIssueSync,
    getForgeAdapter,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });
}
