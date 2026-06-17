# Pipeline Transitions — Full Audit

> Evidence base for the Overdeck remodel
> ([PAN-1938](https://github.com/eltmon/panopticon-cli/issues/1938)).
> **Question:** What are the canonical pipeline stages, and every way an
> issue/agent moves between them?
> **Method:** `git grep` / `rg` over `src/`, production code only
> (`__tests__/` and `*.test.ts` excluded). Line numbers checked at writing
> time (2026-06-16, `main` @ `840117fadc`); where a number may drift the
> anchor symbol is quoted so it can be re-grepped.

---

## Glossary

- **Stage** — a human-meaningful pipeline position (e.g. "in review"). It is
  **not a column.** There is no single `stage` field anywhere. A stage is a
  *composite read* across ~8 independent enums + GitHub labels + side-flags
  (see §1).
- **Store** — a physical place a status value is persisted. Six exist:
  GitHub labels/issue-state, SQLite `review_status`, SQLite `agents`, SQLite
  `status_history` (append-only log), SQLite `events` (append-only log),
  `.pan/<recordsPath>/<issue>.json` (git record), `~/.panopticon/agents/<id>/state.json`.
- **Transition site** — a production code location that *writes* a stage-bearing
  value into at least one store.
- **Reactive dispatch** — the autonomous half: a write to one store emits an
  `events`/pipeline-notifier event, which the Cloister deacon consumes and
  reacts to (spawns a role, advances the issue). The trigger is the event, not
  an HTTP route.
- **Role** — `plan | work | review | test | ship | flywheel | strike`
  (`packages/contracts/src/types.ts:21`). A role spawn *is* the physical
  manifestation of a working stage.

---

## 1. Canonical stages — the multi-axis map (PART A)

The "stage" the operator sees is computed from **eight independent status axes**,
each with its own enum, its own store, and its own writer. There is no single
column. This table IS the motivation for "one controller per domain."

### 1a. Happy-path stage line (the documented intent)

```
todo → planning → planned/proposed → working → in-review → testing
     → verifying/UAT → merging → verifying-on-main → closed
                                                        │
              side-states: paused · troubled · stuck · blocked
                           · deacon-ignored · cancelled
```

### 1b. The axes that compose a stage

| # | Axis (enum) | Values | Store | Writer of record | Source |
|---|---|---|---|---|---|
| 1 | **Tracker `IssueState`** | `open · in_progress · in_review · closed` | GitHub labels + issue open/closed | `IssueLifecycleService.transitionTo` | `src/lib/tracker/interface.ts:28`; lifecycle svc `src/dashboard/server/services/issue-lifecycle.ts:198` |
| 1b | **Lifecycle `IssueState` (richer)** | `open · in_planning · in_progress · in_review · verifying_on_main · closed · canceled` | GitHub labels (`planned`, `in-progress`, `in-review`, `verifying-on-main`, `wontfix`) + `canonicalStatus` cache | `transitionTo` → `GITHUB_STATE_LABELS` | `src/dashboard/server/services/issue-lifecycle.ts:45`, label map `:154`, `canonicalStatus()` `:178` |
| 2 | **`plan.status`** (vBRIEF spec) | `draft · proposed · approved · running · completed · cancelled` | `.pan/specs/*.vbrief.json` (git) | `updateSpecStatus` only (PAN-1124 single writer) | `src/lib/pan-dir/specs.ts:266`; finalize `src/cli/commands/plan-finalize.ts:377` |
| 3 | **`review_status.review_status`** | `pending · reviewing · passed · failed · blocked` | SQLite `review_status` + mirrored to `.pan` record | `setReviewStatusSync` | `packages/contracts/src/types.ts:27`; writer `src/lib/review-status.ts:194` |
| 4 | **`review_status.test_status`** | `pending · testing · passed · failed · skipped · dispatch_failed` | SQLite `review_status` (+ record) | `setReviewStatusSync` | `packages/contracts/src/types.ts:30` |
| 5 | **`review_status.merge_status`** | `pending · queued · merging · verifying · merged · failed` | SQLite `review_status` (+ record) | `setReviewStatusSync` / merge-agent | `packages/contracts/src/types.ts:36` |
| 6 | **`review_status.verification_status`** | `pending · running · passed · failed · skipped` | SQLite `review_status` | verification-runner | `packages/contracts/src/types.ts:39` |
| 6b | **`review_status.uat_status`** | `pending · testing · passed · failed` | SQLite `review_status` | uat engine | `src/lib/review-status.ts:52` |
| 6c | **`review_status.inspect_status`** | `pending · inspecting · passed · failed · error` | SQLite `review_status` | inspect-agent | `src/lib/review-status.ts:48` |
| 7 | **Agent process `AgentStatus`** | `starting · running · stopped · error · unknown` | SQLite `agents` + `state.json` + `agent.*` events | `agents.ts` / runtime adapters | `packages/contracts/src/types.ts:18` |
| 7b | **`AgentResolution`** (self-report) | `working · done · needs_input · stuck · completed · unclear · abandoned · api_error` | transcript/heartbeat → events | harness | `packages/contracts/src/types.ts:24` |
| 8 | **Reactive `ReactiveIssueState`** | `todo · open · in_planning · in_progress · in_review · testing · shipping · closed · canceled` | derived (event payload), not stored | `issueStateChangeFromDomainEvent` | `src/lib/cloister/service.ts:137` |

### 1c. Side-states (orthogonal flags, not on the main line)

| Side-state | Store + field | Set by | Cleared by | Effect |
|---|---|---|---|---|
| **paused** | `state.json` / `agents` `paused` | `pan pause`, deacon advancing-reaper | `pan unpause`, `pan start --force` | Deacon auto-resume skips agent |
| **troubled** | `state.json` / `agents` `troubled` + failure counters | deacon after repeated resume/crash; stuck-remediation | `pan untroubled` | Resume gate refuses; `handleAgentStoppedEvent` skips (`deacon.ts:6649`) |
| **stuck** | `review_status.stuck` (+ `stuck_reason/at/details`) | approve-push divergence guard, conflict-gate | `/unstick` route | Deacon patrol skips the issue |
| **deacon-ignored** | `review_status.deacon_ignored` | operator (`/deacon-ignore`) | operator | Patrol skips issue entirely |
| **blocked** | `review_status.review_status='blocked'` + `blocker_reasons` | review verdict, webhook merge-blockers | re-review | Not merge-ready |
| **cancelled** | `IssueState='canceled'` (`wontfix` label) + `plan.status='cancelled'` | `move-status`, issue-closed reaper | reopen | Terminal; reactive dispatch suppressed |
| **ready-for-merge** | `review_status.ready_for_merge` | derived by `setReviewStatusSync` when review+test pass (`review-status.ts:283`) | reset/new commit | Gates merge queue |

### 1d. Divergence from the documented model

- `reference/state-model.mdx` claims phase is **derived** ("the DB is a cache;
  phase is a function of GitHub + workspace") and that **all mutations go
  through one write surface** (enforced by `scripts/lint-state-writes.sh`).
  **Reality:** each axis above is written **imperatively and independently** by
  its own helper. `lint-state-writes.sh` governs *which modules may touch the
  cache*, not *logical stage transitions* — there is still **no single
  transition controller**. The closest thing, `transitionTo`, covers only
  axis 1/1b (tracker state) and never touches axes 2–7.
- `status_history` (`schema.ts:272`, `type ∈ 'review'|'test'|'merge'`) logs
  **only** review/test/merge sub-status. It does **not** capture `IssueState`
  transitions, `plan.status`, agent lifecycle, or any side-flag. The audit
  below is the **union** of all axes, not just `status_history` writers.
- `docs/AGENT-STATE-PLANES.md` is accurate on *where* state lives (3 planes) but
  silent on *how many writers* mutate each plane. That count is the finding here.

---

## 2. The transition table (PART B)

Production transition sites, grouped by the axis they write. Each row:
**from → to | trigger (invoker) | code location | stores written**.

Stores legend: **GH** = GitHub labels/state · **RS** = SQLite `review_status` ·
**REC** = `.pan` record · **SH** = `status_history` · **EV** = `events`/pipeline
event · **AG** = SQLite `agents` · **SJ** = `state.json` · **SPEC** =
`.pan/specs` vBRIEF.

### 2a. The one near-controller — `IssueLifecycleService.transitionTo`

Writes GH labels + `canonicalStatus` cache + emits `issue.transitioned`. Covers
axis 1/1b only.

| From → To | Trigger (invoker) | Code location | Stores |
|---|---|---|---|
| any → `in_planning` | `start-planning` route | `src/dashboard/server/routes/issues.ts:995` | GH, EV |
| any → `open` (reset to todo) | `move-status` / abort / restart-from-plan | `issues.ts:1148`, `:1486` | GH, EV |
| any → `targetState` (operator move) | `move-status` route | `issues.ts:1789` | GH, EV |
| any → `in_progress` | generate-tasks / start fallback | `issues.ts:2124`, `:2216` | GH, EV |
| any → `in_progress` | agent start / restart | `src/dashboard/server/routes/agents.ts:2971`, `:3187`, `:3538` | GH, EV |
| any → `verifying_on_main` | `postMergeLifecycle` (server merge) | `src/lib/cloister/merge-agent.ts:629` | GH, EV |
| service impl | (all of the above) | `issue-lifecycle.ts:198`–`247` | GH + `canonicalStatus` + EV |

### 2b. Tracker transition — the *other* path (`transitionIssue` / helpers in `agents.ts`)

A second, parallel route to the same axis-1 move, **bypassing** `transitionTo`.
`transitionIssueState` (`src/lib/agents.ts:2801`) calls `tracker.transitionIssue`
directly (GH labels via `github.ts:239`), with thin wrappers
`transitionIssueToInProgress` (`agents.ts:2867`) and `transitionIssueToInReview`
(`agents.ts:2875`).

| From → To | Trigger (invoker) | Code location | Stores |
|---|---|---|---|
| → `in_progress` | work agent spawn | `src/lib/agents.ts:3661` | GH |
| → `in_progress` | specialist done (re-enter work) | `src/dashboard/server/routes/specialists.ts:620` | GH |
| → `in_review` | approve / re-review (3 sites) | `src/dashboard/server/routes/workspaces.ts:3739`, `:4027`, `:4192` | GH |
| → `closed` | close-out workflow | `src/lib/lifecycle/close-issue.ts:105`, `:383` | GH |
| → `verifying_on_main` (label) | merge-agent direct gh edit | `src/lib/cloister/merge-agent.ts:587`–`632` | GH |
| review-fail → `in_progress` | `specialists/done` failure branch | `specialists.ts:623`, `:627` | GH |

> **Same logical move, two code paths:** "→ in_review" is reachable via
> `transitionTo` (axis 1b, emits events) AND via `transitionIssueToInReview`
> (axis 1, GH only, no event). They write different stores. This is the
> drift-risk pattern (see §4).

### 2c. Review / test / merge sub-status — `setReviewStatusSync` (axis 3–6)

`setReviewStatusSync` (`src/lib/review-status.ts:194`) is the single *function*
but is called from **~70 production sites**. Every call writes **RS + REC**
(mirror via `updateIssueRecordForIssue` `review-status.ts:345`), appends **SH**,
and — critically — **emits reactive EV** (`review.approved` / `test.passed`,
`review-status.ts:455`–`462`) when status flips to `passed`. So a status write
*is* a transition trigger.

| From → To (sub-status) | Trigger (invoker) | Code location | Stores |
|---|---|---|---|
| review `pending→reviewing` | review-agent dispatch | `src/lib/cloister/review-agent.ts` (via setReviewStatus) | RS, REC, SH, EV |
| review `reviewing→passed` | review verdict (approve) | `src/dashboard/server/routes/workspaces.ts:3494`; CLI `src/cli/commands/specialists/done.ts` | RS, REC, SH, **EV: review.approved** |
| review `reviewing→failed/blocked` | review verdict (block) | `specialists.ts` done handler | RS, REC, SH |
| test `pending→testing` | test dispatch | `src/lib/cloister/test-agent-queue.ts` | RS, REC, SH, EV |
| test `testing→passed` | test verdict | `workspaces.ts:3939`; `specialists.ts:584`,`:981`; CLI `done.ts` | RS, REC, SH, **EV: test.passed** |
| test `→skipped` | verification-gate skip | `src/lib/cloister/test-status-green-ci-reconciler.ts` | RS, REC |
| merge `pending→queued/merging` | merge queue / approve | `workspaces.ts` merge route ~`:5676`; `done.ts:563` | RS, REC, SH |
| merge `merging→merged` | `postMergeLifecycle` | `src/lib/cloister/merge-agent.ts:357` | RS, REC |
| merge `→failed` | merge failure | `merge-agent.ts:445` | RS, REC |
| verification `pending→running→passed/failed` | verification-runner | `src/lib/cloister/verification-runner.ts:202` | RS |
| inspect `→inspecting/passed/failed` | inspect-agent | `src/lib/cloister/inspect-agent.ts` | RS |
| uat `→testing/passed/failed` | uat engine | `src/lib/cloister/uat-*.ts` | RS |
| `readyForMerge` derived true | review+test both pass | `review-status.ts:283` (auto) | RS, REC |

### 2d. `plan.status` (axis 2) — the cleanly-single-writer one

| From → To | Trigger (invoker) | Code location | Stores |
|---|---|---|---|
| (new) → `draft` | `pan plan` PRD write | `src/lib/vbrief/builder.ts:41` | (file) |
| `draft → proposed` | `complete-planning` / plan finalize | `src/cli/commands/plan-finalize.ts:377`; `src/lib/vbrief/auto-synthesize.ts:88`,`:133` | SPEC |
| `proposed → approved/running` | `start-agent` | `updateSpecStatus` via `src/lib/vbrief/lifecycle-io.ts:246` | SPEC |
| `running → completed` | close-out | `lifecycle-io.ts:338` | SPEC |
| any → `cancelled` | issue closed | `updateSpecStatus` (`pan-dir/specs.ts:266`) | SPEC |

> This axis is the model the remodel wants everywhere: **one writer**
> (`updateSpecStatus`), file moves never happen, only the field changes.

### 2e. Reactive dispatch — the autonomous half (axis 8 → role spawn)

The Cloister deacon consumes events and dispatches roles. **No HTTP route is
involved** — the trigger is an `events` row. This is where the pipeline
*advances itself*.

| Event (from) → role/state (to) | Mapper | Dispatcher | Code location |
|---|---|---|---|
| `work.completed` / `agent.completed`(role=work) → `in_review` | `issueStateChangeFromDomainEvent` | `onIssueStateChange` → review role | `src/lib/cloister/service.ts:399`–`411`, `:497` |
| `review.approved` → `testing` | same | `onIssueStateChange` → test role | `service.ts:412`, `stateToRole` `:168`, `ROLE_RUN_STATES` `:153` |
| `test.passed` → `shipping` | same | ship handoff (server merge) | `service.ts:414` |
| `issue.transitioned`/`statusChanged` → role for state | same | `onIssueStateChangePromise` | `service.ts:278`–`381` |
| `issue.statusChanged`(closed) → reap | — | `closed-issue-reaper` | `service.ts:484` |
| `issue.statusChanged`(todo/planned) → reconcile proposed spec | — | `orphan-proposed-reconciler` | `service.ts:489` |
| `agent.stopped` → resume/orphan handling | — | `handleAgentStoppedEvent` | `service.ts:422`, `deacon.ts:6649` |
| `agent.heartbeat_dead` → orphan recovery | — | `handleAgentHeartbeatDeadEvent` | `service.ts:445` |
| `review.coordinator.died` → re-dispatch review | — | `handleReviewCoordinatorDied` | `service.ts:457` |

Reactive event emission lives in `setReviewStatusSync`
(`review-status.ts:455`–`462`) and `notifyPipelineSync`
(`src/lib/pipeline-notifier.ts:23`). So the *write* in §2c **is** the trigger here.

### 2f. Deacon patrol & remediation — side-state writes (axis 7 + side-flags)

| From → To | Trigger (invoker) | Code location | Stores |
|---|---|---|---|
| running → stopped (orphan) | `recoverOrphanedAgents` patrol | `src/lib/cloister/deacon.ts:5766`,`:5783` | AG, SJ, EV |
| stopped → running (auto-resume) | `autoResumeStoppedWorkAgents` | `deacon.ts` (`autoResume*`) | AG, SJ, EV |
| any → troubled | repeated resume/crash failures | `deacon.ts` failure markers `:5733`; stuck-remediation `:120` | SJ/AG |
| idle → paused+troubled (flywheel) | stuck-remediation escalation | `src/lib/cloister/stuck-remediation.ts:186` | SJ |
| advancing → paused (advancing reaper) | re-pause before kill | `deacon.ts:4853`–`4867` | SJ |
| review-fail dead-end → circuit-break | auto-requeue ≥25 | `deacon.ts:3898`–`3900` | RS |
| stuck set (main diverged) | approve-push divergence guard | `workspaces.ts` approve helper `:1334`–`1342` | RS |
| stuck cleared | `/unstick` route | `workspaces.ts:4672`,`:4587`–`4645` | RS |
| → verifying_on_main + pause agents | `postMergeLifecycle` | `merge-agent.ts:438` | GH, RS, SJ, EV |

### 2g. Destructive / terminal resets

| From → To | Trigger | Code location | Stores |
|---|---|---|---|
| any → todo (deep-wipe) | `deep-wipe` route | `src/dashboard/server/routes/issues.ts:2345` | GH, RS(del), AG, SJ, SPEC(ws), branches |
| any → todo (wipe CLI) | `pan wipe` | `src/cli/commands/` wipe | GH, RS, AG, SJ |
| closed → reopened | `pan reopen` / route | `src/lib/reopen.ts`; `issues.ts` reopen | GH, RS, EV |
| running → stopped (kill) | `pan kill` | `src/cli/commands/` kill | AG, SJ, EV (workspace preserved) |
| → closed (close-out) | `pan close` / close-out route | `issues.ts:2556`; `src/lib/lifecycle/close-issue.ts` | GH, RS(clear), SPEC(completed), EV |

---

## 3. Approximate counts (PART B rollup)

Counts are of **production** sites (tests excluded). Where a single helper is
called from many places, the helper is one *function* but N *trigger sites*.

| Measure | Count | How counted |
|---|---|---|
| Axes that compose a "stage" | **8** (+3 sub-axes) | §1b |
| Side-states | **7** | §1c |
| `setReviewStatusSync` call sites (RS+REC+SH+EV per call) | **~70** | `rg setReviewStatusSync\(\|upsertReviewStatusSync\(` prod |
| Direct GitHub label/state write sites | **~54** | `rg 'gh issue edit\|addLabel\|removeLabel\|transitionIssue\|closeIssue\|reopenIssue'` prod |
| `transitionTo` call sites | **~12** | §2a |
| `transitionIssueTo{InProgress,InReview}` call sites | **8** | §2b |
| Side-flag (stuck/troubled/paused/ignored) writers | **~52** | `rg 'setStuck\|markTroubled\|paused: true\|deacon_ignored'` prod |
| `plan.status` writers | **1 function** (`updateSpecStatus`), ~4 call sites | §2d |
| Reactive event→role dispatch edges | **9** | §2e |
| **Distinct trigger sites (union, approx.)** | **≈ 200+** | sum of the above, de-duped by file:line |
| **Distinct logical (from→to) pairs** | **≈ 18** | §5 below |

The gap between **~200 trigger sites** and **~18 logical moves** is the sprawl
the remodel deletes.

---

## 4. Worst offenders (deletion targets)

### 4a. Most-duplicated single move

- **"→ in_review"** — fired from **at least 5 places** across **2 different
  axes/code paths**:
  - `transitionIssueToInReview` from `workspaces.ts:3739`, `:4027`, `:4192`
  - `transitionTo(…, 'in_review')` reachable via the lifecycle service
  - `setReviewStatusSync({reviewStatus:'reviewing'})` (axis 3)
  Each writes a *different* subset of stores (GH-only vs GH+event vs RS+REC+EV).
- **"→ in_progress"** — fired from **6+ places**: `agents.ts:2971`, `:3187`,
  `:3538` (lifecycle), `agents.ts:3661` (spawn), `specialists.ts:620`
  (re-enter), `issues.ts:2124`, `:2216` (generate-tasks/start).
- **"→ verifying_on_main"** — written **3 ways in one function**: GH label via
  raw `gh issue edit` (`merge-agent.ts:608`), `transitionTo` (`:629`), and
  `review_status` mergeStatus (`:357`, `:445`).

### 4b. One move writing many stores inconsistently (drift risk)

- **`specialists/done` handler** (`specialists.ts:318`–`709`) — a single request
  writes **RS + SH + EV + GH label + tmux kill + handoff log + `reviewedAtCommit`
  snapshot**, with separate try/catch per store. Any one failing leaves the
  others advanced → split-brain stage.
- **`setReviewStatusSync`** (`review-status.ts:194`) — every call fans out to
  **RS, REC (`:345`), SH, and conditionally EV (`:455`)**. The REC mirror is
  fire-and-forget (`void updateIssueRecordForIssue` `:345`) — if it throws, the
  DB and the git record diverge silently.
- **"→ in_review" via two paths** (§4a) — `transitionIssueToInReview` writes
  **GH only, no event**, while `transitionTo` writes **GH + cache + event**.
  Issues advanced by the GH-only path never emit `issue.transitioned`, so the
  reactive scheduler can miss the review dispatch. Classic drift.
- **merge `verifying_on_main`** — GH label, `review_status.merge_status`, and the
  `.pan` record `pipeline` block are each updated by different lines; a partial
  failure (e.g. `transitionIssueToVerifyingOnMain` throws after mergeStatus set)
  is explicitly handled at `merge-agent.ts:442`–`452` — evidence the drift is
  real enough to need a recovery branch.

---

## 5. Collapsed logical moves — the minimal set (PART B §3)

All ~200 trigger sites collapse to **~18 logical (from→to) moves**, which
further collapse to **one linear advance chain + a handful of failure/terminal
edges**:

### Forward advances (the spine)
1. `todo → planning` (start planning)
2. `planning → planned` (planning complete; `plan.status=proposed`)
3. `planned → working` (start work; `plan.status=running`, `IssueState=in_progress`)
4. `working → in-review` (work complete)
5. `in-review → testing` (review approved)
6. `testing → verifying/UAT` (test passed) *(may be skipped per project)*
7. `verifying/UAT → merging` (ready-for-merge, merge dispatched)
8. `merging → verifying-on-main` (merge landed)
9. `verifying-on-main → closed` (close-out)

### Failure edges (back to an earlier stage)
10. `in-review → working` (review blocked)
11. `testing → working` (test failed)
12. `merging → working` (merge conflict / push divergence → stuck)

### Terminal / out-of-band
13. `any → cancelled` (issue closed wontfix)
14. `closed/cancelled → todo` (reopen)
15. `any → todo` (deep-wipe / wipe — destructive reset)

### Side-state toggles (orthogonal, not stage moves)
16. `* ↔ paused` (operator / advancing reaper)
17. `* ↔ troubled` (deacon crash gate)
18. `* ↔ stuck` / `* ↔ deacon-ignored` (system / operator hold)

**Proposed Overdeck controller.** One `advance(issueId, toStage, reason)` write
surface that: validates the move against this 9-step spine + the 6 failure/
terminal edges, writes **all** stores atomically in one transaction (RS + record
+ GH + event emission), and is the **only** caller of `transitionTo`,
`setReviewStatusSync`, `updateSpecStatus`, and the GH label ops. Side-states
become a separate small `hold(issueId, flag, on/off)` surface. Everything in §2
that is not this controller gets deleted or rewritten to call it.
