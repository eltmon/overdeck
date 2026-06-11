import { Effect } from 'effect';

export interface TestStatusGreenCiReviewStatus {
  reviewStatus?: string | null;
  testStatus?: string | null;
  mergeStatus?: string | null;
  prUrl?: string | null;
}

export interface TestStatusGreenCiPullRequestState {
  state: 'OPEN' | 'CLOSED';
  merged: boolean;
  headSha: string;
}

export interface TestStatusGreenCiCheckRunSummary {
  name: string;
  htmlUrl?: string;
}

export interface TestStatusGreenCiCheckRunsState {
  verdict: 'green' | 'pending' | 'red';
  successCount: number;
  successfulRuns: TestStatusGreenCiCheckRunSummary[];
}

export interface TestStatusGreenCiDeps {
  isGitHubAppConfigured(): boolean;
  loadReviewStatuses(): Record<string, TestStatusGreenCiReviewStatus>;
  getPullRequestState(
    owner: string,
    repo: string,
    number: number,
  ): Effect.Effect<TestStatusGreenCiPullRequestState, unknown>;
  getCiCheckRunsState(
    owner: string,
    repo: string,
    sha: string,
  ): Effect.Effect<TestStatusGreenCiCheckRunsState, unknown>;
  setReviewStatusSync(issueId: string, update: { testStatus: 'passed'; testNotes: string }): void;
  cooldowns: Map<string, number>;
  cooldownMs: number;
  now(): number;
  log(message: string): void;
  warn(message: string): void;
}

const terminalMergeStatuses = new Set(['merged', 'merging', 'queued', 'verifying']);

export async function reconcileTestStatusFromGreenCiWithDeps(
  deps: TestStatusGreenCiDeps,
): Promise<string[]> {
  const actions: string[] = [];
  try {
    if (!deps.isGitHubAppConfigured()) return actions;

    const statuses = deps.loadReviewStatuses();
    const now = deps.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.reviewStatus !== 'passed') continue;
      if (status.testStatus !== 'pending') continue;
      if (terminalMergeStatuses.has(status.mergeStatus || '')) continue;
      if (!status.prUrl) continue;

      const cooledUntil = deps.cooldowns.get(issueId);
      if (cooledUntil && now < cooledUntil) continue;

      const match = status.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) continue;
      const [, owner, repo, numberStr] = match;
      const prNumber = parseInt(numberStr, 10);
      if (!Number.isFinite(prNumber)) continue;

      try {
        const prState = await Effect.runPromise(deps.getPullRequestState(owner, repo, prNumber));
        if (prState.state !== 'OPEN' || prState.merged || !prState.headSha) continue;

        const ciState = await Effect.runPromise(deps.getCiCheckRunsState(owner, repo, prState.headSha));
        if (ciState.verdict !== 'green') {
          deps.cooldowns.set(issueId, now + deps.cooldownMs);
          continue;
        }

        const firstRun = ciState.successfulRuns[0];
        const runLabel = firstRun?.htmlUrl
          ? `${firstRun.name} (${firstRun.htmlUrl})`
          : (firstRun?.name || `${ciState.successCount} successful CI check-run(s)`);
        const shortSha = prState.headSha.slice(0, 8);
        deps.setReviewStatusSync(issueId, {
          testStatus: 'passed',
          testNotes: `Reconciled from green GitHub Actions CI on ${shortSha}: ${runLabel}`,
        });
        deps.cooldowns.delete(issueId);
        const msg = `Reconciled testStatus=pending → passed for ${issueId} from green CI on PR #${prNumber} @ ${shortSha}`;
        actions.push(msg);
        deps.log(msg);
      } catch (prErr: any) {
        deps.cooldowns.set(issueId, now + deps.cooldownMs);
        deps.warn(`reconcileTestStatusFromGreenCi: ${issueId} PR/CI lookup failed: ${prErr.message}`);
      }
    }
  } catch (err: any) {
    deps.warn(`Error in reconcileTestStatusFromGreenCi: ${err.message}`);
  }
  return actions;
}
