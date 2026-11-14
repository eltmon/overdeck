plan-digest: 1f4c711d3f3ab20689bb5efae509e73d1d87806ad4a7b542d8879824085eaa37

## blocks-the-design: Own actions reuse a stale membership PR snapshot

WI-8 enqueues a membership gather for the review door and `merge.completed`, but only invalidates the PR listing. The gather reads `deps.listOpenPullRequests` at `src/lib/pipeline-membership-gather.ts:585-597`; its default is the separately cached `listOpenPullRequestsSnapshot` (`:70-89`), which WI-4 extends to five minutes. `refreshMembershipSnapshotsForProjects` invalidates the membership-result cache (`src/dashboard/server/services/pipeline-membership.ts:195-212`), but does not invalidate that PR snapshot. On a repo without webhook delivery, a just-opened or merged PR can therefore be absent or remain open in the new membership result for five minutes, despite FR-7's immediate refresh. In WI-8, invalidate the repo's membership PR snapshot before enqueueing each own-action gather, and test it with a prepopulated snapshot on a repo without webhooks.

## blocks-the-design: Tracker trigger misses issues leaving the current view

WI-10 fingerprints `cleanIssues(issues)` in the `onIssuesChanged` callback (`src/dashboard/server/read-model.ts:671-675`). That callback receives `getIssues()` (`src/dashboard/server/services/issue-data-service.ts:782-793`), whose default current-cycle filter removes backlog and canceled issues (`:470-489`). WI-10 compares only identifiers present in the new array; an active issue moved to backlog or canceled disappears, so no changed identifier is enqueued and FR-5's state-change refresh waits for periodic convergence. Fingerprint the unfiltered tracker rows, or explicitly treat disappeared identifiers as changed and resolve their former projects. Add a transition-out test.

## blocks-the-design: The first live tracker change only seeds the trigger

WI-10 says the first `noteTrackerIssues` call seeds without enqueueing, and wires it only inside `onIssuesChanged` (`src/dashboard/server/read-model.ts:671-673`). The read model already obtains `currentIssues` before installing that callback (`:648-671`); `IssueDataService.start()` starts tracker polls in the background (`src/dashboard/server/services/issue-data-service.ts:288-309`). A state or label change in the first callback becomes the seed and gets no membership refresh until the 30-minute fallback. Seed from the pre-subscription snapshot, then diff every callback; test a change on the first live update.

## blocks-the-design: A pre-webhook read can overwrite fresh derived state

D-6 explicitly leaves callers of an invalidated in-flight cache entry holding the old promise. The cache settle handler completes that promise after deletion (`src/lib/concurrency.ts:63-76`). `IssueDataService.scheduleDerivedStateRefreshForIssues` starts `refreshDerivedStates` without serializing overlapping calls (`src/dashboard/server/services/issue-data-service.ts:956-968`), and each completion writes `derivedStatesCache[issueId]` unconditionally (`:971-1000`). A pre-webhook read can finish after the webhook-triggered read and replace fresh derived state with the pre-event result for up to the new five-minute TTL, violating NFR-2. Specify a per-project or per-issue generation check before publishing results, or serialize and rerun after invalidation. Test the old-read-finishes-last order.

## blocks-the-design: Relay health can stay true on a stale sample

WI-5's proposed `isWebhookRelayRunningInLastSample` checks only `metrics.accepted.services[].status === 'running'`. The sampler preserves the previous accepted metrics and marks only `freshness.status = 'stale'` when collection fails (`src/lib/system-health/sampler.ts:110-129`). Its initial measuring snapshot already includes a live-looking `smee-relay` row (`src/dashboard/server/services/system-health-service.ts:636-640`), and `getSnapshot()` starts collection on first read (`src/lib/system-health/sampler.ts:231-241`). Thus the proposed provider can say healthy before any accepted sample and can keep the five-minute polling tier after relay health becomes unknown, contrary to FR-9's no-sample fallback. Gate the row on a fresh, non-measuring assessment (with a sample-age limit if collection can hang), and test measuring and stale snapshots.

## sharpens-framing: Six-second spacing can fire eleven times in sixty seconds

FR-6 requires a leading fire, then a trailing fire every six seconds and also says at most ten fires in a minute. With events every 500 ms from t=0 through t=59.5 s, fires occur at t=0, 6, 12, ..., 60 s: eleven when a test advances timers by 60 seconds. WI-6 and its xBRIEF criterion demand at most ten. Define the limit as a half-open minute bucket and test before t=60, or make spacing strictly longer than six seconds if a rolling 60-second ceiling is required.
