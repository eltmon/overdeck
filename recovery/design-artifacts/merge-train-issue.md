## Problem

Merges to `main` are processed **one at a time, FIFO by scheduled time**, serialized per project. Every merge makes every *other* ready feature branch stale, and there is **no clean automatic rebase-onto-updated-main + re-verify** to recover them — so approved/ready PRs strand or flip to `CONFLICTING` and sit there.

The work pipeline runs **wide and parallel** (many agents, many workspaces) but the merge stage is **narrow, serial, and reactive** with broken re-rebase recovery. A wide funnel feeding a narrow, leaky spout: the more productive the front gets, the harder it leans on the single weakest part of the back. This is a primary structural cause of "we generate tons of work but can't get it out the door."

### Evidence this is real, not theoretical

Standing open-bug cluster, all describing this exact failure:
- PAN-1240 — Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery
- PAN-1215 — Post-review rebase strands PR at review=pending forever
- PAN-1213 — review/test reset by deacon after rebase without re-dispatch
- PAN-1658 — testStatus stuck 'pending' after rebase/force-push despite green CI, no reconciler

Concrete cascade observed 2026-06-07/08: the "substrate" batch (PAN-1613 / PAN-1615 / PAN-1616 / PAN-1617 / PAN-1395) all touched the same core files (`src/lib/cloister/deacon.ts`, `src/lib/agents.ts`, `src/lib/cloister/inspect-agent.ts`) within ~24h. `deacon.ts` was touched by three of them. Each one landing forced the next to rebase and re-run verification against it — a serialized re-verify chain.

## Core idea

Think of `main` like a shared Google Doc. Features that edited **different files** can't collide — batch them and verify once. Only features that edited the **same files** must go one at a time, in a smart order. The conflict graph this needs is **already computed** in `src/lib/flywheel-merge-order.ts` (`computeMergeQueue` builds a pairwise file-overlap graph) — but today it only sorts by issue number and is **display-only**; nothing acts on it.

## Design: two modes, one engine

### Shared engine
1. Take the current ready-to-ship set.
2. Partition into **disjoint** (different files) vs **conflict-connected clusters** (shared files) using the file-overlap graph (already computed). `git merge-tree` is an optional precision upgrade, applied lazily only to flagged pairs.
3. Order: **unblocker fixes first** (a fix that un-hangs everyone's required checks), then disjoint batches, then within a conflict cluster **broadest-file-footprint first** (so the rest rebase once).
4. Advance: as each lands, **auto-rebase the overlapping stragglers onto updated main + re-verify**, continue. Disjoint features never need rebasing. **Stop at the first one that needs work** (A and B ship, C is held, D ships if it doesn't actually depend on C).

### Auto-merge ON (master switch = existing auto-merge toggle)
Engine advances **continuously and automatically**, shipping each feature as it passes, up to the batch cap. No human in the loop.

### Auto-merge OFF
Engine assembles an **on-demand UAT-candidate branch** containing the current ready set (A+B+C+D integrated, pre-reconciled). Human UATs the **whole batch in one sitting**, then ships the passing prefix. Kills the "UAT one → merge → wait for rebase → come back later → UAT the next" ping-pong. The dashboard exposes a **"merge next N"** control (default-filled with the recommended safe batch) so the human picks how many of the next ones to ship.

## On-demand UAT candidate — NOT persistent stacked PRs

One **disposable** integration branch assembled from whatever is ready when the human sits down. The actual **landing happens through each feature's own existing PR**, preserving per-issue review status and close-out. "Ship up to B, C needs work" = merge A's and B's PRs, reassemble candidate as A+B+D, retest.

Rejected alternative — a persistent ladder of cumulative branches (A, AB, ABC, ABCD): four branches that all churn whenever A changes, and a mid-stack failure still forces rebuilding the tail. Strictly more complexity, marginal benefit. (It also glues D behind C even when D doesn't depend on C; the on-demand model can ship A, B, D and hold only C.)

**Branch naming:** `uat/<project>-<YYYY-MM-DD>` (e.g. `uat/pan-2026-06-09`); PR body lists included issue IDs. The auto (fast) lane needs no candidate branch — it merges feature branches directly.

## Conflict handling

- Clean rebases → auto-advance.
- Genuine textual conflict (rebase can't auto-resolve) → **flag as blocked** and surface on the Awaiting Merge "Blocked" section (today's `CONFLICTING` behavior). **Not** force-merged, **not** auto-agent-resolved. Fully-autonomous conflict resolution is a separate future opt-in.

## Config

- **Master switch:** the existing auto-merge toggle (per project). ON = continuous train; OFF = UAT-candidate batch.
- **Batch-size cap:** configurable, default **5**, `0` = unlimited. (A disjoint batch is safe by construction; the cap is a blast-radius comfort knob.)
- **Unblockers jump the line:** on by default.
- **No new countdown:** reuse the existing 5-min auto-merge cooldown (`AUTO_MERGE_COOLDOWN_MS`) as the cancel valve (`pan merge` cancels during it). No new timer.

## Forward-compatibility (Phase 2 — design the seam now, build later)

Per-issue **`uat-required` vs `auto-mergeable`** classification as the **routing key**:
- Fast lane (hotfixes, chores, version bumps, typos) → continuous auto train.
- UAT lane (user-facing features) → UAT candidate batch.

Both lanes run concurrently. This turns "auto-merge" from one global switch into honest per-issue routing. Build the *seam* (a per-issue flag drives lane assignment) in this issue; build the *classifier* (label/heuristic/plan-time) in a follow-up.

## Key code seams

- `src/lib/flywheel-merge-order.ts` — already computes the conflict graph; make it **drive** order (not sort-by-issue-number, not display-only).
- `src/dashboard/server/services/auto-merge-executor.ts` — replace FIFO-by-`scheduledMergeAt` with engine order.
- `src/lib/database/pending-auto-merges-db.ts` / `merge-queue-db.ts` — per-project serial queue; extend for batch/candidate.
- `src/lib/cloister/merge-rebase.ts` + `verification-runner.ts` (`sync-target-branch`) — the rolling rebase-onto-updated-main + re-verify loop.
- `src/lib/webhook-handlers.ts` (`refreshMergeStateFromGitHub`, `mergeable`) — conflict detection / blocked flagging.
- `src/dashboard/frontend/src/components/AwaitingMergePage.tsx` + `src/dashboard/frontend/src/lib/store.ts` (`selectAwaitingMerge`) — add "merge next N" control (OFF mode) and the UAT-candidate view.

## Subsumes / relates

Structurally fixes the root cause behind PAN-1240, PAN-1215, PAN-1213, PAN-1658. Touches the Awaiting Merge surface being improved in PAN-1686.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
