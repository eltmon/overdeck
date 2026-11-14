# Merge Train

The merge train is one project's merge pipeline: everything that turns ready
PRs into commits on `main`. This page is the developer reference for the
train restored by PAN-4753: how a ready PR is routed, how batches assemble and
say why they ended, what the operator sees, and where each piece lives. The
operator-facing walkthrough is [`features/merge-batches.mdx`](../features/merge-batches.mdx);
merge mechanics after a PR is chosen are in [MERGE-WORKFLOW.md](MERGE-WORKFLOW.md).

## Glossary

| Term | Meaning |
| --- | --- |
| **Train flag (global)** | `merge_train.enabled` in `app_settings`, read by `isMergeTrainEnabled()`. The **master switch**: off means no project batches, and every ready PR merges on its own. The Flywheel header carries it as **Merge train**. |
| **Train flag (project)** | `merge_train: enabled \| disabled` in `projects.yaml`, read by `isMergeTrainEnabledForProject()`. `disabled` turns this project's train off; `enabled` and absent both mean "on while the master switch is on". |
| **Hold project** | A project whose policy holds merges for UAT (`projectHoldsForUat`): its `auto_merge_default` is `hold`, or it has none and the global `require_uat_before_merge` is on. Shown with the chip **Holds for UAT**. |
| **Auto project** | Any other project. Shown with the chip **Auto-merge**. |
| **Issue policy** | The per-issue override carried by tracker labels: `auto-merge` (Auto), `hold-for-uat` (Hold), neither (follow the project). |
| **Merge route** | Where a ready PR goes, from `mergeRouteFor` (`src/lib/cloister/merge-route.ts`): `per-pr` (the auto-merge scheduler merges it alone after the cooldown) or `batch` (it waits for a batch). |
| **High priority** | A PR that never waits for a batch: a strike branch `strike/<id>`, or an issue labeled `critical`, `blocks-main`, `P0` or `urgent`, or both `substrate-improvement` and `bug`. |
| **Batch window** | With the train on, an auto project's batch assembles at `merge_train.batch_size` ready features (default 3) or when the oldest has waited `merge_train.batch_wait_minutes` (default 30). |
| **Car** | One issue on the train: an open PR a review approved, or an issue with a live auto-merge row or merge run. |
| **Batch** (generation) | A `uat/<label>-<codename>-<MMDD>-<n>` branch merging several ready features for joint testing, stored in `uat_generations`. |
| **Live batch** | A batch with status `assembling`, `ready` or `superseded`. |
| **Superseded** | A batch a newer one replaced (its base moved or its input set changed). Still testable and promotable. |
| **Invalidated** (voided) | A batch whose content can no longer be trusted. Cannot be promoted. |
| **Status reason** | `uat_generations.status_reason`: one sentence saying why a batch became `superseded` or `invalidated`. |
| **Cooldown** | `AUTO_MERGE_COOLDOWN_MS` (5 minutes) between scheduling an auto-merge and merging it. Cancel works during it. |

## The merge route rule

`mergeRouteFor({ heldForUat, trainOn, highPriority, droppedFromBatch })`.
First match wins:

| # | Condition | Route |
| --- | --- | --- |
| 1 | Held for UAT (its label, else the project default, else global) | `batch`. A hold always wins; priority never bypasses it. |
| 2 | The train is off for the issue's project (master switch, project override, or the project lacks batch CI) | `per-pr` |
| 3 | High priority | `per-pr` |
| 4 | Dropped from a batch because the combined CI failed | `per-pr` |
| 5 | Otherwise (train on, normal priority) | `batch`; the batch window decides when it assembles |

The schedule door's policy check (`autoMergePolicyRefusal`), auto-merge
eligibility, `mergePathOwner` and the board all ask this one rule, so the
scheduler, the executor, the reconciler and the UI agree.

**Manual merges stay allowed.** The per-row Merge button and a batch member's
**Merge alone…** (`POST /api/merge-train/merge-next` with `issueId`), the issue
page Merge button and batch promotion are operator actions, not subject to
the route rule. In the train UI, merging a live-batch member alone first asks
for confirmation naming the batch it voids.

