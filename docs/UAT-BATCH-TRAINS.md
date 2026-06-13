# UAT Batch Trains

UAT batch trains keep **one assembled, testable batch of every merge-ready
feature available at all times**, so a human can exercise the combined result,
then land exactly what they tested with a single action. Shipped in
[PAN-1737](https://github.com/eltmon/panopticon-cli/issues/1737); supersedes the
disjoint-only "UAT candidate" model from PAN-1691 (see
[`MERGE-TRAIN.md`](./MERGE-TRAIN.md) for that history) and absorbs the live
preview stack from PAN-1738.

Read this with:

- [`FLYWHEEL.md`](./FLYWHEEL.md) — the orchestrator surface that can view and control trains without owning their ready set.
- [`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md) — the per-issue merge state machine, which remains the escape hatch.
- [`../.pan/drafts/PAN-1737.md`](../.pan/drafts/PAN-1737.md) — the originating PRD (full design rationale).
- [`../docs/design/pan-1737-uat-batch-trains.html`](./design/pan-1737-uat-batch-trains.html) — the approved 3-state mockup.

## The problem it solves

When several features pass review at once, a human merging them one at a time
has to UAT each in isolation, and each merge restales the others. The operator's
founding complaint: *"I looked at the merge queue and I had no idea what it
meant, how I would UAT it, or a way to UAT it."* Agents now generate mergeable
code faster than a human can review-and-land it serially, so the bottleneck is
the last-mile UAT. Batch trains move that bottleneck by assembling the combined
tree once, continuously, and automatically.

## The model

| Term | Meaning |
| --- | --- |
| **Ready set** | All features whose review-status records are merge-eligible (`mergeGateEligibility().eligible`) and not deacon-ignored, grouped per project and ordered by that project's conflict-aware merge queue. |
| **Generation** | A throwaway `uat/<label>-<codename>-<MMDD>` branch off current main containing **as many ready features as possible, in merge order, with cross-feature conflicts resolved inside the batch**. |
| **Assembly agent** | A timeboxed headless `claude -p` run (acceptEdits, no shell) that resolves a merge conflict *on the branch* when one feature collides with an already-merged member. Verification, staging, and the merge commit happen in code — the agent only edits files. |
| **Held out** | A feature excluded from a generation because its conflict could not be resolved confidently (or the agent timed out). Shown on the card with the reason; retried in later generations once the conflicting predecessor merges or its branch changes. |
| **Generation chain** | Generations accumulate newest-first (`sea-monkey` → `brass-donkey` → `copper-fox`…). The newest **ready** generation is current; older ready/superseded ones stay testable and promotable. Append-only — lifecycle is status flips, never row deletion, so the chain is an audit trail. |
| **Promote** | The merge. Merging a generation lands its exact tree on main (one no-ff merge), so main receives precisely what was tested — conflict resolutions included. |
| **UAT stack** | A live dashboard stack serving a generation's branch at `uat-<label>-<codename>-<mmdd>.pan.localhost`, spun on demand from the generation's worktree. **Hard max 2 concurrent.** |

## Lifecycle

1. Two features pass review → the reconciler assembles `uat/pan-sea-monkey-0610`
   (both features, conflicts resolved in-branch). The card shows it **ready**,
   with **Open UAT frontend**, a per-member **What to UAT** checklist, and
   **Merge batch (2) to main**.
2. A third feature becomes ready → `uat/pan-brass-donkey-0610` (all three)
   assembles in the background. Sea-monkey stays fully testable the whole time;
   when brass-donkey reaches ready it becomes current and sea-monkey is marked
   superseded (still promotable).
3. The operator opens brass-donkey's frontend, runs the checklist, clicks
   **Merge batch (3) to main** → one merge lands the tested tree; the three
   member issues close out through the normal per-issue post-merge flow; the
   chain resets for the remaining ready set.
4. *Alternative:* the operator promotes the older sea-monkey instead (the third
   feature wasn't wanted yet) — it works as long as its base still matches main;
   the excluded feature reassembles into the next generation.
5. *Alternative:* the operator merges a single feature via the escape hatch — all
   live generations are invalidated and a fresh one reassembles automatically.

## Architecture

Pure orchestrators with injected dependencies (unit-tested), plus thin real-I/O
wiring (exercised live). All process exec is async (`execFile` argv arrays —
never `execSync`, never shell-string interpolation of branch names).

| Concern | Module |
| --- | --- |
| Generation store (schema v51 `uat_generations`, append-only chain) | [`src/lib/database/uat-generations-db.ts`](../src/lib/database/uat-generations-db.ts) |
| Assembly engine (ordered merges, held-out fallback, cleanup keep-newest-3) | [`src/lib/cloister/uat-generation-engine.ts`](../src/lib/cloister/uat-generation-engine.ts) |
| Real git wiring (worktree/merge/push, branch + path validation) | [`src/lib/cloister/uat-generation-deps.ts`](../src/lib/cloister/uat-generation-deps.ts) |
| Assembly-agent conflict resolution (timeboxed headless, allowlist) | [`src/lib/cloister/uat-conflict-agent.ts`](../src/lib/cloister/uat-conflict-agent.ts) |
| Reconciler (auto-assemble on ready-set change, invalidate stale) | [`src/lib/cloister/uat-reconciler.ts`](../src/lib/cloister/uat-reconciler.ts) |
| Batch promotion (merge tested branch to main, per-member post-merge once) | [`src/lib/cloister/uat-promote.ts`](../src/lib/cloister/uat-promote.ts) |
| Live UAT stack lifecycle (max 2, mandatory teardown) | [`src/lib/cloister/uat-stack.ts`](../src/lib/cloister/uat-stack.ts) |
| Service wiring + reconciler interval + route payloads | [`src/dashboard/server/services/uat-train.ts`](../src/dashboard/server/services/uat-train.ts) |
| UAT batches card | [`src/dashboard/frontend/src/components/flywheel/MergeQueueCard.tsx`](../src/dashboard/frontend/src/components/flywheel/MergeQueueCard.tsx) |

### Reconciler — the heartbeat

A 60-second interval (`startUatTrainReconciler` in
[`main.ts`](../src/dashboard/server/main.ts)) keeps "always one batch ready"
true. Each tick is **single-flight per project** and:

1. **No-ops per project** unless the global `merge_train.enabled` flag and that
   project's `merge_train` override resolve to enabled. If a project has no
   ready features and no live generations, the tick skips git work; if it has
   live generations, the tick still invalidates stale batches.
2. **Invalidates** live generations that went stale — main advanced past their
   base, a member left the ready set, or a member branch gained commits.
   Invalidation tears down the generation's live stack. (A smaller *subset*
   generation off current main is **not** stale — it stays testable.)
3. **Un-wedges** assemblies stuck `assembling` for >30 min by marking them failed.
4. **Assembles** the next generation when nothing live answers the current
   desired set. A failed assembly for the *same* input backs off 10 min before
   retrying. The `POST /assemble-uat` route forces a rebuild, bypassing the
   match/backoff checks.

### Conflict resolution — division of labor

When merging a feature onto a generation branch conflicts, the engine hands the
mid-conflict worktree to the assembly agent with one mission: resolve *this*
merge's markers, changing nothing else. The agent only edits files (`claude -p
--permission-mode acceptEdits`, no shell). This module then verifies in code (no
leftover markers, no unmerged index entries), stages, and concludes the merge
commit (`uat-assembly: resolve A <-> B` in the body; git's standard `Merge
branch …` subject so it survives commitlint when promoted). Any failure — agent
missing, timebox (default 5 min), markers left, commit rejected — aborts the
merge and holds the feature out. **The assembly never wedges on a conflict.**

### Promotion — merge what you tested

`promoteUatGeneration` requires the generation's `baseSha` to still equal
`origin/main` (a stale base is rejected with reassemble guidance — promoting it
would silently drop commits landed since assembly). It merges the `uat/*` branch
into main with one no-ff merge in a **throwaway detached worktree** (never the
primary checkout), pushes, then runs each member issue's post-merge lifecycle
**exactly once** through the [PAN-328](https://github.com/eltmon/panopticon-cli/issues/328)
in-flight guard (see CLAUDE.md "postMergeLifecycle Idempotency"). GitHub marks
the per-feature PRs merged automatically because their head commits become
reachable from main. The promoted generation is reaped; all other live
generations invalidate (main moved) and the reconciler rebuilds.

### Live stacks — the hard cap

`ensureUatStack` renders the devcontainer on the generation worktree — the folder
name `uat-<label>-<codename>-<mmdd>` yields the Traefik host
`uat-<label>-<codename>-<mmdd>.pan.localhost` via the standard `FEATURE_FOLDER`
template — and runs `docker compose up`. **At most 2 UAT stacks run at once**:
Docker's default address pool fits ~31 bridge networks, and orphaned UAT stacks
would eventually block *all* workspace creation. Starting a third tears down the
oldest first (under a per-project mutation lock so concurrent starts cannot race
past the cap), and invalidation/promotion always tear a generation's stack down
(`compose down -v --remove-orphans`).

## API

| Route | Purpose |
| --- | --- |
| `GET /api/merge-train/generations` | Generation chains for every tracked project, newest first: per generation the members (with PR links and **per-member acceptance criteria** from the shared vBRIEF extractor `src/lib/vbrief/acceptance-criteria.ts` — the same source as the AwaitingMerge UAT plan, no second parser), held-out reasons, conflict resolutions, and live-stack `{status, frontendUrl}`. |
| `POST /api/merge-train/generations/:name/stack` | Ensure the generation's live stack (idempotent); returns the frontend URL and any evicted stacks. |
| `POST /api/merge-train/generations/:name/promote` | Promote (merge) the tested generation to main. |
| `POST /api/merge-train/assemble` | Force a reconcile/rebuild. The optional JSON body `{ "project": "<projectKey>" }` limits the rebuild to one project; omitted rebuilds all enabled projects. |
| `GET /api/merge-train/queues` | Ready sets for every tracked project, each row carrying `branchName` and `prUrl`, plus the effective per-project enabled state. |
| `POST /api/merge-train/merge-next` | The single-feature escape hatch — merge N queue items for one project to main one at a time, stopping on first failure. Body: `{ "project": "<projectKey>", "n": 1 }`. |

## Multi-project behavior

Batch trains are **per project**. Each tracked project gets its own ready set,
generation chain, live-stack lifecycle, and `merge_train` project override. The
Awaiting Merge and Flywheel views span projects so the operator can inspect and
control all trains from one surface, but a generation never mixes features from
different projects.

## The card — "UAT batches"

The Flywheel rail's first card ([`MergeQueueCard.tsx`](../src/dashboard/frontend/src/components/flywheel/MergeQueueCard.tsx),
matching [`design/pan-1737-uat-batch-trains.html`](./design/pan-1737-uat-batch-trains.html)):

- **Plain-language intro** — "N features passed review & tests. They're assembled into the test batches below…".
- **Batches, newest first** — ready (Open UAT frontend + Merge batch (N) to main + rebuild), assembling (live progress while the current batch stays actionable), superseded (still testable/promotable), held-out chips with reasons.
- **What to UAT** — the current batch's acceptance criteria grouped per member, with explicit "verify the touchpoint" items where the assembly agent resolved a conflict.
- **Ready features (merge order)** — reference rows with monospace branch + PR link.
- **Escape hatch** — "Merge one feature to main…", which states it bypasses batch testing.

Every merge action confirms through `useConfirm()` naming the exact members and
consequences. The string "Ship batch" no longer appears anywhere in the frontend.

## Operating it

Batch trains are gated **per tick** on the global `merge_train.enabled` flag and
each project's `merge_train` override. They do not require an active Flywheel
run. The reconciler is a 60s dashboard-server interval, independent of the
deacon; nothing assembles or merges without the effective merge-train policy
enabled for that project.

## Relationship to the per-issue merge path

[`MERGE-WORKFLOW.md`](./MERGE-WORKFLOW.md)'s four-state per-issue pipeline
(work-done → review-passed → rebased → merged) is unchanged and remains the
**escape hatch** — it's what the "Merge one feature to main…" button and the
SQLite per-project merge-serialization queue drive. Batch promotion is the
primary path for a project whose merge train is enabled; the per-issue path
covers everything else (and merging a single feature out-of-band invalidates the
live batches and triggers reassembly).
