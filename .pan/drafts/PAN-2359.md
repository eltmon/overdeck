# PAN-2359 + PAN-2363 — Shared "provably merged" guard: kill the `ahead==0` reap class

**Issues:** [PAN-2359](https://github.com/eltmon/overdeck/issues/2359) + [PAN-2363](https://github.com/eltmon/overdeck/issues/2363) (one PRD, two issues — same root-cause class, share a fix)
**Verified-Against:** main @ `6681632bfe6cd2fe4eb933e225edda8d23805edf`
**Author:** orchestrating conversation via PRD agent
**Part of:** [PAN-2376](https://github.com/eltmon/overdeck/issues/2376) epic, Phase 2 — strike + swarm merge-path hardening

---

## Glossary

- **Strike workspace / worktree** — a `workspaces/feature-<id>-strike` git worktree on the `strike/<id>` branch, created by `pan strike <id>` via `ensureStrikeWorktree` in `src/cli/commands/strike.ts:93–119`.
- **Strike reaper** — `reapMergedStrikeWorkspaces()` in `src/lib/cloister/strike-workspace-reaper.ts`; runs each deacon patrol; destroys strike worktrees whose branch appears merged.
- **Slot worktree** — `workspaces/feature-<id>-slot-N` git worktree on `feature/<id>-slot-N` branch; created by the swarm dispatcher.
- **Slot GC** — `gcMergedSlots()` in `src/lib/cloister/deacon-swarm-gc.ts`; destroys slot worktrees + branches + assignments when a slot is classified `status === 'merged'`.
- **`ahead==0` class** — the family of bugs where `git rev-list --count origin/main..<branch>` returns `'0'` on a freshly-created branch that has never received a commit, making it indistinguishable from a fast-forward–merged branch.
- **FF-merged strike** — a strike branch whose commits were merged into `origin/main` via fast-forward (current broken kickoff flow). Its tip is an ancestor of `origin/main`, so `ahead==0` AND the commits existed.
- **Fresh branch** — a branch just created from `origin/main` with 0 commits of its own. Its tip is the SAME commit as the common ancestor with `origin/main`.
- **statusOverrides** — the per-item `{ [itemId]: 'completed' }` map written to the feature workspace's record at `<workspace>/.pan/records/<issueId>.json`; the authoritative durable signal that a slot's work is done.
- **`totalCommits`** — `git rev-list --count <merge-base>..<branch>`, counting commits made on the branch but not present in `origin/main` at branch-creation time. Zero for a fresh branch, >0 for any branch that ever received a commit.

---

## Problem (verified 2026-07-04 against main @ `6681632b`)

### PAN-2359: strike reaper reaps fresh strike workspaces

`reapMergedStrikeWorkspaces` in `src/lib/cloister/strike-workspace-reaper.ts:48` contains the guard (lines 67–79):

```ts
// Reap only when the branch is fully merged (0 commits ahead of origin/main),
// so unmerged strike work is never lost.
...
ahead = stdout.trim();  // git rev-list --count origin/main..${branch}
...
if (ahead !== '0') continue; // has unmerged commits — never reap
```

A branch created via `git worktree add -b strike/pan-N <path> origin/main` starts at `origin/main`'s HEAD. `git rev-list --count origin/main..strike/pan-N` is **always `'0'`** for this brand-new branch, so `ahead !== '0'` does not trigger the `continue`. The reaper proceeds to remove the worktree and delete the branch.

The only liveness guard is `sessionExistsSync('strike-pan-N')`. But `ensureStrikeWorktree` (worktree creation) runs **before** `spawnAgent` (tmux session creation) in `strike.ts:185–192`. There is a race window — sometimes many seconds — between worktree creation and session visibility. The deacon patrol can execute entirely within this window and reap a live fresh workspace.

Observed 2026-07-04: `strike-pan-2357` was reaped seconds after spawn; the agent found itself on branch `main`, correctly refused to edit, escalated.

### PAN-2363: slot GC classifies fresh 0-commit slot branches as merged

`reconcileSlotState` in `src/lib/agents/slot-reconcile.ts:97`:

```ts
const merged = options.statusOverrides?.[slotItem.itemId] === 'completed' || branch?.merged === true;
```

`branch.merged` is set by `listSlotBranches` (slot-reconcile.ts:113–125), which runs `git branch --merged HEAD` (line 177). A freshly dispatched slot branch created from the feature branch HEAD passes `--merged HEAD` immediately before the slot agent's first commit — same `ahead==0` class.

`gcMergedSlots` in `src/lib/cloister/deacon-swarm-gc.ts:21` processes every `slot.status === 'merged'` slot and destroys the worktree + branch + assignment. Its only liveness guard is a tmux session check (line 24), which has the same startup race window as the strike reaper.

---

## Requirements

- **FR-1 (PAN-2359)** — The strike reaper MUST NOT reap a strike workspace whose branch was never committed to (i.e., has `totalCommits == 0`, meaning the branch tip equals the merge-base with `origin/main`). `ahead==0` alone is never sufficient.
- **FR-2 (PAN-2363)** — A slot's `status: 'merged'` classification MUST require `statusOverrides[itemId] === 'completed'`. `branch.merged === true` from `git branch --merged HEAD` MUST NOT be the sole trigger for destructive GC.
- **FR-3** — A genuinely FF-merged strike branch (had commits, all now in `origin/main`) MUST still be reaped on the next patrol after the session dies.
- **FR-4** — A genuinely merged slot (statusOverrides confirmed) MUST still be GC'd.
- **FR-5** — New regression tests: fresh 0-commit strike branch is not reaped; fresh 0-commit slot branch is not GC'd; genuinely used + merged branches are still reaped / GC'd.
- **NFR-1** — No new explicit `any`; async only; no `execSync`; no new files ≥ 1,000 lines.

---

## Work items

### W1 — Add `totalCommits` guard to the strike reaper (FR-1, FR-3)

**File:** `src/lib/cloister/strike-workspace-reaper.ts`

**Current guard (lines 67–79):**

```ts
// Reap only when the branch is fully merged (0 commits ahead of origin/main),
// so unmerged strike work is never lost.
let ahead: string;
try {
  const { stdout } = await execAsync(
    `git rev-list --count origin/main..${branch}`,
    { cwd: projectRoot, encoding: 'utf-8' },
  );
  ahead = stdout.trim();
} catch {
  continue; // can't determine merge state — leave it for a future patrol
}
if (ahead !== '0') continue; // has unmerged commits — never reap
```

**After (replace from the comment through the `if (ahead !== '0')` line):**

```ts
// Reap only when the branch is fully merged:
//   1. ahead==0: no commits on the branch that are not in origin/main.
//   2. totalCommits>0: the branch was used (had ≥1 commit) before being merged.
// A freshly-created branch has ahead==0 AND totalCommits==0 — it was never
// committed to (PAN-2359: `ahead==0` alone is not a safe reap signal).
let ahead: string;
let totalCommits: string;
try {
  const mergeBase = (await execAsync(
    `git merge-base origin/main ${branch}`,
    { cwd: projectRoot, encoding: 'utf-8' },
  )).stdout.trim();
  ahead = (await execAsync(
    `git rev-list --count origin/main..${branch}`,
    { cwd: projectRoot, encoding: 'utf-8' },
  )).stdout.trim();
  totalCommits = (await execAsync(
    `git rev-list --count ${mergeBase}..${branch}`,
    { cwd: projectRoot, encoding: 'utf-8' },
  )).stdout.trim();
} catch {
  continue; // can't determine merge state — leave it for a future patrol
}
if (ahead !== '0') continue;     // has unmerged commits — never reap
if (totalCommits === '0') continue; // branch was never committed to — fresh, not merged
```

Grep anchor for the replacement target: `if (ahead !== '0') continue; // has unmerged commits — never reap` (currently the only occurrence in the file).

**Test:** extend `src/lib/cloister/__tests__/strike-workspace-reaper.test.ts` (file exists; search for `Two strike worktrees + one feature worktree`):

- `fresh 0-commit strike branch is not reaped`: create a strike worktree at `origin/main` HEAD with no additional commits; assert `reapMergedStrikeWorkspaces` returns `[]` (no action).
- `used and ff-merged strike branch is reaped`: create a strike worktree, make one commit, fast-forward it into main (so branch tip is in main), assert the worktree is reaped.

Both tests must use a real git repo in a temp dir (matching the existing test's pattern). Use `vi.useFakeTimers()` only if any delay is introduced; none is expected here.

---

### W2 — Demote `branch.merged` to advisory-only in slot classification (FR-2, FR-4)

**File:** `src/lib/agents/slot-reconcile.ts`, line 97:

**Current:**

```ts
const merged = options.statusOverrides?.[slotItem.itemId] === 'completed' || branch?.merged === true;
```

**After:**

```ts
// PAN-2363: branch?.merged comes from `git branch --merged HEAD` which returns
// true for any 0-commit slot branch created from the feature tip. This is the
// `ahead==0` class. Durable completion proof is statusOverrides ONLY; branch.merged
// is no longer a destructive trigger.
const merged = options.statusOverrides?.[slotItem.itemId] === 'completed';
```

The `branch` field remains on `ReconciledSlotItem` (it is used in `gcMergedSlots` for the branch name — `slot.branch ?? fallback` on line 30 of `deacon-swarm-gc.ts`). Only the destructive classification changes; the field is still populated.

`gcMergedSlots` in `src/lib/cloister/deacon-swarm-gc.ts` already guards `if (slot.status !== 'merged') continue` (line 21), so it will correctly skip any slot whose status is no longer 'merged'. No changes needed in `gcMergedSlots` itself.

`listSlotBranches` in `slot-reconcile.ts:113–125` still populates `branch.merged` from `git branch --merged HEAD`. This field is now advisory only — remove the use from the `merged` expression above but retain the field in the type and the git call (other callers may still use it for display or future non-destructive purposes).

**Test:** extend or add to `tests/unit/lib/agents/slot-reconcile.test.ts` (create if it does not exist; grep for existing test file with `reconcileSlotState`):

- `fresh 0-commit slot branch with branch.merged=true and no statusOverride is NOT classified merged`: construct `reconcileSlotState` with a `listBranches` dep that returns `{ merged: true }` and a `statusOverrides` of `{}`. Assert `result.merged` is empty and `result.inFlight` or `result.pending` contains the slot item.
- `statusOverrides completed classifies as merged regardless of branch.merged`: same setup but `statusOverrides[itemId] = 'completed'`. Assert `result.merged` contains the item.

---

## Explicitly out of scope

- Squash-merged strike branches: they always have `ahead > 0` (the original commits are NOT in origin/main after a squash), so the existing `if (ahead !== '0') continue` guard already prevents reaping. No change needed for squash.
- Changing the slot `applyTaskOperationToPlanFile` merge path: the merge path already writes `statusOverrides` via `mirrorTaskOperationToRecord` (PAN-2372 covers the gap where this write is missing at `pan done` time).
- Cleaning up existing stale slot branches that were mislabeled as merged — out of scope.
- PR-state verification for the strike reaper: the `totalCommits` guard is sufficient and avoids a GH API dependency in the reaper hot path.

---

## Intersecting repo rules (restated for the executor)

- Async only; never `execSync` in server-reachable code (both files patched here are deacon hot paths).
- No new explicit `any`.
- Full gates before `pan done`: `npm run typecheck`, `npm run lint`, `npm test` (0 failed).
- Keep `tests/unit/lib/cloister/in-flight-guard.test.ts` green (merge-path invariant).
- Two-door state rule: no direct DB or `state.json` access for canonical state; mutations only through record writers (`writeIssueRecordForWorkspaceSync` etc.).
- Work in the feature workspace; never `git checkout` another branch inside the worktree.

---

## Acceptance criteria (map 1:1 to work items)

- **AC-1 (W1):** Regression test proves a fresh 0-commit strike branch is not reaped; a branch that had commits and was FF-merged is still reaped. `reapMergedStrikeWorkspaces` only removes branches that satisfy BOTH `ahead==0` AND `totalCommits>0`. (FR-1, FR-3, FR-5)
- **AC-2 (W2):** Regression test proves a slot with `branch.merged=true` but no `statusOverrides` entry is NOT classified `status: 'merged'`; a slot with `statusOverrides[itemId]='completed'` IS classified merged. `gcMergedSlots` never receives a fresh branch as a `merged` slot. (FR-2, FR-4, FR-5)
- **AC-3:** `npm run typecheck && npm run lint && npm test` all pass; no new `any`; no `execSync`.
