# Overdeck Remodel — Review / Verification / Merge / Inspect State Field Audit

**Goal:** radical complexity reduction on a fresh empty DB. Keep only fields the
pipeline genuinely NEEDS ("NEED, not nice-to-have"). For each field: where it is
written, where it is read, whether a read actually BRANCHES on it, a verdict
(`KEEP` / `DROP` / `MERGE-INTO` / `DERIVE`), and a class for each KEEP
(DURABLE VERDICT vs EPHEMERAL REVIEW-RUN vs belongs-elsewhere).

Method: every field traced through its camelCase accessor across `src/`
(non-test), with the discriminator being **does any read drive control flow**
(an `if`/`filter`/gate/comparison), not whether the field is "touched".

**Headline counts:** 49 fields audited (39 `review_status` columns + 10 `agents`
review-run columns). **36 KEEP, 12 DROP, 1 DERIVE.** Of the 36 KEEP: 13 DURABLE
VERDICT, 19 EPHEMERAL REVIEW-RUN, 4 NEITHER (operator/runtime control). ~2,550
read+write matches across 154 files touch the `review_status` set, plus ~158
across 14 files for the agents-table set — that is the complexity surface the
DROP/DERIVE collapse gets to shrink.

## Glossary

- **Branch-read** — a read site that feeds an `if`/`filter`/`switch`/comparison
  that changes what the pipeline does. The opposite is a **display read** (value
  is only serialized to the frontend / activity feed) or a **pass-through**
  (copied into another record verbatim).
- **DURABLE VERDICT** — the issue's review/test/merge/inspect *outcome*; belongs
  in the per-issue permanent record (`.pan/<recordsPath>/<issue>.json`,
  `pipeline` block) and must survive a DB wipe.
- **EPHEMERAL REVIEW-RUN** — state of an in-flight review/test/merge run; pure
  cache, dies with the run, rebuildable.
- **Single write path** — almost every `review_status` column is written through
  one function: `upsertReviewStatusSync` in
  `src/lib/database/review-status-db.ts:30`, fed by `setReviewStatusSync`
  (`src/lib/review-status.ts:194`) and read back through `rowToReviewStatus`
  (`review-status-db.ts:443`). Targeted writers also exist:
  `markWorkspaceStuck` (498), `setDeaconIgnored` (529), `setAutoMerge` (569),
  `clearWorkspaceStuck` (591). "Written-at" below names the *semantic* writer,
  not this plumbing.
- **Durable mirror** — `src/lib/pan-dir/records.ts:80-111` (`projectPipeline`)
  copies a subset of `ReviewStatus` into the permanent record. Whatever it
  copies is the codebase's own DURABLE answer; whatever it drops is EPHEMERAL.

---

## Table 1 — `review_status`

