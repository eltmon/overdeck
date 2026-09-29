# Pipeline Gates: Verification, Verdict Routing, Convergence, Auto-Resume

## Verification Gate (PAN-174)

`pan done` runs quality gates (typecheck, lint, test) from `projects.yaml`
before opening or updating the PR and requesting review. If a gate fails,
feedback goes to the agent's session and the command refuses to proceed, so
the agent can fix and retry. There is no separate stuck counter stored on a
record — a run that keeps failing is visible directly in the PR's check
history.

### One full-suite run per push, on CI (PAN-3965)

For a project with CI, the verification gate runs **typecheck and lint only**
on the host (plus any other non-`test` gate the project declares, and the
local test-skip diff check below). The quality gate named `test` is not run;
the **CI test job on the PR head is the test gate**:

- Merge readiness requires the CI test job to have **passed on the PR head**,
  not just every present check to be green (#4021, see
  [The merge gate](#the-merge-gate-4016-4021-4036)): at least one check the
  test matcher recognizes (the `test` aggregate, `test-shard (N/4)`,
  `test-e2e`, …) must have concluded `SUCCESS`. No test check, or a test job
  that only `SKIPPED` (a path filter, a job-level `if:`, a renamed or deleted
  job), blocks the merge. `PrFacts.testChecks` is the verdict over just the
  test job; `PrFacts.testJobSucceeded` is the positive evidence.
- A red CI test job reaches the work agent through
  `src/lib/cloister/ci-failure-feedback.ts` (fired by the `check_run`,
  `check_suite` and `status` webhooks). For a CI-mode project the relay reads
  the PR's checks, and when the test job is red on the head the webhook
  reported, it records the failure once per head as a per-run verification
  artifact (`via: 'ci'`), appends
  `verification.failed { failedCheck: 'test', cycleCount, via: 'ci' }` to the
  pipeline journal, and delivers `VERIFICATION FAILED … Failed check: test`
  through the same feedback door as the local gate
  (`cloister/verification-escalation.ts`: rework owed, slot resolution,
  resurrection, needs-you when nothing is reachable).
- **Attempt budget.** A CI test failure counts against the local gate's budget
  (`VERIFICATION_MAX_CYCLES` = 3, `cloister/verification-cycles.ts`), read
  from the same per-run artifacts. The local count is per head — every commit
  resets it — and CI runs once per head, so CI failures are also counted
  across heads: `readCiTestFailureStreak` counts consecutive heads whose CI
  test job failed, back to the last head whose test job passed. The attempt
  number is the larger of the two. The stuck pause
  (`escalateVerificationStuck`) fires on the third consecutive red head, or
  by the local rule on the per-head count (a second failure of the same check
  at one head). The stuck notice itself never lifts that pause (#4019): while
  the whole-issue agent holds it, the verification feedback door (local gate
  and CI test gate) skips the resurrection ladder, a still-live pane gets the
  notice queued to its mail (a paused agent is never resumed to receive a
  message), and a needs-you says the agent is waiting for the operator. The
  ladder re-reads the pause when it reaches the agent, so a stuck pause that
  the other gate set while this delivery was resolving its target is kept too.
  Further verification failures keep holding it. Exactly four things lift
  the stuck pause: a local verification pass, a CI test-gate pass on the PR
  head (`recordCiTestGatePass`; both through `liftVerificationStuckPause`),
  `pan unpause`, and an operator start that clears the start gates
  (`pan start --force`). Review and UAT feedback still go through the
  resurrection ladder, which lifts any `needs-you:` pause (PAN-2461), this
  one included. A green CI test job (`check_run` success for the test job,
  confirmed against the PR checks) records a passed CI artifact — the reset.
  What is not counted (review of #3993): a red test job on a `strike/` or
  `bypass/` PR (it is not the work agent's branch; the relay falls back to the
  plain CI FAILED message, which reaches only a live work agent); a test job
  whose failing checks all ended `CANCELLED`, `TIMED_OUT`, `STARTUP_FAILURE`,
  `STALE` or `ACTION_REQUIRED` (only `FAILURE`/`ERROR` are verdicts on the
  code); a test job whose failing checks are all failing on the default
  branch too (inherited from a red `main`); and a failure while the default
  branch's test verdict is unknown. The default branch's verdict is its newest
  commit (of the last 10) whose test checks all finished decisively: main's CI
  is often still running on HEAD, and a cancelled run says nothing
  (`cloister/ci-default-branch-tests.ts`). When no such commit exists, or the
  forge cannot be read, the failure is not counted; the plain CI FAILED
  message still reaches a live work agent. Relays for one issue
  run one at a time, so concurrent webhooks for one red head (the shards of a
  matrix, the aggregate job, `check_suite`) count it once. A report for a head
  already recorded (a duplicate webhook, a replay after a restart) is never
  re-delivered: the per-run record is the idempotency key, so a replay cannot
  re-open rework past the budget or lift a stuck pause. The record is written
  only once the feedback file exists (review of #4017): if that write fails,
  the head stays unrecorded (the next report retries it) and a needs-you row
  says so; a delivery door that throws after the record also surfaces
  needs-you. CI results are per-run
  records only; `verification-latest.json` stays the local gate run's record.
  Re-requesting review on a head whose CI test job is already red fails the
  `test` gate again instead of passing on typecheck+lint alone.
- The verification artifact lists only the gates that ran on the host and
  names the handed-off gate in `deferredToCi: ["test"]`. The `overdeck/test`
  status still posts (branch protection requires the context) with the
  description "typecheck+lint; tests run on CI".

`projects.yaml` chooses per project:

```yaml
verification:
  tests: ci      # or: local
```

Unset, the mode is `ci` only when the project has a `github_repo` and a
GitHub Actions workflow (in the project root or a polyrepo member) that runs on
`pull_request`/`pull_request_target` (or on `push` for feature branches) and
defines a job whose check name the test matcher recognizes (`test`, `tests`,
`test-*`, `test (…)`, or a reusable workflow's `test / <inner job>`: its
`name:`, else its id). A `pull_request` `branches`/`branches-ignore` filter is
read against the project's PR base branch (`pr_target`, else
`default_branch`, else `main`), and a job whose `if:` plainly cannot run on a
PR (it tests `github.event_name` without `pull_request`, or pins `github.ref`)
is skipped. `paths` filters, other `if:` expressions and the inside of a
reusable workflow are not evaluated. Otherwise the mode is `local`:
release-only, docs, schedule or dispatch workflows, or a test job named
something the matcher misses, would otherwise drop the local test gate for a
CI job that never runs. `local` keeps the `test` gate on the host exactly as
before. The runner logs the mode with its reason and records both in the
artifact's `testsMode` field. The CI-failure relay is GitHub-webhook-driven, so a GitLab
project that sets `tests: ci` gets the merge gate (a green pipeline) but no
automatic agent feedback for a red test job. GitLab reports one pipeline
verdict, not per-job checks, so there the green pipeline is the whole test
requirement.

Work agents run only the tests they touched (the work prompt names
`npx vitest run <files>` only in a vitest project, and says "the suite runs on
CI" only in a CI-mode project); reviewers never run the suite — they read the
CI result on the head (`gh pr checks <pr>`) where tests run on CI.

## Verification artifacts (FR-8)

Each verification run writes an immutable artifact named by run time and
workspace head: `<workspace>/.overdeck/verification/<ranAt>-<head8>.json`.
The runner also copies it to `.overdeck/verification-latest.json`, the
dashboard's read path, and reports the same result as a GitHub check run
where the App is installed. Failure feedback references the per-run file,
so the evidence a later run cannot overwrite is what the agent reads.
Per-run files older than 30 days are pruned by host-hygiene's scheduled
sweep. No `verificationStatus` field is written anywhere — the artifact and
the check run are the whole answer.

## Test-skip gate (PAN-3847, PAN-3906)

Before the quality gates run, the verification runner diffs the workspace
against `origin/<target>` and fails a required `test-skip` gate on two
independent rules.

**Added `.skip`/`.only`/`xit`/`xdescribe`/`xtest` in a test file** is always a
violation, one per line. Disabling a test is never balanced by writing another
one, and it is never waivable. `allowOnly: false` in both vitest configs makes
`.only` fail every gate run outright.

**Removed `it(`/`test(` calls are balanced across the whole diff**, not per
file (PAN-3906). The gate sums removed and added test calls over every test
file in the diff and fails only when the total removed exceeds the total
added. Per-file lines are still emitted as gate evidence, marked
`(evidence only — not a gate failure)` when the total absorbs them.

Two escapes exist for a genuine net removal:

- **Deleted-subject exemption (structural).** A test file deleted whole
  (`deleted file mode` in the diff) whose subject module is deleted in the
  same diff is not a violation, and its counts stay out of the whole-diff
  total. The subject is resolved by stripping a `__tests__/` segment and the
  `.test`/`.spec` infix, then matching `.ts`/`.tsx`/`.js`/`.jsx` among the
  diff's deleted files.
- **Operator waiver (judgment).** `pan verify waive-test-removal <id> --reason "…"`
  records the waiver (sha, reason, timestamp, operator) as a workspace
  verification artifact, not a pipeline record. The gate demotes
  `removed-test` to evidence only when the waiver's anchored sha equals the
  head under verification, and prints the waiver as gate evidence. It
  expires the moment the branch head moves, it never waives an added
  `.skip`/`.only`, and it is operator-conversation-only — a pipeline agent
  cannot waive the coverage loss it just produced.

The test-skip gate stays local in both modes: it is a diff check, not a test
run. CI runs vitest on every push; the `overdeck/test` commit status records
only that the verification gate passed for the tested sha (changed-file scope
in `local` mode, typecheck+lint in `ci` mode).

## Plan-integrity gate (PAN-1728)

The canonical spec (`.pan/specs/<date>-<ISSUE>-<slug>.xbrief.json`) is
immutable after planning. A work agent records item and AC completion in the
continue file through `pan task done`, never in the spec. The required
`plan-integrity` check enforces this. It runs after test-skip passes and before
the quality gates. When it fails, the quality gates do not run, the gate
results are one `plan-integrity` row, and the runner emits
`verification.failed { failedCheck: 'plan-integrity' }`.

**What it compares.** The gate reads the issue's spec files at HEAD and at a
reference commit, then diffs them with `diffPlanDocuments`
(`src/lib/cloister/plan-integrity-gate.ts`). Five fields are ignored, because
lifecycle writers change them after planning: top-level `status`,
`plan.status`, `plan.updated`, `plan.sequence`, and `xBRIEFInfo.updated`. Every
other change is a violation: one per added, removed, or changed item id
(nested acceptance criteria included), one per changed non-item path such as
`plan.narratives` or `plan.edges`, and one per added, removed, or renamed spec
file for the issue. Key order does not count, and a legacy `vBRIEFInfo`
envelope equals the same `xBRIEFInfo` content.

**The `Plan-Finalized` trailer.** Planning finalize
(`commitCompletePlanningWorkspaceGit`) writes `Plan-Finalized: <sha256>` on the
commit that holds the finalized spec. The value is the SHA-256 of the spec
file's exact bytes (`src/lib/xbrief/plan-finalized.ts`). For a polyrepo project
with `pan_records.repo`, the spec lives in that nested sub-repo: the wrapper
commit stays as before, and a second commit in the spec repo carries the
trailer. The gate runs in `resolvePlanHome(workspacePath)`.

**Reference chain.** `resolvePlanReference`
(`src/lib/cloister/plan-integrity-run.ts`) looks at commits in
`mergeBase..HEAD` of the plan home, newest first, and takes the first match:

1. **`trailer`** — a commit whose `Plan-Finalized` value equals the SHA-256 of
   one of the issue's spec blobs at that commit. A trailer that does not match
   is ignored and recorded as `hash mismatch` evidence. A later valid trailer
   (re-planning) becomes the new reference.
2. **`legacy-finalize`** — a `chore(plan): complete planning for <ISSUE>`
   commit that touches the issue's spec, written before the trailer existed.
3. **`merge-base`** — the spec as it exists at the merge base with
   `origin/<target>`.
4. **`first-add`** — the first branch commit that added a spec for the issue,
   which covers `pan start --auto` specs that never get a finalize commit.

Nothing is stored: the reference is derived from git on every run.

**Threat model.** The gate catches misguided edits, such as the PAN-1700 commit
`chore: mark … acceptance criteria complete`. It does not stop deliberate
forgery, because an agent can compute a hash and write the trailer itself. The
work role forbids both editing `.pan/specs/` and writing the trailer.

**Pass with evidence.** The gate passes, and says why, when the plan home is not
the root of a git work tree, when no spec exists for the issue, or when the
HEAD spec has merge-conflict markers. The `vbrief-conflicts` check owns
conflict markers and its resolution instructions still fire.

**Fail closed.** A git command that fails inside a valid plan-home work tree
fails the gate with the git diagnostic, as does a plan home that cannot be
resolved (for example, a `pan_records.repo` missing from `workspace.repos`).
This mirrors test-skip (PR #3872 finding 4).

**Remediation.** The generic failure feedback says to fix the code, so the gate
evidence ends with the exact fix:

```bash
git restore --source=<reference sha> --staged --worktree -- <spec path(s)>
```

Then commit, and record completion with `pan task done`. The same command also
removes an added spec file. If the plan itself is wrong, stop and ask for
re-planning (`pan plan <ISSUE>`). Never use `git checkout` in a workspace.

## Verdict feedback routing

A review `request changes` or a failing test/UAT run returns work to the work
agent as PR review comments and/or a `pan tell` nudge. Delivery is confirmed
against the agent's transcript; an unconfirmed delivery surfaces a
needs-you escalation instead of reporting success (PAN-3846). The PR thread
and the transcript are the evidence of what the agent was told; the pipeline
journal records only that a delivery happened (#4035).

Review and UAT feedback are relayed from `pan admin specialists done`, a
fresh CLI process per verdict, so "already delivered" cannot live in process
memory: Herdr, which prompts the agent directly, remembers message ids only
for its own process. After a fresh delivery the relay appends
`feedback.delivered { kind, dedupKey, agentId }` to the pipeline journal,
and a later relay with the same key skips target resolution and delivery on
every backend (`cloister/feedback-delivery-record.ts`). The key names the
verdict episode: the review run id, or the head plus the count of passing
verdicts of that kind journaled so far (`review.verdict APPROVED`,
`uat.verdict passed`). Two failures on one head with no pass between share a
key and deliver once; fail, pass, fail on one head delivers twice, and the
keyed tmux/PTY-supervisor stores see the new key too. With no pass
journaled the key is the pre-#4035 key. A delivery that did not land is not
journaled, so the next verdict run retries it. A repeated verdict is skipped
before its target is resolved, so it no longer revives a stopped agent; the
feedback file written for the verdict stays in the workspace as the durable
record the agent reads on its next start. Both `pan admin specialists done`
and the dashboard verdict route (`POST /api/specialists/done`) journal the
verdicts they record. Each skip is journaled as `feedback.skipped`; the
review relay's repeated-delivery detector counts those since the key's last
delivery and surfaces a needs-you on the second skip, across processes
(without a workspace it falls back to an in-process count). A journal line
torn by a crash is closed off before the next append, so it cannot swallow
the entry after it.

**Recording retries transient forge failures (PAN-4263).** `pan admin
specialists done` finds the PR through `discoverArtifact` (`lib/forge.ts`),
which retries a rate-limit, network or 502/503/504 failure twice, after 2 s
and 8 s (`lib/forge-transient.ts`). A lookup that still fails is reported as
`Couldn't reach <forge> to find the review artifact for <branch>: <reason>`,
never as "No open review artifact": only gh's own "no pull requests found"
answer (or an empty `glab mr list`) means there is no PR, and a closed PR on
the branch reads as none. The command checks the caller's identity before it
calls the forge. A review verdict whose lookup or post still fails for a
transient reason is journaled as `review.verdict-deferred` (status, run id,
notes capped at 100 000 bytes, the caller's agent id or `null` for an
operator, and the reason), and the command exits 1. deacon-lite's
`recoverStalledReviews` replays it while that entry is the journal's last,
once it is at least 10 minutes old, by running
`pan admin specialists done review` again under the original caller, so every
guard runs again (`cloister/deferred-verdict-replay.ts`). Another transient
failure journals a fresh deferral, which is the next cooldown. The replay
stops with `review.verdict-replay-gave-up`: `superseded` when the review
parent's run id has moved on, `cap` after 7 deferrals of one run (about an
hour, with an activity warning for the operator), `failed` when the replay
failed for another reason. Test and UAT verdicts are not deferred; they get
the same honest error and exit 1.

A failed browser UAT is observed where the test agent records it:
`pan admin specialists done test <id> --uat-status failed` (or the `uat`
role). After posting the verdict comment, that command relays the UAT notes
through `relayUatFailureFeedback` (`cloister/uat-failure-feedback.ts`)
to the work agent, or to a needs-you when no agent can be reached. Delivery
is keyed on the tested commit (`--tested-sha`, else the PR head) within the
current UAT pass episode, as above; the command journals every UAT verdict
as `uat.verdict`, and a passing one starts the next episode (PAN-4030,
#4035). A repeated failure under an already-delivered key is normally caught
before a feedback file is written, and is journaled as `feedback.skipped`; the second skip of one
key surfaces a single needs-you ("UAT is not converging") instead of
relaying again, so identical failures on one head reach the agent once and
the operator once (PAN-3580). The key does not hash the UAT notes: they are
free text that varies run to run, and a notes-keyed delivery would re-tell
the agent on every re-run of an unchanged head.

The UAT verdict comment ends with a machine marker carrying the outcome and
the commit UAT exercised, `<!-- overdeck-uat: failed sha=<commit> -->` (the
`--tested-sha`, else the PR head when the verdict was posted). Merge
readiness reads it back from the PR; see the next section.

## The merge gate (#4016, #4021, #4036)

One function decides whether an issue's PR may merge:
`evaluateIssueMergeGate` (`cloister/merge-gate.ts`) reads the PR facts from
the forge (`cloister/pr-facts.ts`) and judges them with
`evaluateMergeReadiness`. Every merge door asks it: the merge-ready set
(`getMergeReadyIssues`, which feeds the Flywheel merge order and the merge
train), the dashboard Merge button, the auto-merge executor and the merge
train's merge-next (all through `triggerMerge`), the per-project merge
queue, and the auto-merge scheduler (#3983,
`dashboard/server/services/auto-merge-scheduler.ts`), which asks it before it
schedules a ready, opted-in PR on the merge-train reconciler tick.
Auto-merge eligibility applies the same rule. Nothing is stored; each input is
read when the question is asked. The PR is merge-ready when, in order:

1. it exists, is open, is not a draft, has no changes requested, and is
   **approved on its exact head commit** (#3983, `approvalProvenAtHead` in
   `cloister/approval-at-head.ts`): a trusted `overdeck-verdict: APPROVED`
   marker whose `sha=` is the PR head (`approvedAtHead`), or a trusted
   reviewer's standing GitHub review whose `commit.oid` is the PR head
   (`forgeApprovalAtHead`, read only when no marker already proves it). A
   review counts only from an author the marker rule trusts (below), and each
   author's latest review stands: a later `CHANGES_REQUESTED` or a dismissal
   withdraws that author's approval, and any trusted author's standing
   `CHANGES_REQUESTED` leaves the head unapproved. `reviewDecision` alone
   never counts, and neither does a marker without `sha=` or one naming
   another commit. This holds for every door, the Merge button included. A
   GitLab MR is approved only when `/merge_requests/:iid/approvals` names an
   approver in `approved_by` (what `glab mr approve` records); a `mergeable`
   merge status, or GitLab's own `approved` with zero approvals required, is
   not an approval. GitLab ties no approval to a commit, so a push after the
   approval is caught only by GitLab's own approval-reset setting;
2. its checks on the head are all green (`none` and `pending` are not green;
   a GitLab pipeline that `skipped` is green, as the board reads it);
3. **the CI test job passed on the head** when the project runs
   `verification.tests: ci` (resolved from `projects.yaml` or detected, as
   above, and cached per project until `projects.yaml` or a workflow file
   changes). GitHub only: a GitLab pipeline is judged by its one verdict;
4. **no required UAT failed at the head**;
5. the forge reports it `mergeable`.

A refusal names the first failing condition, e.g. `Cannot merge: browser UAT
failed on PR HEAD <sha>`. `triggerMerge` takes readiness from this gate alone;
the derived issue state refuses only an issue already merged or a merge
already running (#3983). A forge read that fails is itself the refusal, e.g.
`Cannot merge: GitLab MR view failed for !77: …`.

**Bound to the PR it judged (#4066 review).** `triggerMerge` asks the gate for
the branch it lands (`feature/<issue>` for a normal merge, `strike/<issue>` for
a strike), which also reads the head fresh instead of from the 60 s facts
cache, and refuses when the PR it would merge (the merge set's remembered URL
or the one `ensurePRExists` finds) is not the PR the gate passed. An automatic
merge (the executor's, carrying the scheduled head) merges only that head: see
[auto-merge](../configuration/auto-merge.mdx) for the direct and rebase paths.
It never joins the project merge queue; when another merge holds the slot it is
deferred and the executor re-runs every check on its next try.

**A manual merge is pinned too (#4066 review).** The Merge button, merge-next
and the project queue merge the head the gate passed (`mergeHeadPin`, sent as
`gh pr merge --match-head-commit`, the App merge's `sha` or `glab mr merge
--sha`). When the merge lands the PR as it is (a clean PR, or a branch already
up to date with its base), a live head that differs from the gated head is
refused first (`Cannot merge: the PR head moved to …`); click Merge again to
gate the new head. When the merge makes its own head (its rebase, or the
`.planning/` strip), it is pinned to that commit. Either way a push that lands
after that point fails the merge. A strike landing is not pinned.

**The Merge button (#4066 review).** The board's derived `ready` applies the
gate's approval rule, not the forge's `reviewDecision`. Every gate evaluation
records its approval answer per issue and head (`recordApprovalAtHead`); the
auto-merge scheduler evaluates every opted-in candidate each tick, and a
PR-facts read whose trusted marker names the head also counts. The batch loader
reads that answer for the head in the PR listing (`headRefOid`); a miss or an
answer for another head derives `in-review`, never `ready`. A changed answer
re-derives the issue and reaches the board as `issue_state.changed`. No forge
read is added and the frontend does not poll. A PR held for UAT is not gated by
the scheduler, so its button appears once some gate evaluation or marker read
has proven it; the Merge endpoint itself always asks the gate. Conditions 3 and
4 still surface as the refusal when the button is clicked. The UAT train's
candidate set (`listReadyIssuesForProject`) keeps the forge's own decision: it
is mostly held issues the scheduler never gates. Promoting a UAT batch lands
each member only when its derived state is `ready`, so the promote click runs
the gate for every member first, recording a fresh answer for its head.

**Trusted verdict comments.** The repository is public and anyone can comment
on a PR, so a verdict marker counts only when its comment's author is `OWNER`,
`MEMBER` or `COLLABORATOR` (GitHub's `authorAssociation`), or is the identity
Overdeck posts verdicts as: the authenticated `gh` user or the GitHub App bot,
resolved once per process and only when some marker needs it. Every other
author's marker is ignored, whether it approves, requests changes, passes UAT
or fails it.

**Overdeck's identities are matched as accounts, not logins (#4066 review,
R3-2).** The App's bot is `<slug>[bot]`, with the slug read from the App
itself: the `app-slug` file its setup writes to `~/.overdeck/github-app/`,
else `GET /app` under the App's JWT (`resolveAppBotLogin`). Nothing hard-codes
it. On this deployment it is `overdeck-agent[bot]`, and the review agent's
verdicts are that bot's reviews, which GitHub reports as `CONTRIBUTOR`, so
they count only through this identity rule. `gh pr view` reports only a
login, and strips a bot's `[bot]` suffix, so the author's account type is read
from GitHub's GraphQL API by the comment's or review's node id, for the
authors that are not trusted by association. A bot entry matches only an
author typed `Bot` with the App's slug, and the `gh` user only an author typed
`User`, so a User account named after the slug is nobody. An author whose type
cannot be read matches nothing. With the App configured and its slug
unreadable, no bot is trusted and no marker approves; the next read tries
again. This applies to the `overdeck-verdict` review marker as well as the
UAT marker. A marker must stand on its own line (the review marker as the
comment's first line); a quote-reply (`> <!-- … -->`) or a marker inside prose
declares nothing.

**Who may approve by marker** (#4066 review). Agents run with the operator's
`gh` credentials, which GitHub reports as `OWNER`, so any agent can post an
`overdeck-verdict: APPROVED sha=<head>` comment. When the GitHub App is
configured, an `APPROVED` review marker therefore counts only when the App's
bot posted it (a `Bot`-typed author with the App's slug, above); a marker
from any other author, the owner included, is skipped as if it were not
there. The review agent's verdict is normally a real review under the App's
token, so this costs the normal path nothing; the one approval it loses is a
verdict that fell back to a marker because the App token failed, which then
needs a fresh review. A `CHANGES_REQUESTED` marker still counts from every
trusted author: it can only hold a merge back. Without the App, any trusted
author's `APPROVED` marker counts, which is trust in the operator's
credentials; the server logs that once per process.

**Failed UAT.** The newest trusted UAT marker that applies to the current
head decides. A marker applies when its commit is the head (an abbreviated SHA
matches); a marker posted without a commit (the PR head was unreadable) applies
when it is at least as new as the head commit. A UAT verdict comment posted
before the marker existed carries no marker and reads as no verdict: it
neither blocks nor clears anything. So:

- a failed UAT at the current head blocks the merge;
- a later passing UAT at that head, or at a newer head, restores readiness;
- a push after a failure also lifts the block: the failure was recorded
  against a commit that is no longer the head. That is deliberate. The UAT
  stack is assembled from ready features, so a failure that outlived its
  head would keep a fix from ever reaching UAT again. When UAT is required,
  the untested new head is still held from auto-merge by the UAT hold below.

**Which UAT is "required".** The same three tiers auto-merge eligibility uses
(`issueHoldsForUat` in `cloister/auto-merge-eligibility.ts`): the issue's
`hold-for-uat` label (required) or `auto-merge` label (not required), else
the project's `auto_merge_default` (`hold` requires it), else the global
`flywheel.require_uat_before_merge` (on by default). An `auto-merge` label is
the operator saying UAT is not required for this issue, so a failed verdict
there is advisory and does not block. The tiers are read only when a failed
verdict applies to the head, so the common case costs no tracker read. The
gate reads the labels strictly: if they cannot be read, the failure blocks,
rather than falling back to the project and global tiers as auto-merge's
lenient read does. GitLab MR notes are not read, so a GitLab MR's UAT verdict
does not reach this gate.

**Freshness.** The gate reads PR comments through `fetchIssuePullRequest`,
whose PR-tab cache a PR webhook invalidates at once and which otherwise
expires after 60 seconds, like the pr-facts cache on top of it. A verdict
posted from a CLI process therefore reaches a dashboard server's gate within
about two minutes even with no webhook.

**Which PR merges (PAN-4263).** The branch lookup ranks the head branch's PRs
open (most recently updated) above merged above closed
(`selectPullRequestForHead` in `lib/github-pr-selection.ts`), so an older open
PR wins over a newer closed one. The merge then lands the PR `ensurePRExists`
resolves (open first); a stale stored merge-set `artifact_url` is overwritten
and never merged (`routes/workspaces/merge-artifact.ts`).

**Strike branches.** The merge queue used to turn a queued entry into a
strike landing whenever `origin/strike/<issue>` existed, and skip the gate
for it, so a strike branch could merge without approval or green checks. Only
a normal Merge enqueues, and since PAN-3973 a strike opens its own PR that the
operator merges, so the queue no longer looks for strike branches: every entry
passes the gate above and merges its feature PR. `triggerMerge` still accepts a
strike request (nothing sends one now); it passes the same gate against the
`strike/<issue>` PR, read with that branch probed first so an open feature PR
cannot stand in for it, and refuses when the PR the forge reports is on any
other branch.

## Review Convergence Gate (PAN-3151)

When a review round comes back with blocking findings, the finding count is
tracked across rounds from the round artifacts on disk. When ≥3 rounds are
recorded and the series shows a reversal (latest count > previous) or a
stall (two consecutive non-decreases), automatic rework re-drive is
suppressed — feedback is still written and posted, but the work agent is not
re-messaged automatically — and a needs-you escalation surfaces with the
round history and guidance to decompose the change into sibling issues.
This mechanical gate is separate from reviewer judgment: `roles/review.md`
requires checking prior fixes first and explaining newly discovered
blockers. It never suppresses a confirmed blocker solely because a previous
round missed it.

## The override door is the operator's (#3853)

`pan admin specialists done review` is both the review agent's verdict and
the operator's override, so the command checks who is calling. The caller is
read from `OVERDECK_AGENT_ID`, which every managed pane carries on Herdr and
tmux alike (`cloister/verdict-caller.ts`): no id is an operator shell, a
`conv-*` id is an operator conversation, and anything else is an agent
session. An operator may record any review verdict. An agent session may
record one only as the issue's own review session (`agent-<issue>-review` or
its convoy), an approval included.

An agent holds the operator's shell and can unset or fake its own
`OVERDECK_AGENT_ID` (#4066 review), so two more signals come first: the
nearest ancestor process started with a non-`conv-` `OVERDECK_AGENT_ID` (read
from `/proc/<pid>/environ`, which the agent cannot rewrite) names the caller,
whatever its own environment says; and a process with `OVERDECK_ISSUE_ID` or
`OVERDECK_SESSION_TYPE` but no agent id is a managed pane, never the operator.

**Residual risk.** The approval marker is a cooperative control while agents
run with the operator's `gh` credentials, which GitHub reports as `OWNER`. An
agent that daemonizes out of its harness's process tree and scrubs all three
variables is read as the operator, and any agent can post an
`overdeck-verdict: APPROVED sha=<head>` comment with `gh pr comment` without
going through this command at all. With the GitHub App configured, that
comment approves nothing (only the App bot's approval markers count, above),
and what remains is an agent minting an installation token from the App's
private key on disk; without the App, the marker trust rule cannot tell that
comment from the review agent's. The ancestry read fails the other way too: a
long-lived process started from an agent pane (a tmux or Herdr server, a
dashboard) passes that agent's id to everything beneath it, so an operator
conversation under it is read as that agent and its override is refused.

That review session's `blocked`/`failed` verdict is refused only when it is
proven that the exact head commit carries an approval: with no new commit
there is nothing new to review. Proof is a commit sha, never a date. It is
either a GitHub review whose `commit.oid` is the PR's `headRefOid`, or a
trusted `overdeck-verdict: APPROVED` marker whose `sha=` names the head. A
marker's `sha=` is the commit the review run reviewed, taken from its run id
(`agent-<issue>-review-<head8>`, or the review parent's current run when
`--run-id` is absent), and it is written only when the PR head is still that
commit. A head that moved during the review gets a marker without `sha=`, so a
later cycle can block the new head. A forge review posted with `gh pr review`
still attaches to the head at submit time (follow-up: post it through the
reviews API with `commit_id`). The
reviews are read by `forgeApprovalAtHead` in `pr-facts`, only on this path
and in the merge gate (#3983), so the shared PR read stays small.
Anything short of proof lets the verdict through: a GitLab MR (GitLab ties no
approval to a sha, and `mergeable` is not an approval), an approval of an
older commit, an empty review list, a marker without `sha=`, or a failed
read. Turning a real blocker into a pass is the worse failure.

A run the operator asked for may always block. The dashboard's Request review
and Re-run review (`/api/review/:id/trigger`, including the Full/Quick/None
choice), a forced re-review of an approved PR, and the dashboard's review
restart mark the review parent's state `reviewOperatorRequested`. `pan review
restart` sends its caller kind; run from an agent pane (the flywheel, stall
recovery) it grants nothing. Every dispatch rewrites that flag, so an automatic
re-review (the PAN-3836 redundant cycle, `pan done`'s request) runs without it
and is still refused. A refused verdict posts nothing and delivers no rework.
It is journaled as `review.verdict-refused` (with the reason, caller, run id
and notes) and raised as a warning in the activity feed. The agent is told to
record no verdict, post its findings as a plain PR comment for the operator,
and exit.

## Plan-freshness preflight (PAN-3917, PAN-4212)

Right before `pan start` spawns a work agent, it reads the workspace xBRIEF
plan and checks every non-glob `metadata.files_scope` path across the plan's
items. A work agent spawned against paths the codebase moved on since
planning — a file renamed, moved, or deleted — spins on paths that no longer
exist, so this preflight refuses the spawn instead: `The plan for <ID>
references files that no longer exist`.

A missing path is refused only when a commit on the workspace `HEAD` deleted
it *after* `plan.created`. A path that never existed on `HEAD`, or that `HEAD`
deleted *before* the plan was written, is a file the plan intends to create or
deliberately restore, and passes the check.

History comes from `HEAD` only, never `--all`. The `--all` form walks the
`refs/pan/turn/*` checkpoint refs Overdeck writes every turn — tens of
thousands of them on a long-lived repo — so any file a session ever drafted
would count as "tracked," flagging every real creation as drift.

`--skip-freshness` bypasses the check entirely and spawns anyway; the fix for
a genuine refusal is `pan plan <ID>` to re-plan against the current tree. On
the dashboard's auto-start path the refusal is not surfaced in the UI — it
lands only in `spawn.log`.

## Agent Auto-Resume Gates

Auto-resume is intentionally suppressible:

- **Boot no-resume:** `OVERDECK_NO_RESUME=1`, `pan dev --no-resume`, or
  `pan up --no-resume` disables orphan recovery and stopped-agent
  auto-resume for that dashboard boot only.
- **Manual pause:** `pan pause <id> [--reason <text>]` persists `paused`
  fields in `~/.overdeck/agents/<agent-id>/state.json` and stops the agent
  if it is running. `pan unpause <id>` clears the gate without spawning.
  `pan start <id>` refuses paused agents unless `--force` is passed.
  **Issue pause (PAN-3911).** An operator pause (`pan pause`, the dashboard
  Pause button) stamps `pausedBy: 'operator'`. An operator pause of the
  issue's work agent `agent-<issue>` pauses the issue. Pausing a swarm slot
  pauses only that slot. Machine pauses do not count: the memory governor's
  shed, post-merge close-out, escalations and the Fly migration all leave
  `pausedBy` unset, and neither does a scheduler yield. An operator pause
  also clears the yield flags, so the scheduler cannot resume the agent.
  `isOperatorPause` is the one test for "operator pause": `getIssuePause`
  and the feedback ladder both read it, so a machine reason written over an
  operator pause does not let feedback delivery lift it.
  The issue pause:
  - Stops the issue's running test agent and, only while a review is in
    flight (the journal's last entry is `review.requested`,
    `review.dispatched` or `review.redispatched`: no verdict yet), its review
    convoy (lanes first, the synthesis parent last). Reviewers that already
    posted their verdict stay warm at their prompt and are left alone, so
    unpause never re-reviews a head that was already reviewed. "Running" is
    `isAlive`'s answer. An
    agent whose liveness is indeterminate is left alone and reported. On
    Herdr, a second pass (`closeIssuePanes`) closes review/test panes that no
    agent row lists. A close that fails is reported by `pan pause` (exit 1)
    and in the dashboard response (`warnings`), never as a stop.
  - Stops them with cause `'system'`. `'operator'` would set `stoppedByUser`
    on each one, and `messageAgent` answers that gate by queueing mail that
    nothing drains. The hold is the issue gate (`getIssuePause`) instead.
    `messageAgent` reads it and queues, rather than resumes, a message to a
    reviewer the pause stopped (listed in `pauseStoppedAgents`) while the
    issue is paused. Other roles, other reviewers, and an issue whose pause
    state cannot be read are not held.
  - Records the stopped ids next to the pause (`pauseStoppedAgents`) and,
    when reviewers were stopped, journals `review.halted`.
  - `pan unpause` (and the dashboard Unpause) clears `stoppedByUser` on those
    rows. It then re-requests the review through the guarded review request
    (`requestReviewGuarded`, the logic of `POST /api/review/:id/request`:
    merged check, approved-head check, re-request breaker; source
    `pan-unpause`), before the work agent resumes. That dispatches a fresh
    synthesis parent and convoy for the current head. A merged issue or an
    approved head is reported as "no review re-requested", not as a request.
    When only the test agent was stopped, unpause re-dispatches the test role
    instead. A request that fails is printed with `pan review request <id>`
    as the fix, and the dashboard shows it (and the pause `warnings`) in a
    toast.
  - A `review.halted` tail on an issue that is no longer paused is a review
    owed. Stalled-review recovery re-requests it (see below), which covers an
    unpause whose re-request failed, an unpause while the dashboard was down,
    `pan start --force`, and dashboard Start with `clearGates`.
- **Troubled gate (PAN-4211):** `applyAgentFailure` sets `troubled` (plus
  `troubledAt` and the failure-tracking fields) after three consecutive
  resume/start failures within ten minutes. It blocks `pan start`, `pan
  resume`, dashboard Start and MERGE until cleared. `pan untroubled <id>`
  clears the flag and the failure counters without spawning. `pan start
  <id> --force` (and dashboard Start with `clearGates`) clears it and starts
  in one step. Both doors record an `untroubled` operator intervention.
- **Operator-stop gate:** `stoppedByUser` blocks autonomous re-drive when no
  completed handoff exists and emits one durable needs-you trip. Only an
  operator-initiated stop sets the flag (PAN-3324) — `pan kill`, `pan
  pause`, and the dashboard stop/pause actions pass it explicitly; every
  machinery-initiated stop (memory shedding, health force-kills, close-out)
  leaves it unset so autonomous recovery stays eligible. Recording an OOM
  kill as an operator stop is what once turned a transient resource event
  into a permanent stall.
- **Memory gate (PAN-2500, scaled defaults PAN-4267):** the hysteresis
  resource governor (`assessMemoryPressure` in `cloister/memory-governor.ts`)
  gates exactly one caller: the preemptive scheduler's
  `preemption.ts:resumeYieldedAgents`. It also feeds the memory-pressure
  patrol (`memory-pressure-patrol.ts`), which only reports the band to the
  activity feed — `shed()` (stack-stop / idle-agent-pause reclaim) has no
  caller anywhere in the codebase. The governor never gates conversations,
  `pan start`, or dashboard Start. Below the SOFT reserve the governor
  defers `resumeYieldedAgents`; below HARD it reports `shedding`; neither
  re-admits until memory clears RECOVERY. Reserve defaults are a share of
  RAM with an absolute floor and a cap (hard &le; 10%, soft &le; 20%,
  watch &le; 25%, recovery &le; 35% of total RAM; see
  `src/lib/config-yaml/governor-reserves.ts`), so a small host (an 8-16 GB
  Mac) gets workable reserves instead of a recovery reserve at or above its
  total RAM; hosts at or above 40 GB keep the pre-PAN-4267 values. It does
  **not** gate every dispatch path: no spawn path reads
  `getCachedMemoryVerdict`. POST `/api/agents` — the operator's start, the
  planning auto-handoff and its deferred retry — sees memory only through
  `evaluateSpawnGuardrails` (`routes/agents/shared.ts`), which classifies
  free RAM against the `memoryWarnGb`/`memoryBlockGb` thresholds with no
  hysteresis; these defaults are also scaled, `min(4, RAM/8)` GB warn and
  `min(2, RAM/16)` GB block. This is separate from `--no-resume`, which
  suppresses resume outright regardless of memory.
- **macOS measurement (PAN-4267):** the header collector
  (`system-health/darwin.ts`) and the governor's reader
  (`readProcMemoryDarwin` in `dashboard/server/services/proc-memory.ts`)
  share one available-memory calculation
  (`computeDarwinAvailableMemoryBytes`): `memory_pressure -Q`'s free
  percentage of total RAM first, falling back to the Activity Monitor
  `vm_stat` formula (`total - (anonymous - purgeable + wired + compressor)`)
  when memory_pressure is unavailable. macOS has no PSI and allocates swap
  on demand, so the governor ignores swap runway there
  (`swapGrowsOnDemand`) and instead reads the kernel's own
  `kern.memorystatus_vm_pressure_level` sysctl as its stall signal: level 4
  (critical) sheds immediately regardless of the memory reserves, and level
  1 (normal) counts as calm for the holding re-admit window.
- **Operator-started exemption (PAN-1812, PAN-3634):** when
  `exempt_operator_started` is on, the emergency brake
  (`concurrency.ts:emergencyBrake`) and the memory governor's shed
  (`memory-governor.ts:selectAgentToPause`) reap only agents whose
  `startedBy` starts with `flywheel:` (`isFlywheelStartedBy` in
  `agents/provenance.js`) — never on a stale `flywheelRunId` field, which is
  inert legacy data. The Flywheel conversation mints `flywheel:conv-flywheel`
  from `OVERDECK_CONVERSATION`; the planning auto-handoff and its deferred
  retry copy that token only when the planning session it hands off from was
  itself Flywheel-started, and send `planning-auto-handoff` (an operator
  origin) otherwise. Every other origin — an operator's `pan start`, a
  worker, a reconciler — is exempt, which is what lets a deliberate operator
  spawn survive the cap.
- **Deferred planning hand-off (PAN-4155):** when planning finalizes with
  auto-start, the first POST `/api/agents` acknowledges tight RAM and a high
  agent count only (PAN-3977). If a guardrail still refuses it (the agent
  ceiling, leaked specialists, critical RAM, a stale health snapshot), the
  hand-off is journaled as `handoff.deferred` instead of `planning.failed`,
  and deacon-lite's `retryDeferredHandoffs` re-sends the spawn with **no**
  acknowledgement at all, so a machine never waives a health warning on a
  retry. Only a refusal whose response carries a guardrail decision is
  deferred; the start gate and the dirty-tree guard also answer 409 and stay
  failures. The retried spawn still runs on the operator's `pan start --model`
  from planning time (PAN-3022): the model lives in the auto-start consent
  record the retry spends, not on the deferred request itself. A deferral
  recorded while the Deacon is frozen (`deacon.globally_paused`, the dashboard
  sidebar's Snowflake toggle) is journaled the same way but held, not
  retried, until the freeze thaws — the warn activity line, `pan plan
  finalize`/`pan plan done`'s output, and `pan show` all say so (PAN-4210).
  See "Deacon-lite" below for the schedule and stop conditions.
- **Preemptive scheduler** (opt-in via `[concurrency] preemption = true`,
  PAN-2507) may **yield** an idle work agent — pause it to free capacity for
  a blocked review/test dispatch. A yield reuses the same `paused: true`
  gate, tagged `yieldedByScheduler`/`yieldedAt`, and is self-clearing:
  yielded agents resume oldest-first once a slot and the memory gate allow,
  and `pan unpause` on a yielded agent clears the yield attribution too.

These gates are orthogonal to deacon-lite's own start/stop toggle
(`pan admin cloister start|stop`).

## GitHub quota policy (PAN-4264)

GitHub limits each identity to 5,000 points per hour per bucket (GraphQL and
REST, which GitHub calls `core`), plus a burst ("secondary") limit. Overdeck
meters its own GitHub calls, backs off when GitHub refuses one, and never
reads a refused or skipped call as "no data".

**Quota source.** The user pool's `graphql` bucket is sampled from GitHub
GraphQL's own `rateLimit(dryRun: true)` field, not REST `/rate_limit`: a
2026-09-28 comparison found REST's `resources.graphql.used` reporting 45
against GraphQL's own reported 2,424 at the same moment — REST's GraphQL
count does not track what `/graphql` actually charges (PAN-4291). REST
`/rate_limit` remains the source for the `rest` (`core`) bucket and for the
App pool's usage, which has no separate GraphQL source wired up.

**The ledger.** Every metered call and every `/rate_limit` sample appends one
JSON line to `~/.overdeck/github-quota/ledger-<YYYYMMDDHH>.jsonl` (UTC hour):
`{ ts, pid, kind: 'call' | 'sample', caller, pool, bucket, cost, estimated,
outcome, remaining?, limit?, resetAt?, agent? }`. The pool is the identity
spent: `user` (the `gh` CLI token), `pat` (`GITHUB_TOKEN`) or `app` (GitHub
App installation tokens). Readers aggregate the last 60 minutes from the
current and previous hour files; files older than 3 hours are deleted on the
hour rollover. The dashboard, the deacon child, CLI processes and the agent
`gh` shim (beside the agent git guard; conversations get it alone), which
counts every call and, for agent panes and the Flywheel conversation, refuses
grant-label writes (PAN-4343), all write it.
`src/lib/github-quota/` owns it: `runGh` (metered `gh` exec),
`withGitHubCaller` (the caller context), the App/PAT metering in
`rest-meter.ts`, and the pause gate.

**Pause rules.** A rate-limit or secondary-limit refusal observed by any
process writes `~/.overdeck/github-quota/pause.json` for that pool and bucket
(atomic tmp + rename). Duration rules:

- Primary limit, the latest sample for that `(pool, bucket)` has a `resetAt` later than now: pause until that `resetAt` when the sample also shows `remaining == 0`; otherwise pause 10 minutes, capped at that `resetAt` when it is sooner. The sample's age does not matter — its `resetAt` is the current window's real reset either way (PAN-4291; there is no 60-second floor here).
- Primary limit, no sample or the sample's `resetAt` has already passed: pause 10 minutes.
- Every new sample reconciles the active primary pause on its exact `(pool, bucket)`: a sample showing headroom (`remaining > 0`) lifts the pause immediately, and a still-exhausted sample with a future `resetAt` moves the pause to that `resetAt` instead of riding out the original 10-minute guess.
- Secondary limit: pause for `retry-after` seconds when present. Otherwise pause 60 seconds, doubling on each consecutive secondary refusal within 30 minutes, capped at 15 minutes.
- For a **primary** refusal only, an `x-ratelimit-reset` header on the refused response wins over the sample-based rules, floored at 60 seconds. A **secondary** refusal ignores `x-ratelimit-reset`, because that header describes the hourly window, not the burst limit.

A pause blocks only its exact `(pool, bucket)`: a GraphQL pause never stops
REST calls, and a `pat` pause never stops the `user` or `app` pools.

**Who is paused.** Only the non-essential read-model pollers skip GitHub
during a pause: `pipeline-membership`, `pr-cache`, `pr-sync`, `ci-repair`,
`issue-poller` and `close-out` (the deacon's 60-second closed-issue reaper).
Every other caller is essential and is never paused: `tracker-client`,
`app-rest`, `quota-sampler`, `agent` and `other` — merges, verdict recording,
tracker writes, agents, `closeOut()` and `pan close`.

**Never "no data".** A skipped call throws `GitHubQuotaPausedError` and a
refused call throws `GitHubRateLimitedError`. Callers keep their "failed"
signal: pipeline membership reports `forge_transient`, `readRepoPullRequests`
returns `null`, PR sync skips its sweep without counting repository
failures, and the closed-issue reaper treats the issue as not closed.

**Wasted calls removed.**

- A project with no resolvable tracker (no `tracker`, `rally_project`, `github_repo`, `issue_prefix` or `gitlab_repo`) is skipped by every membership refresh, logged once per `projects.yaml` mtime, and listed by `pan doctor` as a warn row.
- A 404 from a GitHub App issue listing marks the repo App-not-installed for 6 hours (`repo-notes.json`); its issues are listed through the `gh` user token meanwhile.
- A minted App installation token is reused until 5 minutes before it expires.
- Boot-warm refreshes are staggered over 60 seconds and periodic convergence over 4 minutes, one project per refresh batch; the first CI refill runs at boot + 2 minutes.
- The close-out merged-PR lookup (`isSquashMergedViaPr`) runs through `runGh` instead of a raw unmetered exec, and a "not merged" answer for a `(project, branch, tip SHA)` is cached for one hour so the deacon's 60-second closed-issue reaper does not re-ask GitHub every tick for a still-unmerged branch (PAN-4291).
- `readRepoPullRequests` skips the `gh pr list` call entirely — no exec, no ledger line — for a repo with no git remote or a project with no resolvable tracker.
- The PR-cache listing is capped at 100 rows, not 200, and a listing with no OPEN PR is cached for `PR_CACHE_IDLE_TTL_MS` (5 minutes) instead of the flat 30 seconds, since nothing in it can change without a new PR opening.
- `gh pr list`/`gh issue list` calls are priced by the GraphQL pages they actually walk (`priceGhListCall`), weighted by which `--json` fields GitHub joins in, instead of a flat 1 point.
- A `gh` failure GitHub never saw (bad args, no git remote, `gh` missing) costs 0, not 1; only a failure whose stderr shows GitHub actually answered (an HTTP status or a `GraphQL:` error) still costs 1.

**Where to look.** The app-bar pill shows `GH <remaining>/<limit>` for the
user GraphQL budget and lists the top callers; a banner in the system notices
row names the pause end time and whether this machine's own use explains it;
`pan doctor github-quota [--json]` prints the caller table, latest samples,
the active pause, skipped projects and repos without the App.
`GET /api/github-quota` returns the dashboard's snapshot. Calls from the ~35
unmigrated `gh` sites show up only as the snapshot's `unattributed` points
(migrating them is tracked in PAN-4302).

## The pipeline journal (post-Cut follow-up to PAN-3917)

PAN-3917 deleted the stored per-issue pipeline record. That was right — state
is what git, the tracker, the PR and the terminal backend say — but it left a
hole: between "PR opened" and "review posted" nothing on disk said what
Overdeck was *doing*. `pan show` could only answer `in-review`, a work agent
told to "confirm the pipeline state change" had nothing to confirm it with and
polled for ten minutes (PAN-3705), and a dashboard restart mid-convoy lost the
convoy with nothing left to re-dispatch from.

One piece of stored pipeline state came back, and it is not a status.

**The contract** (`src/lib/cloister/pipeline-journal.ts`):

- **Append-only.** The server writes one entry at the moment it performs an
  action and never rewrites it. There is no update, no delete, no repair
  routine, and no API that exports one.
- **Not authority.** Readers take the last entry plus the PR. If the two
  disagree, the PR wins and the journal is merely stale. Nothing reconciles it.
- **Event-based, never polled.** Appending fires `pipeline.entry` on the
  existing pipeline-notifier. The dashboard projects it as a `pipeline.journal`
  domain event; a CLI-process append forwards over
  `POST /api/internal/pipeline/notify`.
- **Disposable.** It lives at `<workspace>/.overdeck/pipeline.jsonl`, beside
  `verification-latest.json`, and dies with the workspace. It is never written
  into a workspace that no longer exists.
- **Never fatal.** A write failure is logged and swallowed: an unwritable
  journal must not break the action that produced it.

**Entry types and who writes them**

| Type | Written by |
| --- | --- |
| `verification.started` / `.passed` / `.failed` | `cloister/verification-runner.ts`, at the start and at every outcome return |
| `verification.failed` (`failedCheck: 'test'`, `cycleCount`, `via: 'ci'`) | `cloister/ci-failure-feedback.ts`, when a `verification.tests: ci` project's CI test job is red on the PR head (once per head) |
| `review.requested` | `startRequestReviewPipeline` — the one door the HTTP route, `pan review request`, `pan done` and the PR webhook all pass through; also reached over that same door by deacon-lite's `recoverUndispatchedReviews` (source `deacon-lite`), re-requesting a review a dashboard restart left undispatched |
| `review.dispatched` | `cloister/review-convoy.ts` `launchConvoyReviewers`, once reviewers exist |
| `review.redispatched` | deacon-lite's `recoverStalledReviews` |
| `review.verdict` | `pan admin specialists done review`, once the verdict reaches the forge |
| `review.verdict-deferred` | `pan admin specialists done review`, when recording the verdict hits a transient forge failure (PAN-4263) |
| `review.verdict-replay-gave-up` | deacon-lite's `recoverStalledReviews`, when a deferred verdict's replay stops: `superseded`, `cap` or `failed` |
| `merge.attempted` | the MERGE door in `routes/workspaces/merge-ops.ts`, once the merge holds the project's merge slot |
| `merge.failed` | merge-ops' own `setStatus`, the single funnel every failing exit of `triggerMerge` passes through |
| `merge.completed` | `cloister/merge-agent.ts` `postMergeLifecycle`, right after the forge answers "merged" |
| `handoff.deferred` | `completePlanningForIssue` (`overdeck/planning-promotion.ts`), when a spawn guardrail refused the auto-start |
| `handoff.retried` / `.started` / `.abandoned` | deacon-lite's `retryDeferredHandoffs`, on each retry and when it stops |
| `operator.decision-requested` | `pan ask` (`src/cli/commands/ask.ts`), when a work agent needs an operator decision |
| `operator.decision-answered` | the dashboard answer route, a delivered dashboard message, or a delivered `pan tell` to the asking agent |
| `operator.decision-withdrawn` | `pan ask --withdraw` |

`pan show <id>` prints the last six entries under the derived state; `--json`
carries the whole journal.

## Operator decisions (PAN-4383)

A work agent that cannot continue without an operator decision runs
`pan ask <ISSUE> "<question>" --option <a> --option <b> [--context <text>]`.
The verb needs 2 to 4 non-empty options and exits 1 otherwise. It appends one
`operator.decision-requested` entry to the issue's pipeline journal, recording
the question, the options and the asking agent's id. `pan ask <ISSUE> --withdraw`
appends `operator.decision-withdrawn` for the open request and exits 1 when
there is none.

Nothing stores "open". `src/lib/cloister/operator-decision.ts` derives it on
read: the most recent `operator.decision-requested` entry is the open decision
until a later `operator.decision-answered` or `operator.decision-withdrawn`
entry carries the same `questionId`, or a later `verification.started` entry
shows `pan done` ran. A newer request supersedes an older one.

Every surface reads that one rule:

- **Needs-you.** The enrichment poller reads the open decision on every 10 s
  poll and reports it as a pending `askUserQuestion` on the asking agent, with
  `toolUseId` `operator-decision:<questionId>`. The existing Needs-you panel,
  answer dialog, TTS and desktop notification pick it up. The decision is exempt
  from the PAN-1834 specialist suppression, because it is a fresh request, not
  stale transcript state.
- **Answering.** `POST /api/agents/:id/answer-question` delivers the answer
  through `deliverAgentMessage` and appends `operator.decision-answered` only
  when delivery returns `ok`. A failed delivery returns 502 and leaves the
  decision open. Any other delivered operator message to the asking agent
  (a dashboard message or `pan tell`) also answers it.
- **Command Deck.** `deriveAttention` returns `needs-you` while a decision is
  open, so the issue sits in the "Needs you" bucket instead of reading stuck.
- **Parked population.** `classifyParked` emits an `operator-gate` row with
  `gate: 'operator-decision'` instead of `idle-running`. The stall sweeper
  re-surfaces it on its 24 h operator-gate TTL and never recommends a nudge or
  a stop.

The journal dies with the workspace, so an issue whose workspace is gone has no
open decision.

## Deacon-lite: seven routines

`runDeaconLite()` runs on a 60s tick and holds seven routines, all of which only
observe and nudge — none reconciles a stored copy of anything:

1. `checkStuckWorkAgents` — one nudge per hour to an idle work agent with
   unpushed commits.

   `checkStuckWorkAgents` does **not** read the Jev turn-end assessment
   (PAN-4371) in this release. That assessment only labels the Needs-you row
   (`describePendingInput`'s turn-end label) and the parked `idle-running`
   row's evidence (`src/lib/parked/resolver.ts`, `src/lib/cloister/stall-sweeper.ts`).
   It is advisory: it never suppresses, adds, or changes a nudge here.
   Letting this routine act on the assessment is a separate, operator-signed
   issue (phase 2).
2. `checkApiErrorAgents` — nudges a work, specialist, or planning agent wedged
   on a provider error (including Claude Code's "API Error: Connection lost
   mid-response"), once per 5 minutes, and only when liveness.ts `isIdle`
   says its work activity has been stale for 2 minutes.
3. `reconcileAgentLiveness` — corrects the dashboard's in-memory cache against
   the selected backend's inventory.
4. `reapClosedIssueAgents` — reaps agents for issues the tracker has closed.
5. `recoverStalledReviews` — re-dispatches a review convoy whose reviewers
   are all gone, and replays a deferred review verdict
   (`cloister/deferred-verdict-replay.ts`, PAN-4263).
6. `retryDeferredHandoffs` (`cloister/deferred-handoff.ts`, PAN-4155) —
   re-sends a planning hand-off a spawn guardrail refused.
7. `recoverUndispatchedReviews` (`cloister/undispatched-review-recovery.ts`,
   PAN-4221) — re-requests a review a dashboard restart left undispatched.

While the Deacon is frozen (`deacon.globally_paused`), `runDeaconLite()`
returns before any of the seven routines run — none of them fires at all
until it thaws (PAN-4210).

`recoverStalledReviews` reads the journal and the issue pause gate
(`getIssuePause`, see "Manual pause" above), with no GitHub call and no tracker
call. It skips an issue that is paused, or whose pause state cannot be read,
and logs the hold once. A `review.halted` last entry (the pause stopped the
convoy) is never convoy recovery: the pause stopped the synthesis parent, so
relaunching lanes against it would only strand them. While the issue is
paused, or its pause state cannot be read, it holds. Once the pause is clear it
re-requests a fresh review through the guarded review route
(`POST /api/review/:id/request` over the internal token, source
`deacon-lite`, since deacon-lite runs in the deacon child where the route
module is not loaded), at most once per issue per hour. The route journals
`review.requested` on success, which ends the halt. Otherwise it acts only when an issue's **last** entry is `review.dispatched`,
`review.redispatched`, or `review.requested`, is at least 15 minutes old, and no
pane whose id starts with `agent-<issue>-review-` is live. The last-entry rule is
load-bearing: a `verification.failed` written *after* `review.requested` means
the work agent owes rework, and re-dispatching there would re-run verification
every hour forever. Only sub-reviewers count as "live" — the synthesis parent's
id is exactly `agent-<issue>-review`, and letting it mask four dead lanes is the
PAN-3939 wedge this routine exists to clear.

It then relaunches the missing lanes against the existing run
(`recoverMissingConvoyReviewers`), which reuses the parent's own `state.json` and
so re-verifies nothing; only a parent with no run state at all falls back to the
full review door. At most one re-dispatch per issue per hour: the cooldown is
held in memory and, because the deacon child's memory dies on restart, also read
back from the routine's own `review.redispatched` entry. A recovery that launches
nothing journals and reports nothing, so the routine never claims a re-dispatch
that did not happen (PAN-3914). While some lane is still live without a report
and the synthesis parent `agent-<issue>-review` is confirmed dead, the routine
logs a `[deacon-lite]` warning once per cooldown; a live or indeterminate parent
stays quiet.

When every lane of the run already wrote its report, there is no lane to
relaunch; what is missing is the synthesis (#4134). The routine then re-runs the
synthesis step (`redispatchReviewSynthesis` in `review-synthesis-recovery.ts`,
with a prompt that says the reports are already on disk) only when all of these
hold: no `review.verdict` is journaled for the run, the run has had fewer than
three synthesis re-dispatches, the liveness oracle (`isAlive` +
`isConfirmedDead`) confirms the parent `agent-<issue>-review` dead, and the
cooldown above has passed. The cooldown starts before the relaunch, and an
in-flight guard makes an overlapping patrol tick do nothing. The issue pause
hold comes first: a paused issue, or one whose pause cannot be read, never
reaches lane or synthesis recovery (PAN-3911).

Under the per-issue review lifecycle lock, the relaunch re-checks everything
that can change under it and does nothing unless all of it still holds:

- the parent's resume gates allow an **autonomous** relaunch
  (`decideResumeGate(…, 'autonomous')`): `stoppedByUser`, `paused`, `troubled`
  and failure backoff all hold it. The hold is logged once.
- the operator did not abort the review: `pan review abort` journals
  `review.aborted`, and an abort after the last `review.dispatched` holds it
  (as the journal's last entry, it also stops the patrol outright).
- the parent is still confirmed dead, and its saved `reviewRunId` is still the
  run being recovered.
- the run id still names the workspace HEAD (`agent-<issue>-review-<head8>`, the
  idempotency guard's comparison). A run for a head that moved, or an unreadable
  head, is stale and is never synthesized: recovery logs it and leaves the next
  review to the dispatch that owns the current head (`pan done`, the webhook,
  `pan review request`).

It resumes the saved parent session when there is one. A refused resume is
final: "appears healthy" means another caller already relaunched the parent,
and a gate refusal is an operator hold. Only a parent with no session to resume
(or a harness/model drift) gets a fresh spawn: its dead pane is closed and only
the parent's own state dir is reset (the lanes' state dirs and `sessions.json`
indexes stay). A fresh spawn for the same run carries the parent's
`reviewOperatorRequested` flag (#4139).

An indeterminate probe is never death: it takes no action, logs once per
unknown streak, and re-probes after five minutes rather than every tick. The
re-dispatch is journaled as `review.redispatched` with
`via: synthesis-recovery` and the `runId`, which is also the restart-proof
cooldown and the retry count. After three for one run the routine journals
`review.synthesis-gave-up`, warns in the activity feed, and stops: that entry is
the journal's last, so the patrol leaves the issue to the operator.

**Accepted v1 gaps** (stated in the module, deliberately not built): a convoy
where some reviewers posted a verdict and one died is not recovered, because the
last entry is then `review.verdict` — `review.dispatched.data.reviewers` carries
enough to count verdicts later. A quick-mode review writes no `review.dispatched`
entry, so a dead quick reviewer is not recovered either. A server death between
`verification.started` and its outcome still leaves `verification.started` or
`verification.failed` last, and both are still skipped by `recoverStalledReviews`
above (an agent that owes rework must not have verification re-run every hour).
A `verification.passed` tail whose source is `request-review`, though, is now
recovered — by `recoverUndispatchedReviews`, below.

`recoverUndispatchedReviews` (PAN-4221) closes the one `verification.*` tail
`recoverStalledReviews` deliberately leaves alone: a dashboard restart while a
detached verification worker runs kills the push-and-dispatch continuation that
lived in the dead process, so the worker's own `verification.passed` write
becomes a permanent tail with nobody left to dispatch the review (PAN-4198..4201
sat about 15 hours on 2026-09-25). It acts only when every one of these holds:
the workspace's **last** journal entry is `verification.passed` with
`source: 'request-review'` — a `review` (dashboard `/trigger`) or `merge-verify`
pass belongs to a different door and is left alone, since a `/trigger` run may
carry a per-run review mode this routine cannot reproduce, and a merge-gate pass
belongs to the merge door; the entry is at least 5 minutes old
(`UNDISPATCHED_REVIEW_MIN_AGE_MS`) — past a normal push-and-dispatch, so a runner
still mid-push is not mistaken for dead; no verification worker is active for the
issue (`isVerificationWorkerActive`); no pane equal to `agent-<issue>-review` or
starting with `agent-<issue>-review-` is live — the parent counts, not just the
sub-reviewer lanes, because quick mode (the default) writes no
`review.dispatched`, so a healthy quick reviewer's tail stays
`verification.passed` for its whole life; the issue is unpaused
(`getIssuePause`); review mode is not `none`; and the primary repo's current
head, read fresh through `verified-head.ts`'s `readPrimaryHead8`, still matches
the head the pass stamped. A per-issue hourly cooldown
(`UNDISPATCHED_REVIEW_COOLDOWN_MS`, set *before* the request so a refused or
unreachable route is not retried every tick) and a cap of 3 deacon-lite
`review.requested` entries since the last `review.requested` from any other
source (`UNDISPATCHED_REVIEW_ATTEMPT_CAP`) stop an hourly re-verify loop once
each dispatch keeps coming back gated — the cap is logged once, not every tick.
Recovery goes through the same guarded route `rerequestHaltedReview` uses
(`requestReviewThroughRoute`, source `deacon-lite`), never a skip-verification
door: the route re-verifies against current main and journals
`review.requested` itself, which moves the tail and makes the recovery
exactly-once. The first deacon-lite patrol runs at deacon start, so a stall that
began before a restart is covered as soon as the process comes back up.

`retryDeferredHandoffs` acts only when an issue's last `handoff.*` entry is
`handoff.deferred` or `handoff.retried`. Each of those entries carries the
schedule (`deferredAt`, `attempt`, `nextRetryAt`), so a dashboard or deacon
restart resumes the backoff where it stood; nothing is held in memory. Retries
run 2, 4, 8 and 16 minutes apart, then every 20 minutes. Each one POSTs
`/api/agents` through `spawnWorkAgentThroughAgentsEndpoint` with
`autoSpawnConsentRequired: true` and no acknowledgement, so a success spends
the operator's auto-start consent exactly as the first attempt would have.
The retried spawn runs on the operator's `pan start --model` from planning
time (PAN-3022) — the retry carries no model of its own, so it reads the
consent record's `workModel` and spends it along with the rest of the claim.
While the Deacon is frozen, `runDeaconLite()` returns before
`retryDeferredHandoffs` ever runs, so no retry is attempted at all; the
schedule stays exactly as journaled and resumes on the first tick after the
freeze lifts. The two-hour window keeps counting the whole time it is frozen,
so a deferral that was already old enough can give up on that very first
post-thaw tick.

It stands down (a `handoff.abandoned` entry with `outcome: 'stood-down'` and an
info activity line, no failure) when the operator already acted: an
`agent-<issue>` pane is live, the work agent is paused, it was started or
stopped after the deferral, planning was restarted (its `startedAt` is later
than the deferral — the `status` label itself is never read, since PAN-3917
complete-planning's stop projection appends an event but writes no
`state.json`, so that label would otherwise read `running` forever), the
auto-start consent is no longer `granted`, or the retried spawn answers
`paused`, `troubled`, `closed-issue` or (PAN-4210) `already-running`. Two
hours after the first refusal, or on an `unauthorized` answer, it gives up: a
`handoff.abandoned` entry with `outcome: 'gave-up'`, a `planning.failed` event
with `stage: 'auto-handoff'`, and a warn-level activity line that tells the
operator to run `pan start`.
