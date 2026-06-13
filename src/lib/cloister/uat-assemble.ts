/**
 * UAT candidate assembly (PAN-1691, auto-merge-OFF mode).
 *
 * Creates the throwaway `uat/<codename>-<date>` branch off main and merges each
 * bundled feature branch onto it, so a human can UAT the whole bundle in one
 * sitting. Unlike merging to main, this is non-destructive (a disposable test
 * vehicle). Pure orchestrator + injected git so it's testable; conflicts are
 * reported, not auto-resolved (the bundle is disjoint/batch-safe, so a conflict
 * here means the queue was stale — caller decides).
 */

export interface UatAssembleDeps {
  /** Create the candidate branch off the latest main (fresh tree). */
  createCandidateBranch: (branchName: string) => Promise<void>;
  /** Merge a feature branch onto the candidate; resolves ok:false (never throws) on conflict. */
  mergeBranch: (featureBranch: string) => Promise<{ ok: true } | { ok: false; reason: string }>;
  log?: (msg: string) => void;
}

export interface UatAssembleResult {
  branch: string;
  merged: string[];
  conflicts: Array<{ branch: string; reason: string }>;
}

export async function assembleUatCandidate(
  branchName: string,
  featureBranches: ReadonlyArray<string>,
  deps: UatAssembleDeps,
): Promise<UatAssembleResult> {
  const log = deps.log ?? (() => {});
  await deps.createCandidateBranch(branchName);

  const merged: string[] = [];
  const conflicts: Array<{ branch: string; reason: string }> = [];

  for (const fb of featureBranches) {
    try {
      const r = await deps.mergeBranch(fb);
      if (r.ok) {
        merged.push(fb);
        log(`[uat-assemble] merged ${fb} onto ${branchName}`);
      } else {
        conflicts.push({ branch: fb, reason: r.reason });
        log(`[uat-assemble] ${fb} conflicts onto ${branchName}: ${r.reason}`);
      }
    } catch (err) {
      conflicts.push({ branch: fb, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { branch: branchName, merged, conflicts };
}