| Field | Written-at (semantic) | Branch-read-at | What it drives | Verdict | Class |
| --- | --- | --- | --- | --- | --- |
| `issue_id` | upsert (PK, upper-cased) | every read keys on it | Row identity | **KEEP** | DURABLE VERDICT |
| `review_status` | review pipeline → setReviewStatus | `mergeGateEligibility` (review-status.ts:144); deacon gates; `fixStuckReadyForMerge` (515) | Core review outcome; gates merge eligibility | **KEEP** | DURABLE VERDICT |
| `test_status` | test pipeline | `mergeGateEligibility` (145); `fixStuckReadyForMerge` (520); deacon test patrol (2497) | Core test outcome; gates merge | **KEEP** | DURABLE VERDICT |
| `merge_status` | merge flow (workspaces.ts ~5016-5646), postMergeLifecycle | `mergeGateEligibility` (149 "already merged"); `clearStuckMergeStatuses` (483); `stuck-remediation.ts:35` | Merge outcome; `merged` is terminal | **KEEP** | DURABLE VERDICT |
| `verification_status` | verification-runner.ts (234,365,408,453) | `verificationSatisfied` (123) → `mergeGateEligibility` (148) | Blocks merge only when `'failed'` | **KEEP** | DURABLE VERDICT |
| `verification_notes` | verification-runner.ts | display only (activity feed, review-status.ts:359 — no `.includes` branch) | Human-readable verification failure text | **DROP** (fold into notes) | — |
| `verification_cycle_count` | verification-runner.ts (233,364,407) | **verification-runner.ts:194** `currentCycles >= VERIFICATION_MAX_CYCLES` — circuit breaker | Stops infinite verification re-runs | **KEEP** | EPHEMERAL REVIEW-RUN |
| `verification_max_cycles` | verification-runner.ts — always set to the constant `VERIFICATION_MAX_CYCLES = 10` (29) | **none server-side** — only frontend display (ReviewPipelineSection.tsx:178, PlanDAG.tsx:361) | A stored copy of a compile-time constant | **DROP** (DERIVE from constant) | — |
| `review_notes` | review pipeline | **deacon.ts:2058** `reviewNotes.includes('failing required checks')` — CI-failure branch | Substring-parsed to classify CI failure (fragile) | **KEEP-as-signal** — replace prose with a typed `failureReason` enum (ephemeral run state); keep at most one durable verdict-explanation field | EPHEMERAL REVIEW-RUN |
| `test_notes` | test pipeline; deacon strand marker (2487) | display only (activity feed, review-status.ts:401) | Human-readable test failure text | **DROP** (fold into one notes field) | — |
| `merge_notes` | merge flow | **deacon.ts:3652/3735/3880** `mergeNotes.includes(...)` — CI / timeout / push-failure branches | Substring-parsed to classify merge failure | **KEEP-as-signal** — replace prose with a typed `mergeFailureReason` enum (ephemeral run state) | EPHEMERAL REVIEW-RUN |
| `updated_at` | every upsert | `idx_review_status_updated`; ORDER BY; staleness UI | Ordering / "last changed" | **KEEP** | DURABLE VERDICT |
| `ready_for_merge` | workspaces.ts:3556 (`testStatus==='passed'`→true); ~30 merge-flow sites set false; deacon 3790 & 3952; recompute sweeps 497/532 | `WHERE ready_for_merge=1` (review-status-db.ts:233; resource-discovery; AwaitingMergePage) | "Awaiting merge" gate / list | **DERIVE** — `fixStuckReadyForMerge` (515) and `clearStuckMergeStatuses` (490) PROVE it is recomputable from `{review_status, test_status, verification_status, merge_status}` (identical to `mergeGateEligibility`). **Verified the two deacon `readyForMerge: true` setters (3790, 3952): both are failed-merge *recovery* paths that set `mergeStatus: 'pending'` alongside — i.e. they eagerly re-stamp the SAME derived value (review passed + test passed + verif≠failed + merge pending) after clearing a merge failure. Neither sets it outside the predicate.** Replace the column + `WHERE ready_for_merge=1` with the predicate; both repair sweeps and ~40 `readyForMerge: false` write sites go away. | — |
| `auto_requeue_count` | deacon auto-requeue path | **deacon.ts:3899** `autoRequeueCount >= 25` — dead-end breaker | Caps auto-requeue attempts | **KEEP** | EPHEMERAL REVIEW-RUN |
| `merge_retry_count` | deacon merge-retry path | **deacon.ts:3906** `>= FAILED_MERGE_MAX_RETRIES` — merge breaker | Caps merge retries | **KEEP** | EPHEMERAL REVIEW-RUN |
| `pr_url` | done.ts / merge flow / webhook | `getMergeBlockerReconcileCandidates` (231); flywheel-merge-order; conflict reconcile; many display | Identifies the PR to operate on | **KEEP** | DURABLE VERDICT |
| `pr_head_sha` | webhook-handlers.ts:390 | **webhook-handlers.ts:116** `headSha !== status.prHeadSha` — webhook identity validation | Rejects webhooks for a stale/foreign PR | **KEEP** | DURABLE VERDICT |
| `pr_number` | webhook / done | **flywheel-merge-order.ts:156**; **orphan-proposed-reconciler.ts:50** `prNumber != null`; webhook-handlers.ts:101 | PR identity; orphan reconcile | **KEEP** (could MERGE-INTO derive from `pr_url`) | DURABLE VERDICT |
| `stuck` | markWorkspaceStuck (498); deacon strand (2483) | **stuck-remediation.ts:35**; **deacon.ts:1006/1242** `if (stuck) skip patrol` | System failure marker; deacon skips stuck issues | **KEEP** | EPHEMERAL REVIEW-RUN (recoverable signal) |
| `stuck_reason` | markWorkspaceStuck | **deacon.ts:1041** `stuckReason === 'context_overflow'`; **deacon.ts:2482** `!== 'test_signal_strand'`; agents.ts:4989 | Distinguishes stuck *kinds* for targeted remediation | **KEEP** | EPHEMERAL REVIEW-RUN |
| `stuck_at` | markWorkspaceStuck | display only | Timestamp of stuck event | **DROP** (DERIVE/fold) | — |
| `stuck_details` | markWorkspaceStuck (JSON `{localSha,remoteSha}`) | display only (no parse for a branch found) | Diagnostic blob | **DROP** | — |
| `reviewed_at_commit` | review-pass path | **deacon.ts:3052/3078** `currentHead === reviewedAtCommit` → skip/re-review on new push; review-status.ts:449 | Detects commits pushed after review passed | **KEEP** | DURABLE VERDICT |
| `review_spawned_at` | review dispatch | **deacon.ts:2689/2691** `Date.parse(reviewSpawnedAt)` timeout | Review-dispatch timeout detection | **KEEP** | EPHEMERAL REVIEW-RUN |
| `conflict_resolution_dispatched_at` | conflict-gate dispatch | **conflict-gate.ts:262** `if (!conflictResolutionDispatchedAt) return false` — dedup | Prevents re-dispatching conflict resolver | **KEEP** | EPHEMERAL REVIEW-RUN |
| `test_retry_count` | deacon (2545/2551/2557) | **deacon.ts:2476** `retryCount >= 3` → surface stuck marker | Test re-dispatch breaker | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_retry_count` | deacon recovery path | **deacon.ts:2092** `>= REVIEW_INFRA_BREAKER_THRESHOLD` | Parallel-review re-dispatch breaker | **KEEP** | EPHEMERAL REVIEW-RUN |
| `recovery_started_at` | deacon (1941/2072) | **deacon.ts:1941/2072** history-cutoff for the breaker (`?? now`) | Scopes the breaker's failure window to current cycle | **KEEP** | EPHEMERAL REVIEW-RUN |
| `deacon_ignored` | setDeaconIgnored (529) | **stuck-remediation.ts:35**; **deacon.ts:1006/1242** `if (deaconIgnored) skip` | Human "pause this issue" toggle | **KEEP** | NEITHER — operator control flag, belongs with per-issue runtime control, not a review *verdict* |
| `deacon_ignored_at` | setDeaconIgnored | display only | Timestamp | **DROP** | — |
| `deacon_ignored_reason` | setDeaconIgnored | display only | Free-form reason | **DROP** | — |
| `blocker_reasons` | webhook-handlers (242,252); mutateBlockers | **getMergeBlockerReconcileCandidates** (`LIKE '%merge_conflict%'`, 234); **conflict-gate.ts:160/168** `filter(isMergeBlocker)`; webhook | Drives merge-conflict reconcile + conflict gate | **KEEP** | DURABLE VERDICT |
| `last_verified_commit` | verification gate pass | **deacon.ts:2710** `headSha !== lastVerifiedCommit` → re-verify; review-status.ts:448; deacon `isReviewSpawnStale` (2686) | Skips redundant test-agent when commit already verified | **KEEP** | DURABLE VERDICT |
| `merge_step` | merge flow granular progress | **none server-side** — frontend display only (ProjectOverview.tsx:678, AwaitingMergePage.tsx:325) | Granular merge-progress label | **DROP** (DERIVE from `merge_status`) | — |
| `inspect_status` | inspect-agent | **deacon.ts:738** `if (inspectStatus !== 'inspecting') continue` | Inspect outcome / patrol gate | **KEEP** | DURABLE VERDICT |
| `inspect_notes` | inspect-agent | display only | Inspect failure text | **DROP** (fold into notes) | — |
| `inspect_started_at` | inspect-agent | display only (no timeout branch found) | Timestamp | **DROP** | — |
| `inspect_bead_id` | inspect-agent | **written, never consumed for a decision** (zero branch-reads; no `bd close`/lookup use) | None | **DROP** | — |
| `auto_merge` | setAutoMerge (569) | **auto-merge-eligibility.ts:111** `autoMerge === false` → hold for UAT | Per-issue merge-train routing | **KEEP** | NEITHER — routing policy, belongs with per-issue config not review verdict |

> **`uat_status` is NOT a `review_status` column** (so it is excluded from the
> 39-column count above). It is typed on the `ReviewStatus` interface and read
> in the `readyForMerge` recompute (`fixStuckReadyForMerge` 526,
> `clearStuckMergeStatuses` 494), but there is no `uat_status` column, no
> upsert binding, and `rowToReviewStatus` never restores it — so after any DB
> round-trip it is always `undefined`, which the gate treats as "pass". Net:
> there is a UAT gate input that is **not actually persisted or enforced
> through `readyForMerge`**. If UAT is a real gate it needs a real home; if it
> isn't, the recompute branches referencing it are dead. Flagged, not counted.

### Phantom columns listed in the task that do NOT exist

| Listed | Reality |
| --- | --- |
| `reviewer_verdicts` | **Not a `review_status` column.** No CREATE TABLE entry, no migration, not in `DbReviewStatusRow`, not in the `ReviewStatus` interface. Exists ONLY as `reviewerVerdicts?: unknown` on the durable `PanIssuePipelineRecord` (record.ts:83), passed through at records.ts:110 via a cast that reads a property the source type doesn't even declare — so it is **always `undefined`** in practice. Dead pass-through. **DROP.** |
| `lifetime_auto_requeue_count` | **Does not exist anywhere in code.** Zero hits in `src/` or `tests/`. Only mention is in two docs: `docs/panopticon-db-erd.excalidraw` and `docs/STATE-STORAGE-AUDIT.md`. The ERD diagram and the task field-list are stale. **N/A — nothing to drop.** |

---

## Table 2 — `agents` table review-orchestration columns

These are review-RUN state bleeding into the `agents` table. All are read by the
deacon's review monitor *during* a live review run.

| Field | Written-at | Branch-read-at | What it drives | Verdict | Class |
| --- | --- | --- | --- | --- | --- |
| `review_run_id` | review-agent.ts:275 | **deacon.ts:5983/5995/6041/6074** — locates `.pan/review/<runId>/` synthesis dir, dedup nudge key, staleness check (2764) | Which review run's reports to read/synthesize | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_synthesis_agent_id` | review-agent.ts:270/277; agents.ts:3455 | **deacon.ts:5999/6158** — who to signal/nudge/kill for synthesis | Identifies the synthesis agent to drive | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_output_path` | review-agent (per-sub-role) | **deacon.ts:5973/6176** — where the reviewer wrote its report | Path the monitor reads the verdict from | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_deadline_at` | review-agent.ts:278 (`now + REVIEWER_TIMEOUT_MS`) | **deacon.ts:6186** `Date.parse` past-deadline; 6248/6257 reason | Reviewer timeout / wedge detection | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_monitor_signaled` | deacon.ts:6276 | **deacon.ts:6159** `if (reviewMonitorSignaled) continue` — once-only dedup | Stops re-signaling a completed reviewer | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_retry_attempt` | deacon.ts:6013 | **deacon.ts:6237** `if (attempt < 1)` respawn idle reviewer once | Idle-reviewer single-retry gate | **KEEP** | EPHEMERAL REVIEW-RUN |
| `review_sub_role` | review-agent convoy spawn | **deacon.ts:5684/5983/6031/6158/6268** — sub-role routing for synthesis + signal text | Tags which convoy lane this agent is | **KEEP** | EPHEMERAL REVIEW-RUN |
| `inspect_sub_role` | inspect-agent.ts:253 | costs/reconciler.ts (cost attribution); spawn tag | Cost/session-type attribution only — no live decision branch found | **DROP** (DERIVE from agent-dir name regex, which reconciler already does at reconciler.ts:140) | — |
| `flywheel_run_id` | agents.ts:3293 (spawn env) | **concurrency.ts:191** `filter(a => a.flywheelRunId)` — counts flywheel-spawned work for slot accounting | Concurrency slot accounting | **KEEP** | NEITHER — general agent-runtime field (concurrency), not review-run state; keep with agent runtime |
| `role_run_head` | agents.ts:3547 | **service.ts:232** compares stamped HEAD vs current workspace HEAD (staleness) | Detects whether a role run is stale vs new commits | **KEEP** | NEITHER — general agent-runtime field (staleness), not review-specific; keep with agent runtime |

