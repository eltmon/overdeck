/**
 * Is this issue's PR eligible to be auto-merged? (PAN-1691, re-pointed by PAN-3917.)
 *
 * Before the cut this gate started from a merge-ready flag on the `review_status`
 * row and then asked GitHub whether it agreed. The stored flag is gone; the gate
 * now computes the ready set directly — approved, checks green, forge
 * `mergeable` — through `pr-facts`, and then applies the two policy layers that
 * are genuinely Overdeck's own: the UAT hold and the blocker labels.
 *
 * The per-issue UAT hold moved onto the issue's own labels (`auto-merge` /
 * `hold-for-uat`), which is where an operator toggle can live without Overdeck
 * storing a copy of it.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { getProjectSync, resolveProjectFromIssueSync } from '../projects.js';
import type { TrackerType } from '../tracker/interface.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { getProjectAutoMergeDefault, projectAutoMergeDefault, shouldHoldForUat } from './auto-merge-policy.js';
import { evaluateMergeReadiness, getPrFacts, type PrFacts } from './pr-facts.js';

const execFileAsync = promisify(execFile);

export const BLOCKER_LABELS = ['needs-design', 'needs-discussion', 'do-not-merge'] as const;

/** Labels that carry the per-issue auto-merge decision. */
export const AUTO_MERGE_LABEL = 'auto-merge';
export const HOLD_FOR_UAT_LABEL = 'hold-for-uat';

export type AutoMergeEligibility = { eligible: true } | { eligible: false; reason: string };

export interface AutoMergeEligibilityDeps {
  getFacts?: (issueId: string) => Promise<PrFacts>;
  getIssueLabels?: (issueId: string) => Promise<string[]>;
  getProjectDefault?: typeof getProjectAutoMergeDefault;
  isGlobalUatRequired?: () => boolean;
}

/** The per-issue auto-merge decision as the tracker's labels express it. */
export function autoMergeFromLabels(labels: readonly string[]): boolean | undefined {
  if (labels.includes(AUTO_MERGE_LABEL)) return true;
  if (labels.includes(HOLD_FOR_UAT_LABEL)) return false;
  return undefined;
}

/**
 * The issue's labels from its own tracker (review of #4017). A project whose
 * tracker is not GitHub (Linear, GitLab, Rally) may still have a `github_repo`
 * for its code; reading `<github_repo>#<n>` there would read an unrelated
 * GitHub issue, so a non-GitHub tracker is asked through its tracker client,
 * and a GitHub lookup must resolve to the project's own `github_repo`.
 */
async function defaultGetIssueLabels(issueId: string): Promise<string[]> {
  const project = resolveProjectFromIssueSync(issueId);
  const config = project ? getProjectSync(project.projectKey) : null;
  if (config?.tracker && config.tracker !== 'github') return readTrackerIssueLabels(issueId, config.tracker);

  const resolved = resolveGitHubIssueSync(issueId);
  if (!resolved.isGitHub) return [];
  if (config?.github_repo && `${resolved.owner}/${resolved.repo}`.toLowerCase() !== config.github_repo.toLowerCase()) {
    return [];
  }

  const { stdout } = await execFileAsync('gh', [
    'issue',
    'view',
    String(resolved.number),
    '--repo',
    `${resolved.owner}/${resolved.repo}`,
    '--json',
    'labels',
    '--jq',
    '.labels[].name',
  ], { encoding: 'utf-8' });

  return stdout.trim().split('\n').filter(Boolean);
}

/** Labels read through the configured tracker client; [] when it is not configured. */
async function readTrackerIssueLabels(issueId: string, tracker: TrackerType): Promise<string[]> {
  const [{ loadConfigSync }, { createTrackerFromConfig }] = await Promise.all([
    import('../config.js'),
    import('../tracker/factory.js'),
  ]);
  const trackers = loadConfigSync().trackers;
  if (!trackers?.[tracker]) return [];
  const issue = await Effect.runPromise(createTrackerFromConfig(trackers, tracker).getIssue(issueId));
  return [...(issue.labels ?? [])];
}

async function defaultIsGlobalUatRequired(): Promise<boolean> {
  const { isFlywheelRequireUatBeforeMerge } = await import('../overdeck/control-settings.js');
  return isFlywheelRequireUatBeforeMerge();
}

/**
 * Review of #3993 (PAN-3965): whether this issue is held for UAT, all three
 * tiers — its `auto-merge` / `hold-for-uat` label, then the project default,
 * then the global flag — the same decision {@link isAutoMergeEligible} applies.
 * The merge-train reconciler asks it for a lone ready feature: one held by its
 * label still needs its UAT stack. A label read failure falls back to the
 * project and global tiers.
 */
export async function issueHoldsForUat(
  issueId: string,
  project: { auto_merge_default?: unknown } | null | undefined,
  globalRequireUat: boolean,
  deps: Pick<AutoMergeEligibilityDeps, 'getIssueLabels'> = {},
): Promise<boolean> {
  let labels: string[] = [];
  try {
    labels = await (deps.getIssueLabels ?? defaultGetIssueLabels)(issueId);
  } catch (err) {
    console.warn(
      `[auto-merge] Could not read labels for ${issueId}; using the project/global UAT hold: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return shouldHoldForUat(autoMergeFromLabels(labels), projectAutoMergeDefault(project), globalRequireUat);
}

export async function isAutoMergeEligible(
  issueId: string,
  deps: AutoMergeEligibilityDeps = {},
): Promise<AutoMergeEligibility> {
  const facts = await (deps.getFacts ?? getPrFacts)(issueId);
  const readiness = evaluateMergeReadiness(facts);
  if (!readiness.ready) {
    return { eligible: false, reason: readiness.reason ?? 'PR is not ready to merge' };
  }

  const labels = await (deps.getIssueLabels ?? defaultGetIssueLabels)(issueId);

  const blockerLabel = BLOCKER_LABELS.find((label) => labels.includes(label));
  if (blockerLabel) {
    return { eligible: false, reason: `issue carries blocker label: ${blockerLabel}` };
  }

  const globalRequireUat = deps.isGlobalUatRequired
    ? deps.isGlobalUatRequired()
    : await defaultIsGlobalUatRequired();
  const hold = shouldHoldForUat(
    autoMergeFromLabels(labels),
    (deps.getProjectDefault ?? getProjectAutoMergeDefault)(issueId),
    globalRequireUat,
  );
  if (hold) {
    return { eligible: false, reason: 'held for UAT (auto-merge toggled off)' };
  }

  return { eligible: true };
}