## Batches and their status reason

A batch moves `assembling` → `ready` → (`superseded`) → `promoted`, or ends
`invalidated` or `failed`. Every write of `superseded` or `invalidated` stores
`status_reason` in the same update:

| Writer | Reason |
| --- | --- |
| Engine supersede (`uat-generation-engine.ts`, `uat-polyrepo-engine.ts`) | `replaced by <name>` |
| Promote (`uat-promote.ts`), for every other live batch | `<name> was merged to main` |
| Reconciler (`uat-reconciler.ts`, `isStale`) | `<ID> was merged on its own, outside the batch`, `<ID> is no longer ready to merge`, `<ID> branch gained commits`, or `<ID> merges through the per-PR auto-merge train` |
| Chain trim (`cleanupUatGenerations`) | `trimmed: older than the newest <N> batches` |
| Auto-promote drop or dissolve (`batch-auto-promote.ts`) | the drop reason, e.g. `combined CI failed on <name> (<checks>); <ID> merges on its own` |

The "merged on its own" reason needs to know which members merged. The
reconciler's optional `mergedIssueIds` dep answers it from the cached GitHub PR
listing (`merged-issue-ids.ts`), read once per tick and only while a live batch
exists. GitLab and polyrepo projects omit it until their listing lands
(PAN-3657); the "no longer ready to merge" reason is then correct, only less
specific. The generations payload and the board carry `statusReason`, and the
UI never hides a voided or superseded batch.

## Strikes

