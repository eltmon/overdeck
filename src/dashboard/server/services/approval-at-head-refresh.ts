/**
 * Keep the merge gate's approval answer fresh for every PR the board shows
 * as approved, green and mergeable (PAN-4597).
 *
 * The board derives `ready` only from the gate's cached answer for the PR's
 * head (`cachedApprovalAtHead`, #4066), and that answer lives
 * `GATE_ANSWER_TTL_MS`. Before this pass, only auto-merge opted-in issues,
 * merge doors and the post-merge sibling walk ran the gate, so a PR held for
 * UAT showed on Awaiting Merge (and offered the issue view's Merge to main) for
 * five minutes after some other merge, then decayed to `in-review`.
 *
 * Each pass runs on the UAT-train reconciler tick, off the request path. For
 * every open, non-draft PR whose forge state is approved, green and mergeable,
 * it asks the gate again once the answer is missing, for another head, or
 * older than `GATE_ANSWER_REFRESH_AFTER_MS`. The gate records its answer and
 * the read model's `onApprovalAtHeadChanged` listener re-derives the issue.
 * The forge's review decision only picks the candidates; the gate's head-bound
 * rule (#3983) still decides `ready`. One attempt per issue head per refresh
 * window, so a PR whose read fails is not re-asked every tick.
 */
import { resolve } from 'node:path';
import type { LoadedPr } from './derived-issue-state.js';

export interface ApprovalAtHeadRefreshDeps {
  listProjectPaths?: () => string[];
  listOpenPullRequests?: (projectPath: string) => Promise<ReadonlyArray<{ readonly issueId: string; readonly pr: LoadedPr }>>;
  needsRefresh?: (issueId: string, headSha: string | null | undefined) => boolean;
  /** The one merge gate; it records the answer the board reads. */
  evaluateGate?: (issueId: string) => Promise<unknown>;
  now?: () => number;
  log?: (message: string) => void;
}

const lastAttempt = new Map<string, { readonly head: string; readonly at: number }>();

/** Forget the per-head attempt record. Exported for tests. */
export function resetApprovalAtHeadRefresh(): void {
  lastAttempt.clear();
}

function isCandidate(pr: LoadedPr): pr is LoadedPr & { headSha: string } {
  return pr.reviewState === 'approved' && pr.checks === 'green' && pr.mergeable === true && !!pr.headSha;
}

/** One pass over every project. Returns the issues whose gate it re-ran. */
export async function runApprovalAtHeadRefreshTick(deps: ApprovalAtHeadRefreshDeps = {}): Promise<string[]> {
  const { GATE_ANSWER_REFRESH_AFTER_MS, approvalAtHeadNeedsRefresh } = await import('../../../lib/cloister/approval-at-head.js');
  const projectPaths = deps.listProjectPaths
    ? deps.listProjectPaths()
    : (await import('../../../lib/projects.js')).listProjectsSync().map(({ config }) => resolve(config.path));
  const listOpen = deps.listOpenPullRequests ?? (await import('./derived-issue-state.js')).listOpenPullRequestsForProject;
  const needsRefresh = deps.needsRefresh ?? approvalAtHeadNeedsRefresh;
  const evaluateGate = deps.evaluateGate
    ?? (async (issueId: string) => (await import('../../../lib/cloister/merge-gate.js')).evaluateIssueMergeGate(issueId));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => console.warn(message));

  const refreshed: string[] = [];
  for (const projectPath of projectPaths) {
    let open: ReadonlyArray<{ readonly issueId: string; readonly pr: LoadedPr }>;
    try {
      open = await listOpen(projectPath);
    } catch (err) {
      log(`[approval-refresh] PR listing for ${projectPath} failed: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    for (const { issueId, pr } of open) {
      if (!isCandidate(pr) || !needsRefresh(issueId, pr.headSha)) continue;
      const key = issueId.toUpperCase();
      const head = pr.headSha.toLowerCase();
      const previous = lastAttempt.get(key);
      if (previous && previous.head === head && now() - previous.at < GATE_ANSWER_REFRESH_AFTER_MS) continue;
      lastAttempt.set(key, { head, at: now() });
      try {
        await evaluateGate(key);
        refreshed.push(key);
      } catch (err) {
        log(`[approval-refresh] merge gate for ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return refreshed;
}
