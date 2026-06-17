# Overdeck Remodel — Minimum Gate Set

**Goal:** identify the **minimum set of pipeline gates** the Overdeck remodel must
keep to preserve every real block on an issue's advance toward merge. A "gate" is
a pass/fail checkpoint that *blocks* an issue from advancing. For each gate this
doc names: what produces the verdict, where the verdict actually blocks (file:line),
a classification (REDUNDANT / VESTIGIAL / LOAD-BEARING), and what is lost if dropped.

This corrects and extends `review-state-audit.md`, which audited *fields*; this
doc audits the *gating decisions* those fields drive.

## Glossary

- **Gate** — a pass/fail checkpoint whose FAIL branch stops an issue from advancing
  toward (or through) merge. The discriminator is a real control-flow block, not a
  status that is merely displayed.
- **Merge-gate predicate** — `mergeGateEligibility(status)` in
  `src/lib/review-status.ts:140`. The single authoritative "allowed to merge" check;
  inputs are `{reviewStatus, testStatus, verificationStatus, mergeStatus}`.
- **`readyForMerge`** — a derived boolean recomputed in-memory on every status write
  (`setReviewStatusSync`, `review-status.ts:282-295`) from the same gate inputs plus
  `uatStatus` and `blockerReasons`. It is the column the "Awaiting Merge" list and
  `isAutoMergeEligible` read.
- **Auto-merge predicate** — `isAutoMergeEligible(issueId)` in
  `src/lib/cloister/auto-merge-eligibility.ts:99`. The flywheel/auto-merge executor's
  pre-merge check; layers live GitHub PR state and blocker labels on top of
  `readyForMerge`.
- **Verification gate** — `runVerificationForIssue` in
  `src/lib/cloister/verification-runner.ts`. Runs branch-sync + project quality gates
  + vBRIEF AC-completion. Invoked at TWO points: pre-review (request-review) and
  post-rebase (merge time).
- **Test role** — the `test` pipeline agent (`roles/test.md`,
  `src/lib/cloister/test-agent-queue.ts:19`). Runs project quality gates AND browser
  UAT (Playwright) when acceptance criteria require it.
- **Inspect** — per-bead quality gate during the WORK phase, conditional on
  `metadata.requiresInspection`. Not on the merge path.

---

## The merge-gate funnel (where every block converges)

Three enforcement sites all read the same two predicates. Understanding this funnel
is the key to the minimum set:

1. **Queue assembly** — `computeMergeQueue` (`src/lib/flywheel-merge-order.ts:163`)
   filters verb-tagged issues through `reviewRecordEligibility` →
   `mergeGateEligibility` (`flywheel-merge-order.ts:142`, `:169-178`). Feeds the
   flywheel merge queue and the UAT train's `getReadySet`
   (`src/dashboard/server/services/uat-train.ts:63-84`).
2. **Auto-merge** — `isAutoMergeEligible` (`auto-merge-eligibility.ts:99`), called by
   `flywheel.ts:321` and `auto-merge-executor.ts:92`. Reads `readyForMerge` +
   `autoMerge` + live GitHub PR state + blocker labels.
3. **UAT promotion** — when a human promotes a UAT batch, `promoteUatGeneration` is
   passed `memberEligibility: reviewRecordEligibility`
   (`uat-train.ts:298`) → each member re-checked through `mergeGateEligibility`.
4. **The actual merge** — `triggerMerge` (`workspaces.ts:4892`) re-runs verification
   post-rebase as the final authoritative gate (`workspaces.ts:5531-5567`).

So `mergeGateEligibility` is the chokepoint, `readyForMerge` is its cached mirror,
and `isAutoMergeEligible` adds the GitHub-truth layer. Everything else either feeds
these inputs or is off the merge path entirely.

---

## Gate-by-gate

### 1. REVIEW gate — LOAD-BEARING

**Produces pass/fail.** The `review` pipeline agent posts its verdict to
`/api/review/:id/status`; `specialists.ts:385-388` maps it:
`reviewStatus = status === 'passed' ? 'passed' : 'blocked'`. The parallel review
convoy's synthesis writes the same field.

**Where it blocks.**
- `mergeGateEligibility` (`review-status.ts:144`):
  `if (status.reviewStatus !== 'passed') return { eligible: false, reason: ... }`.
  This is the first hard gate in the predicate — nothing merges without a passed
  review.
