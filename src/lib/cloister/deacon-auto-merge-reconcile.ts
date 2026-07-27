import { getForgeAdapter } from '../forge.js';
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
const autoMergeReconcileCooldowns = new Map<string, number>();

export interface AutoMergeReconcileDeps {
  now(): number;
  listProblemAutoMerges: typeof listProblemAutoMerges;
  listActiveAutoMerges: typeof listActiveAutoMerges;
  cancelPending: typeof cancelPending;
  markMerged: typeof markMerged;
  readJournalStatus: typeof readJournalStatusSync;
  resolveProject: typeof resolveProjectFromIssueSync;
  getForgeAdapter: typeof getForgeAdapter;
  log(message: string): void;
  warn(message: string): void;
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

  for (const [issueId, issueRows] of groupByIssue(rows)) {
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

      const artifact = await deps.getForgeAdapter(representative.forge).findMergedArtifact({
        sourceBranch: `feature/${issueId.toLowerCase()}`,
        artifactUrl: representative.prUrl,
        cwd: project.projectPath,
      });

      if (!artifact) {
        autoMergeReconcileCooldowns.set(issueId, now + AUTO_MERGE_RECONCILE_COOLDOWN_MS);
        continue;
      }

      for (const row of problemRows) {
        if (!deps.markMerged(row.id)) continue;
        const action = `Reconciled auto-merge row ${row.id} for ${issueId} — forge confirms the merge`;
        actions.push(action);
        deps.log(`[deacon] ${action}`);
      }
      autoMergeReconcileCooldowns.delete(issueId);
    } catch (error) {
      autoMergeReconcileCooldowns.set(issueId, now + AUTO_MERGE_RECONCILE_COOLDOWN_MS);
      deps.warn(`[deacon] Auto-merge row reconciliation failed for ${issueId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

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
    resolveProject: resolveProjectFromIssueSync,
    getForgeAdapter,
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
  });
}
