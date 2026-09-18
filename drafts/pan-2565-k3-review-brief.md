# Independent review request — 5 pipeline defect claims (Overdeck)

You are an independent reviewer. Another agent (Claude Opus 5) diagnosed five
defects in the Overdeck pipeline while investigating a live incident on issue
MIN-901. Your job is to **independently verify or refute each claim** against
the actual source, and to critique the proposed fixes.

**Be adversarial.** Assume each claim may be wrong. A claim that survives your
attempt to refute it is worth far more than agreement. If a claim is right but
the proposed fix is wrong, incomplete, or would break something else, say so —
that is the most valuable thing you can produce here.

## Rules for this session

- **Read-only on source.** Do NOT edit, commit, or push any code. Do NOT run
  `pan done`, `pan start`, or any pipeline-mutating command.
- Your cwd is a detached worktree of `main` at
  `/home/eltmon/Projects/hoff-k3-review`. Read source here.
- Live evidence lives outside this worktree; read it at absolute paths:
  - MIN-901 workspace: `/home/eltmon/Projects/myn/workspaces/feature-min-901`
    (polyrepo: wrapper repo at the root, sub-repos `api/`, `fe/`, `infra/`,
    `docs/`, `myn-skills/`, `openclaw-plugin/`)
  - Deacon log: `/home/eltmon/.overdeck/logs/deacon.log`
  - Project config: `/home/eltmon/.overdeck/projects.yaml` (MYN block starts
    around line 96; `quality_gates` around line 109)
  - Live pipeline status: `curl -s http://localhost:3011/api/review/MIN-901/status`
- Read-only git and `curl` GETs are fine. No POST/DELETE to any endpoint.

## Glossary

- **Polyrepo workspace** — a Overdeck workspace whose root is a thin "wrapper"
  git repo containing several independent sub-repos as subdirectories. The
  wrapper's HEAD does not advance when work lands in a sub-repo.
- **Composite head anchor** — the string form introduced by PAN-2948, e.g.
  `fe@<sha> api@<sha> infra@<sha>`, produced by
  `snapshotWorkspaceHeadsPromise()` in `src/lib/git-utils.ts:361`. For a
  monorepo it degrades to a bare SHA. It is NOT a valid git ref.
- **`reviewedAtCommit` / `lastVerifiedCommit`** — head anchors stored in the
  `review_status` row, recording what the reviewer approved and what the
  pre-review verification gate ran against.
- **Verification gate** — the project-configured `quality_gates` run by
  `src/lib/cloister/verification-runner.ts` before the review role dispatches.
- **Test role** — a spawned agent that runs the project's real test suite and
  browser UAT, then POSTs `testStatus`.

## Incident summary (facts established, verify if you doubt them)

MIN-901 is a MYN backend fix. Timeline (UTC):

- 09:00Z — a test agent ran the real maven suite at `api@180a903f` and passed
  (2898 tests). Artifact: `.pan/test/result.json` in the workspace.
- 09:34Z, 09:43Z — the review agent BLOCKED twice on a genuine error-classifier
  bug. Both blocks were delivered to the work agent (its transcript shows
  `SPECIALIST FEEDBACK: review-agent reported BLOCKED`).
- 09:38Z, 09:47Z — the work agent fixed it: `api@ed4fa482`, then `api@025ec1f3`.
- 09:55Z — review passed. Test status was written as
  `passed — "Skipped: no code changed since pre-review verification gate"`.
  **No test agent ever ran against `ed4fa482` or `025ec1f3`.**
- 09:58Z — an operator/automation nudge told the test agent to "finalize and
  report the passing test status". It refused, claiming the workspace was stale
  because `git cat-file -t 025ec1f3` failed. It ran that at the WRAPPER root.
  The commit is HEAD of the `api/` sub-repo.
- 11:12Z onward — review has been passing and resetting to pending roughly
  every 30 seconds, indefinitely. History grew from 136 to 196 entries in 20
  minutes.

## The five claims

### Claim 1 — `checkPostReviewCommits` is polyrepo-blind, causing an infinite review loop

`src/lib/cloister/deacon.ts:1597-1601` reads the current head with a raw
`execAsync('git rev-parse HEAD', { cwd: workspacePath })` at the workspace
root, then compares it to `status.reviewedAtCommit`, which is a composite
anchor. In a polyrepo the workspace root is the wrapper repo, so the two can
never be equal and the check reports drift on every patrol.

The three escape hatches below the comparison (tree-identical rebase at
:1610-1616, `haveSameEffectiveCodeCommit` and `haveSameCodeContribution` at
:1630-1632) all feed the composite string to git as a ref, throw, and are
swallowed by `catch` blocks that deliberately fall through to the reset.