- `readyForMerge` derivation (`review-status.ts:283`): `reviewStatus === 'passed'`
  is a required conjunct.
- Deacon test patrol (`deacon.ts:2461`): `if (status.reviewStatus !== 'passed')
  continue` — test dispatch is gated behind review passing (review precedes test).

**Classify: LOAD-BEARING.** No other gate provides "a human-or-agent code review
approved this change." Unique block.

**Gate-freshness re-trigger (keep with this gate).** `reviewedAtCommit` is the HEAD
SHA at review pass; the deacon re-opens review when a new commit lands after approval
(`deacon.ts:3052/3078`: `currentHead === reviewedAtCommit` → skip; otherwise
re-review). Without it, a commit pushed *after* review passed would merge unreviewed.
Not a separate gate — gate machinery; preserve it *with* the review gate.

**Lost if dropped.** Code review entirely — the pipeline would merge unreviewed
diffs. Non-negotiable.

---

### 2. TEST gate — LOAD-BEARING (with a redundant slice)

**Produces pass/fail.** The `test` role posts `{testStatus: 'passed'|'failed'}`
(`test-agent-queue.ts:48-54`, mapped at `specialists.ts:390-393`). On `passed` the
status route also sets `readyForMerge = true` (`workspaces.ts:3553-3557`).

**What the test role actually runs** (`test-agent-queue.ts:34-55`, `roles/test.md`):
1. Project quality gates — "typecheck, lint, and tests when present/applicable"
   (`:40`). **This overlaps verification.**
2. **Browser UAT via Playwright MCP**, conditional on acceptance criteria / UI
   wording (`:41-43`). **This is unique — verification has no browser path.**

**Where it blocks.**
- `mergeGateEligibility` (`review-status.ts:145-147`):
  `if (status.testStatus !== 'passed' && status.testStatus !== 'skipped')` → not
  eligible.
- `readyForMerge` derivation (`review-status.ts:284`).

**Classify: LOAD-BEARING overall; the quality-gate slice is REDUNDANT with
verification.** The browser-UAT capability is a unique block nothing else provides.
The typecheck/lint/test slice duplicates what verification already ran pre-review.

**Lost if dropped.** End-to-end UI proof (Playwright UAT) for issues whose
acceptance criteria demand it. The quality-gate slice is *not* lost if test is
dropped — verification covers it — but the browser UAT is.

---

### 3. VERIFICATION gate — LOAD-BEARING (NOT redundant — corrects the audit)

**Produces pass/fail.** `runVerificationForIssue` →
`runVerificationForIssuePromise` (`verification-runner.ts:185`). Sets
`verificationStatus` to `running` / `passed` / `failed` / `skipped`
(`:201, :231, :360, :489, :197`).

**What it runs** (three checks, in order):
1. **Branch-sync** — merges the target branch into the workspace
   (`verification-runner.ts:208-269`). A merge conflict here is a FAIL
   (`:224-258`). **Unique — neither test nor CI does this.**
2. **Project quality gates** — typecheck/lint/test from `projects.yaml`
   (`:344-390`). **Overlaps the test role.**
3. **vBRIEF AC-completion** — every acceptance criterion's bead must be closed
   (`:392-478`). Incomplete AC is a FAIL (`:433-477`). **Unique — this is the only
   gate that blocks on "the plan's acceptance criteria are not all done."**

**Where it blocks.** Two distinct enforcement points:
- **Pre-review gate** (`workspaces.ts:4203-4218`, the `request-review` handler):
  a `failed` outcome returns `{success:false, verificationFailed:true}` and the
  review agent is never dispatched. Verification must pass before review runs.
- **Post-rebase gate at MERGE time** (`workspaces.ts:5531-5567`, inside
  `triggerMerge`): `runVerificationForIssue(..., { syncTargetBranch: false })`
  re-runs the quality gates AFTER the branch is rebased onto current main. A
  `failed` outcome sets `mergeStatus: 'failed'`, `readyForMerge: false`, comments
  the PR, and aborts the merge (`:5547-5566`). **This is the gate the code itself
  calls authoritative** (`review-status.ts:122`, `:273-276`: "The post-rebase gate
  in `triggerMerge()` is the authoritative quality gate").
- `verificationSatisfied` (`review-status.ts:117-124`) → `mergeGateEligibility`
  (`:148`): nominally blocks the merge predicate when `verificationStatus === 'failed'`
  — **but this conjunct is shadowed and likely never fires independently.** Every one
  of the five verification-failure writes also sets `reviewStatus: 'pending'`
  (`verification-runner.ts:229-231, :360-362, :403-405, :448-450, :512-514`), so
  `mergeGateEligibility` already returns ineligible at line 144
  (`reviewStatus !== 'passed'`) *before* reaching line 148. No writer sets
  `verificationStatus='failed'` while leaving `reviewStatus='passed'`. **Consequence
  for the remodel: verification's teeth are in its two CALL SITES (the request-review
  dispatch gate at `workspaces.ts:4209` and the authoritative `triggerMerge`
  post-rebase gate at `:5547`), NOT in the `verificationStatus` predicate field.**
  Preserve the two call sites; the predicate field is redundant with the reviewStatus
  reset and need not be a `mergeGateEligibility` input.
