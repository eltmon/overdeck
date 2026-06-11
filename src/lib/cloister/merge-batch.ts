/**
 * Sequential batch merge (PAN-1691) — the engine behind "ship the UAT candidate"
 * and "merge next N".
 *
 * Merges issues in the given (conflict-aware) order, ONE AT A TIME, and stops at
 * the first failure: once a merge fails (or conflicts), every later issue would
 * need re-rebasing against the new main, so attempting them blindly is wrong —
 * they're reported as `skipped` and left for the reconciler / a retry.
 *
 * Pure and dependency-injected so it is unit-testable without touching git; the
 * real per-issue merge + the endpoint/UI live at the call site.
 */

export type MergeBatchOutcome =
  | { issueId: string; result: 'merged' }
  | { issueId: string; result: 'failed'; reason: string }
  | { issueId: string; result: 'skipped' };

export interface MergeBatchDeps {
  /** Merge one issue to main. Resolves ok:false (never throws) on a clean failure. */
  merge: (issueId: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  log?: (msg: string) => void;
}

export async function shipMergeBatch(
  issueIds: ReadonlyArray<string>,
  deps: MergeBatchDeps,
): Promise<MergeBatchOutcome[]> {
  const log = deps.log ?? (() => {});
  const out: MergeBatchOutcome[] = [];
  let stopped = false;

  for (const issueId of issueIds) {
    if (stopped) {
      out.push({ issueId, result: 'skipped' });
      continue;
    }
    try {
      const r = await deps.merge(issueId);
      if (r.ok) {
        log(`[merge-batch] merged ${issueId}`);
        out.push({ issueId, result: 'merged' });
      } else {
        log(`[merge-batch] ${issueId} failed: ${r.reason} — stopping batch`);
        out.push({ issueId, result: 'failed', reason: r.reason });
        stopped = true;
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log(`[merge-batch] ${issueId} threw: ${reason} — stopping batch`);
      out.push({ issueId, result: 'failed', reason });
      stopped = true;
    }
  }

  return out;
}
