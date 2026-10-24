plan-digest: c68c5e7c262decda99115e040e38b669cbdbb6e2dd845c9d5a63d50ff69175c6

## blocks-the-design: Fallback can still lose the triggering failure

The PRD's FR-1 sends an unreadable or empty check-run result to the completed-workflow fallback. In `src/lib/cloister/ci-failure-feedback.ts`, lines 503-510, that fallback is `listFailingRuns`, which filters `gh run list --status failure` at lines 446-467. While the workflow is still in progress—the exact case in the PRD's root cause—that list is empty. Lines 699-708 then skip feedback for an ordinary `check_run` event. The webhook already has the failed check's name and ID at `src/lib/webhook-handlers.ts`, lines 243-250 and 272-282; for CI test checks, `PrFacts.testCheckFailures` already has names and links (`src/lib/cloister/pr-facts.ts`, lines 284-305). Keep the triggering check as a last-resort failure when the API lookup is unavailable or empty, and add a test with an in-progress workflow and a failed check-run read. The feedback should still name the triggering check and link it when possible.

## blocks-the-design: Name prefixes are not aggregate relationships

The PRD's work item 1 defines `withoutAggregateChecks` as dropping `X` whenever another failed check starts with `X-`, `X (` or `X / `. The implementation at `src/lib/cloister/ci-check-run-failures.ts`, lines 50-57, applies that rule to every check. Two independent failed checks named `test` and `test-e2e` therefore cause `test` to disappear, even if `test` has its own failure and does not aggregate `test-e2e`. The actual aggregate in this repository is explicit: `.github/workflows/ci.yml`, lines 274-288, gives `test` a `needs: [test-shard, test-e2e]` dependency. Suppress an aggregate only when its relationship to the child checks is established; otherwise retain both. Add an independent same-prefix pair to the test.

## blocks-the-design: Check-run lookup covers only the first page

FR-1 says to collect failures from the head's check runs, but `src/lib/cloister/ci-check-run-failures.ts`, lines 97-106, makes one request with `per_page=100` and ignores later pages. If the triggering failure is after the first 100 checks, the relay falls back to completed workflow runs; during an in-progress run that reproduces the original empty result. `gh api --help` confirms `--paginate` requests all pages. Read all check-run pages before deciding that none failed, and test a failure on page two.
