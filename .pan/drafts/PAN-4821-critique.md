plan-digest: e9b4946e22dacc4768c78e1297fa91d8434795ccb738374cc84c0ca4fe48ea27

## sharpens-framing: Test both verdict rows through the default reader

The PRD's WI-3 says its new default-wiring test proves “rows 1 and 2 pass,” but the specified assertion calls only `checkReviewRow(id)` (.pan/drafts/PAN-4821.md, lines 368-374). Both rows use `defaultDeps` today (`src/lib/lifecycle/dod-gate.ts`, lines 268-270), so the implementation should also prove that `checkTestsRow(id)` uses the retrying reader and returns `pass` after a failed first read. Add that call and assertion to the WI-3 default-wiring test, resetting the mock response sequence between row calls.

## sharpens-framing: An absent response does not prove the forge answered

The proposed MERGE-WORKFLOW paragraph says `no pull request found` “now means only that the forge answered and no PR exists” (.pan/drafts/PAN-4821.md, lines 429-435). `resolveIssuePullRequestRef()` returns an error-free absent response without a forge call when `isGitHubIssue()` is false (`src/lib/overdeck/pull-requests.ts`, lines 201-205 and 249-254). `parseGitHubRepos()` also swallows a project-config read failure (`src/lib/tracker-utils.ts`, lines 61-75), so a transient configuration lookup failure can take that path. Change the doc to say the PR lookup returned an error-free absent response; don't claim the forge confirmed absence. This also matches the PRD glossary's explicit non-GitHub case (.pan/drafts/PAN-4821.md, lines 29-34).