- Circuit breaker: `verificationCycleCount >= VERIFICATION_MAX_CYCLES (10)`
  (`verification-runner.ts:194`) stops infinite re-verification.

**Gate-freshness re-trigger (keep with this gate).** `lastVerifiedCommit` is the HEAD
SHA at verification pass; the deacon re-verifies when a new commit lands
(`deacon.ts:2710`: `headSha !== lastVerifiedCommit` → re-verify). Without it, a commit
pushed after verification passed would merge unverified. It is not a separate gate but
gate machinery — preserve it *with* verification.

**Classify: LOAD-BEARING.** The review-state audit hypothesized verification
"appears to overlap test." **That is only true of the quality-gate slice (check 2).**
Verification carries THREE unique blocks test does not:
- **Branch-sync conflict detection** (check 1) — pre-review.
- **vBRIEF AC-completion** (check 3) — the only enforcement that all acceptance
  criteria are actually closed.
- **The post-rebase re-run at merge time** — catches semantic breakage introduced
  by rebasing onto a moved main, which neither the pre-rebase test verdict nor
  branch CI can see (they ran against the old base).

**Lost if dropped.** (a) Merge would proceed on a branch with unresolved
target-branch conflicts. (b) Issues could merge with incomplete acceptance criteria.
(c) The authoritative post-rebase safety net vanishes — a green branch that breaks
once rebased onto current main would merge broken. The audit's "redundant with test"
verdict is **incorrect for the gate as a whole.**

---

### 4. INSPECT gate — LOAD-BEARING within the WORK phase; OFF the merge path

**Produces pass/fail.** Spawned per-bead when `metadata.requiresInspection === true`
(`vbrief/beads.ts:394-403`; CLI `pan inspect` `cli/commands/inspect.ts:102`; dashboard
`issues.ts:3030`). On spawn, `inspectStatus = 'inspecting'`
(`inspect-agent.ts:167-172`). The verdict is posted to the inspect specialist done
route (`specialists.ts:399-402`) which sets `inspectStatus` to `passed`/`failed`, and
`onInspectComplete` (`inspect-agent.ts:271-286`) saves a per-bead checkpoint on pass /
logs on fail.

**Where it blocks — and where it does NOT.**
- `inspectStatus` is **NOT an input to `mergeGateEligibility`** (`review-status.ts:140`,
  `:281-295` — `uatStatus` is there, `inspectStatus` is not). Inspect never blocks
  merge.
- The only server-side branch-read of `inspectStatus` is the deacon **timeout
  watchdog** (`deacon.ts:738`): `if (status.inspectStatus !== 'inspecting') continue`
  — this selects live inspections to time out, not a merge gate.
- The real block is **intra-work**: a `failed` inspection sends feedback to the work
  agent and saves no checkpoint (`inspect-agent.ts:283-285`); the work agent is
  expected to fix the bead before proceeding. It is a per-bead quality gate inside
  the work phase, gating the agent's own progress — not the pipeline's advance.

**`inspect_bead_id` correction to the audit.** The audit called `inspect_bead_id`
"written, never consumed for a decision … DROP." Precise correction: it is **read** by
the timeout watchdog (`deacon.ts:741`, `:746`, `:759`) to build the inspect session
name and the error verdict message. It drives no *gate* decision, but it is not dead —
dropping it blinds the watchdog's session-kill and messaging. So: not a gating input
(audit is right about that), but it has a live non-gating consumer.

