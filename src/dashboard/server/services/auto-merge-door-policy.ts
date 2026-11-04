/**
 * The merge-train schedule door's forge-free policy check (PAN-3983,
 * extracted from routes/merge-train.ts in PAN-4970).
 *
 * Moved out of the route module so `merge-path-owner.ts` can read it without
 * creating an import cycle: `routes/merge-train.ts` reaches
 * `services/uat-train.ts` (for its payload/reconcile handlers), which reaches
 * `services/merge-path-owner.ts` (PAN-4970's mergesPerPr dep); a
 * policy check still living in the route module would close that loop no
 * matter which edge used `await import(...)` — madge's TypeScript detective
 * counts dynamic imports as edges too. This module depends on nothing in
 * that chain, so it is a safe leaf for both sides to import.
 *
 * `routes/merge-train.ts` re-exports `autoMergePolicyRefusal` so existing
 * importers (the auto-merge scheduler, its tests) keep resolving it from
 * there unchanged.
 */
import { getSharedIssueService } from './issue-service-singleton.js';
import {
  getProjectAutoMergeDefault,
  shouldHoldForUat,
  type ProjectAutoMergeDefault,
} from '../../../lib/cloister/auto-merge-policy.js';
import { autoMergeFromLabels } from '../../../lib/cloister/auto-merge-eligibility.js';
import { isFlywheelRequireUatBeforeMerge, isMergeTrainEnabled } from '../../../lib/overdeck/control-settings.js';

export interface AutoMergePolicyDeps {
  getProjectAutoMergeDefault?: (issueId: string) => ProjectAutoMergeDefault;
  /** The issue's tracker labels; defaults to the dashboard's cached tracker row. */
  getIssueLabels?: (issueId: string) => readonly string[];
  isRequireUatBeforeMerge?: () => boolean;
  isMergeTrainEnabled?: () => boolean;
  /** #3983: true when the cached tracker row says the issue is closed. */
  isIssueClosed?: (issueId: string) => boolean;
}

/**
 * PAN-3932: the issue's `auto-merge` / `hold-for-uat` labels from the cached
 * tracker row. The auto-merge policy map is polled across every in-flight
 * issue, so it reads the cache rather than asking the forge per issue.
 */
export function cachedIssueLabels(issueId: string): readonly string[] {
  try {
    return getSharedIssueService().getTrackerIssue(issueId)?.labels ?? [];
  } catch {
    return [];
  }
}

/**
 * #3983: whether the cached tracker row says the issue is closed. An issue the
 * cache does not know reads as open here; the executor reads the tracker live
 * before it merges.
 */
export function cachedIssueClosed(issueId: string): boolean {
  try {
    return getSharedIssueService().getTrackerIssue(issueId)?.open === false;
  } catch {
    return false;
  }
}

/**
 * The schedule door's policy check, which reads no forge: the issue's UAT hold
 * (its `auto-merge` / `hold-for-uat` label (PAN-3932), then the project
 * default, then global), the merge-train switch, and a closed tracker issue
 * (from the cached tracker row). The scheduler (#3983) asks it first, so a held
 * PR costs no forge read per tick.
 */
export function autoMergePolicyRefusal(
  issueId: string,
  deps: AutoMergePolicyDeps = {},
): { status: 412 | 422; body: { error: string } } | null {
  if ((deps.isIssueClosed ?? cachedIssueClosed)(issueId)) {
    return { status: 422, body: { error: `${issueId} is closed in the tracker` } };
  }
  const labels = (deps.getIssueLabels ?? cachedIssueLabels)(issueId);
  const projectDefault = (deps.getProjectAutoMergeDefault ?? getProjectAutoMergeDefault)(issueId);
  const globalRequireUat = (deps.isRequireUatBeforeMerge ?? isFlywheelRequireUatBeforeMerge)();
  if (shouldHoldForUat(autoMergeFromLabels(labels), projectDefault, globalRequireUat)) {
    return { status: 412, body: { error: 'UAT is still required before merge' } };
  }
  if (!(deps.isMergeTrainEnabled ?? isMergeTrainEnabled)()) {
    return { status: 412, body: { error: 'Merge train is disabled' } };
  }
  return null;
}