---

## Surprises

1. **`ready_for_merge` is a derivable cache that the codebase already recomputes
   — twice.** `fixStuckReadyForMerge` and `clearStuckMergeStatuses` both rebuild
   it from `{review_status, test_status, verification_status, merge_status}` —
   exactly `mergeGateEligibility`'s inputs. All five `readyForMerge: true`
   setters were checked: workspaces.ts:3556 (`test=passed`), the two sweeps, and
   the two deacon recovery paths (3790, 3952) — every one is inside the predicate
   (the deacon ones pair it with `mergeStatus: 'pending'`, re-stamping the same
   derived value after a merge failure). Nothing writes `true` outside the
   predicate, so DERIVE is safe. The column drifts often enough that two startup
   repair sweeps exist purely to fix it. Dropping it and replacing
   `WHERE ready_for_merge=1` with the predicate removes the column, both repair
   sweeps, and ~40 `readyForMerge: false` write sites.

   **Corollary UAT surprise:** the recompute predicate also references
   `uat_status`, which is NOT a persisted column — `rowToReviewStatus` never
   restores it, so post-round-trip it is always `undefined` (treated as "pass").
   There is a UAT gate input that is not actually enforced through
   `readyForMerge`. Either give UAT a real persisted home or delete the dead
   recompute branches.