**Inspect checkpoints are diagnostic, not enforcing.** `saveCheckpoint`/`loadCheckpoints`
(`inspect-checkpoints.ts:71-96`) record per-bead pass markers, but the `getDiffBase`
actually used by the inspector (`inspect-checkpoints.ts:136-148`, called at
`inspect-agent.ts:114`) computes the diff base as `git rev-parse HEAD^` — it does NOT
read the checkpoint file. No consumer hard-blocks on a missing checkpoint. So a failed
inspection's "no checkpoint saved" has no downstream enforcement beyond the work
agent's own feedback loop.

**Classify: LOAD-BEARING within the work phase only.** It provides a unique
per-bead deep-review block, but it is entirely off the merge-advancement path.

**Lost if dropped from the merge path.** Nothing — it is not on the merge path.
Lost if dropped from the work phase: the optional per-bead inspection of high-risk
beads (foundation work). That capability is opt-in (`requiresInspection`), so it
matters only for projects/plans that enable it.

---

### 5. UAT gate (`uatStatus`) — VESTIGIAL as a persisted gate; the UAT *train* is the real surface

This is the audit's headline finding, **confirmed**.

**Produces pass/fail.** A `uat` specialist verdict posts
`{uatStatus, readyForMerge: true on pass}` (`specialists.ts:404-410`).

**Where it would block — but does not persist.**
- `uatStatus` is referenced in three in-memory recompute predicates: the
  `setReviewStatusSync` derivation (`review-status.ts:286`), `fixStuckReadyForMerge`
  (`:526`), and `clearStuckMergeStatuses` (`:494`) — all treat
  `undefined || 'passed'` as "pass."
- **But `uat_status` is NOT a `review_status` column.** The CREATE TABLE
  (`schema.ts:213-266`) has no `uat_status`; the upsert binds none
  (`review-status-db.ts:40-144`); `rowToReviewStatus` restores none (`:443-465`).
  So after any DB round-trip `uatStatus` is always `undefined`, which every predicate
  treats as pass.