Claimed evidence — deacon.log line:
`Reset review for MIN-901: new commits after review passed (fe@52d65 → 7492ae82)`
(a composite `.substring(0,8)`'d against the wrapper SHA `7492ae82`).

**Proposed fix:** use `snapshotWorkspaceHeadsPromise(issueId, workspacePath)`
for `currentHead`, matching PAN-2948's treatment at
`verification-runner.ts:881` and `deacon-review-status.ts:514`. Then make the
three escape hatches loop over `resolveWorkspaceRepoRootsSync` and compare
per sub-repo. Regression test: polyrepo fixture with unchanged sub-repo heads
produces zero actions.

**Verify:** Is the mechanism real? Does the fix actually terminate the loop, or
does something downstream still compare a composite to a bare SHA? Are the
per-sub-repo semantics of the rebase escape hatches well-defined (what if two
sub-repos disagree)? Would this fix regress monorepo behavior?

### Claim 2 — the test-role auto-skip can report "tests passed" when nothing ran tests

`src/lib/review-status.ts:436-452` skips the test role when
`reviewedAtCommit === lastVerifiedCommit`, writing
`testStatus: 'passed', testNotes: 'Skipped: no code changed since pre-review verification gate'`.
The premise is that the verification gate already covered that commit. MYN's
configured gates (`~/.overdeck/projects.yaml:109-133`) are `pnpm lint`,
`pnpm typecheck`, `pnpm build:ci` (all in `fe/`) and `./mvnw compile` (in
`api/`) — no test execution at all, not even `test-compile`.

**Proposed fix:** gate the skip on an explicit per-project
`verification_covers_tests: true` config key, defaulting to **false**. Where
false, emit `review.approved` and let the test role run.

**Verify:** Is the skip actually unsound, or does something else guarantee test
coverage that this analysis missed? Is a config flag the right shape, or would
deriving it from the gate definitions (e.g. a `kind: test` field per gate) be
better? What is the blast radius of defaulting to false across existing
projects — how many currently rely on this skip, and does turning it off
create a test-role dispatch storm?

### Claim 3 — a test agent that objects instead of POSTing `failed` is invisible

`src/lib/review-status.ts:463-470` fires `deliverTestFailureToWorkAgentHostSide`
only on the transition into `testStatus: 'failed'` or `'dispatch_failed'`. That
function (`:641`) writes a feedback file, messages the work agent with
`owesRework: true`, and falls back to `surfaceIssueFeedbackNeedsYou`.

The MIN-901 test agent wrote a paragraph refusing to report a verdict and
POSTed nothing. No transition, so no feedback file, no message, no needs-you
trip. The objection was only discovered because a human looked at the tab.

**Proposed fix:** when the test role's agent stops while `testStatus` is still
`testing` and no `.pan/test/result.json` exists for the current head anchor,
write `testStatus: 'dispatch_failed'` with the agent's last message as
`testNotes`, reusing the existing delivery door.

**Verify:** Does a path already exist that should have caught this (look for
`maybeRecoverTestVerdictHostSide` in `review-status.ts`, and any deacon patrol
for stalled test roles) — i.e. is this a missing feature or a broken existing
one? Is `dispatch_failed` semantically right, or does overloading it corrupt
retry/breaker accounting elsewhere? What prevents a false positive when an
agent stops for an unrelated reason mid-run?

### Claim 4 — the test-role prompt never tells the agent it is in a polyrepo

`buildTestRolePrompt` in `src/lib/cloister/test-agent-queue.ts:20-63` emits one
`WORKSPACE:` line and one `BRANCH:` line. Every git command run at that path
hits the wrapper repo. The review path already resolves roots properly at
`review-agent.ts:365` and `:548`.

**Proposed fix:** call `resolveWorkspaceRepoRootsSync(issueId, workspace)` in
the prompt builder; when `isPolyrepo`, emit a block listing each sub-repo
directory, branch, and head, plus an explicit statement that the workspace root
is a wrapper repo whose HEAD does not track the work. Extend
`src/lib/cloister/__tests__/test-agent-queue.test.ts` with a polyrepo case.

**Verify:** Is the prompt really the right place, or should the fix be
structural (e.g. the role's own `roles/test.md`, or making the agent's git
commands repo-aware)? Do other role prompts have the same gap — check the
work-agent and UAT prompts too and report any you find.

### Claim 5 — `roleRunHead` is wrapper-only, so zombie role-run detection is inert on polyrepos

`src/lib/agents/spawn.ts:463-470` stamps `git rev-parse --short=8 HEAD` at the
workspace root. `src/lib/cloister/service-reactive.ts:167-182` compares that
marker against another raw root read to decide whether a role run is stale. On
a polyrepo both reads return the never-moving wrapper head, so the check always
answers "still active".

**Proposed fix:** use `snapshotWorkspaceHeadsPromise` on both sides, dropping
`--short=8` since composite anchors are full SHAs.

**Verify:** Is the consequence stated correctly — does "always active" block
re-dispatch, or does some other path compensate? Does changing this interact
badly with Claim 1's fix (both make polyrepo drift newly visible — could the
combination cause a different loop or a dispatch storm)? Is there a stored
`role_run_head` DB column with existing short-SHA values that a format change
would silently invalidate?

## Cross-cutting questions

1. Claims 1 and 5 are both "PAN-2948 migrated some call sites and missed
   others". Search for every remaining place that reads a workspace HEAD with a
   raw `git rev-parse` and compares it to a stored anchor. **Report any sites
   beyond the two named here** — that list is more valuable than confirming
   the two we already have.
2. Is a CI guard (flagging `git rev-parse HEAD` with a workspace-path `cwd` in
   pipeline code) a proportionate response, or is there a better structural
   fix — e.g. making the anchor a typed value that cannot be passed to git as
   a ref?
3. Order these five by real-world severity and say which you would fix first
   and why. Disagree with the ordering above if you think it is wrong.

## Output

Write your findings to `/home/eltmon/Projects/hoff-k3-review/FEEDBACK-k3.md`
and also summarize them in the conversation. For each of the five claims give:

- **Verdict:** CONFIRMED / PARTIALLY CONFIRMED / REFUTED / CANNOT VERIFY
- **Evidence:** the specific file/line or command output you checked
- **Fix critique:** is the proposed fix correct, sufficient, and safe
- **What the analysis missed**, if anything

Then answer the three cross-cutting questions. Finish with your severity
ordering. Do not soften findings to be agreeable.