2. **Two of the "columns" in the task list do not exist.** `reviewer_verdicts`
   is a durable-record field (always `undefined` in practice — a dead cast),
   not a `review_status` column. `lifetime_auto_requeue_count` exists **only in
   the ERD diagram and a stale audit doc** — there is no such column or code.
   The `docs/panopticon-db-erd.excalidraw` field list is out of date.

3. **`inspect_bead_id` is written but never read** — zero consumers anywhere.
   Pure dead weight.

4. **`merge_step` and `verification_max_cycles` are server-write-only display
   props.** `merge_step` is derivable from `merge_status`; `verification_max_cycles`
   is a stored copy of the compile-time constant `VERIFICATION_MAX_CYCLES = 10`.
   Neither drives any server branch.

5. **The prose-notes columns are mostly display, but two are load-bearing via
   fragile substring matching.** `review_notes.includes('failing required
   checks')` and three `merge_notes.includes(...)` checks classify CI / timeout
   / push failures. This is brittle (string-sniffing a free-text field for
   control flow) and should ideally become a typed failure-reason enum rather
   than a kept prose column. `test_notes`, `verification_notes`, `inspect_notes`
   are display-only and can collapse into a single notes field.

6. **Retry-count theater is minimal — most counters are real breakers.**
   `verification_cycle_count` (≥10), `auto_requeue_count` (≥25),
   `merge_retry_count` (≥max), `test_retry_count` (≥3), `review_retry_count`
   (≥threshold), `review_retry_attempt` (<1) all gate a real abort. The only
   counter-like field with no comparison is `verification_max_cycles` (a stored
   constant). The counters are EPHEMERAL though — they belong to the recovery
   cycle, not the durable verdict, and reset on `recovery_started_at`.

7. **Timestamps split cleanly.** The ones a comparison parses
   (`review_spawned_at`, `review_deadline_at`, `conflict_resolution_dispatched_at`,
   `recovery_started_at`, `reviewed_at_commit`/`last_verified_commit` as SHAs)
   are KEEP. The ones that are only displayed (`stuck_at`, `inspect_started_at`,
   `deacon_ignored_at`) are DROP.

8. **`deacon_ignored` and `auto_merge` are not review verdicts** — they are
   operator/policy control flags that happen to live in `review_status`. In the
   remodel they belong with per-issue runtime control / merge-train config, not
   the durable review outcome.