- Net: a `uat=failed` verdict forces `readyForMerge=false` **only within the same
  in-process write** (`review-status.ts:286`), then evaporates on the next read. There
  is **no durable UAT block through `readyForMerge` or `mergeGateEligibility`**
  (`mergeGateEligibility` doesn't reference `uatStatus` at all).

**Classify: VESTIGIAL** as a persisted gate. The `uatStatus` field is a never-enforced
consumer — its block does not survive a DB read, and the authoritative merge predicate
ignores it.

**The real UAT surface is the UAT batch train, which is separate and intact.** Issues
held for UAT are routed by `autoMerge === false` (`auto-merge-eligibility.ts:108-113`):
those issues are NOT auto-merged; they ride the UAT train assembled by
`runUatTrainReconcile` (`uat-train.ts:122`) and ship only when a human promotes the
batch (`postUatGenerationPromotePayload`, `uat-train.ts:287`), which re-applies
`mergeGateEligibility` per member (`:298`). So UAT-as-human-batch-review is real and
load-bearing; UAT-as-`uatStatus`-field is dead.

**Lost if dropped (`uatStatus` field).** Nothing real — it never durably blocked.
The audit's "treated as pass → not enforced" is correct.

---

### 6. AUTO-MERGE GitHub-state gate — LOAD-BEARING (the "+ anything else")

Distinct from the internal test/verification gates: `isAutoMergeEligible`
(`auto-merge-eligibility.ts:99-178`) layers **live GitHub PR truth** on top of
`readyForMerge` before auto-merge fires.

**Where it blocks** (`auto-merge-eligibility.ts:151-168`):
- `prState.merged` → already merged; `prState.state === 'CLOSED'` → closed;
  `prState.draft` → draft PR;
- `prState.checksFailed` → **CI checks failing on PR HEAD** (`:160`);
- `prState.checksPending` → **CI checks still pending** (`:163`);
- `prState.mergeable === false` → **PR not mergeable / conflicts** (`:166`).

**Classify: LOAD-BEARING.** This is a separate gate from the internal `testStatus` —
it reflects GitHub's own required-status-checks and mergeability, which the internal
verdict cannot. Only fires on the auto-merge path (not the human MERGE button, which
goes straight to `triggerMerge`).

**Lost if dropped.** Auto-merge would fire on PRs with failing/pending CI, drafts,
or conflicts — merging before GitHub's own gates are satisfied.

---

### 7. BLOCKER-LABEL / blocker-reason gate — LOAD-BEARING (the "+ anything else")

Two related blocks the five-gate framing omits:

**Blocker reasons (`blockerReasons`).** Set from GitHub-native merge blockers
(webhook handlers; `mutateBlockers`). They **force `readyForMerge = false`** in the
derivation regardless of gate state: `const hasBlockers = (merged.blockerReasons?.length
?? 0) > 0; readyForMerge = hasBlockers ? false : ...` (`review-status.ts:281, :291-292`).
Also drive merge-conflict reconcile (`getMergeBlockerReconcileCandidates`, the conflict
gate `conflict-gate.ts:160/168`).

**Blocker labels.** `isAutoMergeEligible` rejects when the issue carries any of
`BLOCKER_LABELS = ['needs-design', 'needs-discussion', 'do-not-merge']`
(`auto-merge-eligibility.ts:11, :171-175`).

**Classify: LOAD-BEARING.** Unique operator/GitHub-driven override that hard-stops
merge independent of review/test/verification.

**Lost if dropped.** `do-not-merge` and conflict markers would no longer hold an
otherwise-ready issue out of merge.

---

## Proposed MINIMUM gate set

The minimum set that preserves **every real block today**. Each entry names the exact
block it preserves.

| # | Gate | Exact block preserved (file:line) |
| --- | --- | --- |
| 1 | **Review** | `mergeGateEligibility` requires `reviewStatus === 'passed'` (`review-status.ts:144`); test dispatch gated on review passed (`deacon.ts:2461`). |
| 2 | **Test** | `mergeGateEligibility` requires `testStatus ∈ {passed, skipped}` (`review-status.ts:145`); the role's **browser-UAT (Playwright)** capability (`test-agent-queue.ts:41-43`) is the unique block. |
| 3 | **Verification** (preserve the two CALL SITES, not the predicate field) | (a) pre-review branch-sync conflict + AC-completion block, gating review dispatch (`verification-runner.ts:224-258`, `:433-477`; `workspaces.ts:4209`); (b) **authoritative post-rebase gate at merge time** (`workspaces.ts:5539-5567`). The `verificationStatus==='failed'` predicate conjunct (`review-status.ts:148`) is shadowed by the `reviewStatus:'pending'` co-write and is **not** a required `mergeGateEligibility` input. Keep `lastVerifiedCommit` freshness re-trigger (`deacon.ts:2710`). |
| 4 | **Auto-merge GitHub-state** | `isAutoMergeEligible` CI/draft/mergeable checks (`auto-merge-eligibility.ts:151-168`). |
| 5 | **Blocker labels + blocker reasons** | `BLOCKER_LABELS` reject (`auto-merge-eligibility.ts:171-175`); `blockerReasons` force `readyForMerge=false` (`review-status.ts:281, :291`). |

Plus the two predicates that aggregate them — `mergeGateEligibility`
(`review-status.ts:140`) and `isAutoMergeEligible` (`auto-merge-eligibility.ts:99`) —
and the `readyForMerge` mirror (or its replacement; see review-state-audit's DERIVE
recommendation).

**This is five gates, down from the seven surfaces named in the task** (review, test,
verification, inspect, UAT, + GitHub-state, + blocker-labels). The two dropped are
inspect (off the merge path) and the `uatStatus` field (never persisted). The
GitHub-state and blocker-label gates were not in the original five but are real and
must be kept.

---

## NICE-TO-HAVE set (optional — why each is optional)

| Gate | Why optional |
| --- | --- |
| **Inspect (per-bead, work phase)** | Opt-in via `metadata.requiresInspection` (`vbrief/beads.ts:394-403`); default policy is `never`/false. It blocks a single bead's work-phase progress, never merge. A plan with no `requiresInspection` beads never invokes it. Valuable for high-risk foundation beads; inert otherwise. |
| **`uatStatus` field as a gate** | Never durably enforced (no column, no restore — `schema.ts:213-266`, `review-status-db.ts:443-465`). The *real* UAT review is the batch train (`uat-train.ts`), routed by `autoMerge===false`, gated by human promotion + `mergeGateEligibility` re-check (`uat-train.ts:298`). The field can be deleted with zero loss of enforcement; the train is the load-bearing UAT surface and is independent of the field. |
| **Verification's quality-gate slice (check 2 in isolation)** | Redundant with the test role's quality gates. But it **cannot be split out** — it rides inside the same `runVerificationForIssue` run that also does branch-sync and AC-completion, and it is the *only* check at the authoritative post-rebase merge gate. Optional only in the sense that "verification's typecheck/lint/test overlaps test's"; you cannot drop the slice without dropping the gate. |

---

## Drop list — what is safe to drop, and where its block moves

| Dropped | Safe because | Does its block need a new home? |
| --- | --- | --- |
| **`uatStatus` field / `uat` specialist verdict** | No `uat_status` column exists; the field is `undefined` after every DB read and treated as pass by all three recompute predicates (`review-status.ts:286, :494, :526`); `mergeGateEligibility` never references it. The block never existed durably. | **No.** Real UAT is the batch train (`uat-train.ts`), gated by `autoMerge===false` routing + human promotion + per-member `mergeGateEligibility`. That surface stays. If a *persisted* UAT verdict is ever wanted, it would need a real column + a `mergeGateEligibility` conjunct — but that is new functionality, not preservation. |
| **Inspect from the merge path** | `inspectStatus` is not an input to `mergeGateEligibility` or `readyForMerge` (`review-status.ts:140, :281-295`). It never blocked merge. | **No** (merge path). Keep inspect as the work-phase per-bead gate if `requiresInspection` projects matter; its only enforcement is the work agent's own feedback loop + the timeout watchdog (`deacon.ts:732-791`). |
| **`inspect_bead_id` as a "gating field"** | It drives no gate decision (audit is right). | **Partial correction:** it is still *read* by the timeout watchdog for session-naming and messaging (`deacon.ts:741, :746, :759`). Drop only if inspect's watchdog is also reworked; it is not pure dead weight. |
| **Verification's quality-gate slice (as an independent gate)** | Overlaps the test role's typecheck/lint/test. | **Cannot be dropped independently** — it is the only check at the authoritative post-rebase gate (`workspaces.ts:5539`). Dropping verification entirely would orphan branch-sync conflict detection, AC-completion, and the post-rebase safety net, which have **no other home**. Do not drop verification. |

---

## Surprises

1. **Verification is the authoritative gate, not a redundant one — the audit's
   overlap hypothesis is half-wrong.** `triggerMerge` re-runs `runVerificationForIssue`
   post-rebase (`workspaces.ts:5531-5567`) as the final block before merge, and the
   code comments name it authoritative (`review-status.ts:122, :273-276`). Only the
   typecheck/lint/test *slice* overlaps the test role; verification's branch-sync,
   AC-completion, and post-rebase re-run are unique and load-bearing. Dropping
   verification as "redundant with test" would silently remove the only gate that
   catches post-rebase breakage and incomplete acceptance criteria.

2. **The UAT field is dead, but UAT is not.** `uatStatus` confirmed non-persisted
   (no column, no upsert, no restore) and ignored by `mergeGateEligibility` — yet the
   UAT *batch train* is a fully separate, live surface gated by `autoMerge===false`
   routing and human promotion with a per-member `mergeGateEligibility` re-check
   (`uat-train.ts:298`). Anyone reading the audit's "UAT isn't enforced" must not
   conclude "UAT is gone" — the train is the real gate. Two different things share the
   name "UAT."

3. **Inspect's verdict is invisible to the merge gate.** Despite being one of the five
   named gates, `inspectStatus` never appears in `mergeGateEligibility` or
   `readyForMerge`. Its only server-side branch is a timeout watchdog. Inspect is a
   work-phase per-bead gate, not a merge gate — a category error in the original
   framing.

4. **The minimum set is FIVE, but two of them weren't in the original five.** The
   task's five (review, test, verification, inspect, UAT) reduce to three on the merge
   path (review, test, verification) once inspect and `uatStatus` are removed — but
   two *unnamed* gates (GitHub-state via `isAutoMergeEligible`, blocker-labels/reasons)
   are real merge blocks that must be added. Net minimum: review, test, verification,
   GitHub-state, blocker-labels.

5. **`mergeGateEligibility` is the single chokepoint and it is already factored.**
   Queue assembly, UAT promotion, and the `readyForMerge` derivation all route through
   it or its exact predicate. The remodel can treat it as the one canonical "allowed to
   merge" function and `isAutoMergeEligible` as the one "GitHub agrees" wrapper —
   everything else feeds their inputs.

6. **`inspect_bead_id` is not fully dead.** Correcting the audit: it has a live
   non-gating consumer (the timeout watchdog's session name + verdict message). It
   drives no gate, but dropping it blinds the watchdog.