A strike PR (`strike/<id>`, from `pan strike`) is high priority, so it never
batches. Batches stay feature-only. Today the operator merges a strike with
the strike lane's Merge button, `POST /api/merge-train/strikes/:issueId/merge`
(PAN-4750). That operator-started door is the only merge that does not require
a head approval; every automatic merge and every feature merge still needs
one. The board shows each open strike's state: checks running, bot review
running, flagged by review (with the reviewer's summary), waiting for UAT in a
hold project, merging, failed, blocked, or approved. Automatic expedited review
and no-cooldown strike auto-merge are PAN-4753 WI-5 and WI-6; until they land,
the operator door is how strikes merge.

## The board read model

`GET /api/merge-train/board[?project=<key>]` (`getMergeTrainBoard`,
`src/dashboard/server/services/merge-train-board.ts`; types in
`merge-train-board-types.ts`) returns everything one `MergeTrain` component
renders, per project: identity (repo, forge, polyrepo members), the effective
flag and the project override, the mode, the cooldown, the batch window
(waiting count and when the next batch assembles), cars, strikes, batches with
their status reason, and up to five recent merges. An unknown `project` is a
404.

**Cars.** Candidates are picked without a forge read: an open `feature/<id>`
PR whose listing row has a decided review or whose head has a cached gate
answer, an issue with an active or problem `pending_auto_merges` row from the
last 7 days, or an issue with a merge run. Only candidates read PR facts,
through the 60 s cache the merge gate and the approval refresher already fill.
State, first match wins: `merging` (a live run or a `merging` row), `failed`
(a failed run, a failed row at the current head, or the journal's last merge
outcome), `blocked` (any blocker, or a `blocked` row), `cooldown` (a `pending`
row; carries `mergeAt` and the row id for Cancel), `held` (batch-routed, in
the ready set, not in a live `ready`/`assembling` batch), `ready`. A member of
a live batch carries `liveBatch`; the UI shows it inside the batch, not as a
row. `readyAt` is the D4 ready-since clock (newest check completion on the
head), shown only once the PR is approved.

**Blockers** (`merge-blocker-types.ts`): `failing_checks` (with the failing
check names), `merge_conflict`, `not_mergeable`, `draft_pr`,
`changes_requested`, and `unresolved_conversations`. Unresolved review
threads are one GraphQL read per GitHub repo (`unresolved-threads.ts`), cached
two minutes; a failed read returns nothing and the other five types still
show. On GitLab, `detailed_merge_status: discussions_not_resolved` counts as
one thread. `GET /api/merge-train/merge-blockers` keeps its three
forge-native types.

**Errors.** One project's failure never blanks the board: that project
returns its card with `error` and empty lists.

**Polyrepo.** Until PAN-3657 brings a polyrepo PR listing, a polyrepo
project's cars come from auto-merge rows and merge runs only, and its recent
merges are empty.

## Recent merges

`recent-merges.ts` derives a project's last five merges from the cached forge
listings and attributes each from records that already exist. Nothing new is
stored.

1. Members of a `promoted` batch whose PRs merged within 10 minutes of the
   promote become one `batch` entry.
2. A PR whose newest auto-merge row is `merged` is `auto-merge`.
3. A PR with a `merge.attempted` journal entry in the 30 minutes before it
   merged is `overdeck` (an operator merge door).
4. Anything else merged outside the train (`outside-train`). When an
   auto-merge was still scheduled for that PR, the entry says how many minutes
   before its cooldown it merged. Merges outside the train are noted, never
   refused or reverted.

## The master switch

`isMergeTrainEnabledForProject` returns false whenever the global flag is off,
whatever the project says. The flag gates batching and the post-merge roll.
It no longer pauses the scheduler or the executor: off means per-PR merges.
`OVERDECK_DISABLE_AUTO_MERGE=1` stays the switch that stops every automatic
merge.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/merge-train/board` | The board read model (PAN-4753) |
| `GET /api/merge-train/queues`, `GET /api/merge-train/generations` | Per-project ready queues and the batch chain (with `statusReason`) |
| `POST /api/merge-train/generations/:name/stack`, `/promote`, `/ship` | Start a batch's UAT stack, merge the batch to main, ship its version |
| `POST /api/merge-train/assemble` | Assemble a batch now |
| `POST /api/merge-train/merge-next` | Merge one or N ready features of a project (per-row Merge, Merge alone) |
| `POST /api/merge-train/strikes/:issueId/merge` | The operator's strike merge door (PAN-4750) |
| `GET/POST /api/merge-train/config` | Policies: `merge_train_enabled`, `batch_size`, `batch_wait_minutes`, and the Flywheel switches |
| `GET /api/merge-train/auto-merge`, `/auto-merge/pending`, `/auto-merge/problems` | Per-issue policy map, cooldown queue, stuck rows |
| `POST /api/merge-train/auto-merge/schedule`, `DELETE /api/merge-train/auto-merge/:issueId` | Schedule and cancel an auto-merge |
| `GET /api/merge-train/merge-blockers`, `GET /api/merge-train/merge-backend` | Blocked approved PRs; which merge backend is available |
| `GET/POST /api/projects/:projectKey/merge-train` | Read and set the project override |

## File map

| Concern | Files |
| --- | --- |
| Route rule, priority, drop lookup | `src/lib/cloister/merge-route.ts` |
| Batch window | `src/lib/cloister/batch-window.ts`, `src/dashboard/server/services/merge-train-batching.ts` |
| Scheduler and executor | `src/dashboard/server/services/auto-merge-scheduler.ts`, `auto-merge-executor.ts`, `auto-merge-door-policy.ts`, `merge-path-owner.ts` |
| Reconciler and engines | `src/lib/cloister/uat-reconciler.ts`, `uat-generation-engine.ts`, `uat-polyrepo-engine.ts`, `src/dashboard/server/services/uat-train.ts` |
| Promote and auto-promote | `src/lib/cloister/uat-promote.ts`, `src/dashboard/server/services/batch-auto-promote.ts` |
| Board | `src/dashboard/server/services/merge-train-board.ts`, `merge-train-board-types.ts`, `recent-merges.ts`, `merged-issue-ids.ts`; `src/lib/cloister/merge-blocker-types.ts`, `unresolved-threads.ts` |
| Strike merge | `src/dashboard/server/services/strike-merge.ts`, `src/dashboard/server/routes/merge-train-lanes.ts` |
| UI | `src/dashboard/frontend/src/components/merge-train/train/` (`MergeTrain`, `ProjectTrainCard`, `BatchCard`, `TrainCarRow`, `StrikeLane`, `RecentMergesStrip`, …) |
