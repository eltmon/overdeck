# State-Foundation Completion Brief — execute ALL of this, in one pass

**Authored 2026-06-16** by the orchestrating session, as a complete handoff. The goal: finish the
state-model foundation **completely** (not piecemeal) so the local SQLite DB becomes a disposable cache
and the flywheel/pipeline can be turned back on. Everything you need is here — verified file paths,
decisions already locked, dependencies, and acceptance. Do not re-derive; execute.

---

## 0. North Star (the whole point)

The local DB (`~/.panopticon/panopticon.db`) is a **disposable cache**. The four sources of truth are:
1. **GitHub** — issue status, PR review/merge state.
2. **git** — code + plans (`.pan/specs/`, `.pan/drafts/`) + the **per-issue record** (`.pan/records/`). These travel across machines via clone.
3. **JSONL transcripts** — `~/.claude/projects/.../*.jsonl` (harness session history).
4. **tmux (`-L panopticon`)** — liveness oracle for whether an agent is actually running.

"Foundation done" = you can delete the DB and rebuild the board + agents + verdicts from the above.
Canonical docs: `reference/state-model.mdx`, `docs/AGENT-STATE-PLANES.md`, epic **PAN-1919**.

---

## 1. WORKING CONSTRAINTS — read before touching anything

> **SCOPE: STATE FOUNDATION ONLY.** Do exactly the items in §3–§5: PAN-1919, PAN-1921, the records-plane
> wiring, the integrity bugs **PAN-1929 / PAN-1931 / PAN-1932**, plus reviewing+merging the two in-flight
> agents (PAN-1922, PAN-1925). **Everything else is OUT OF SCOPE** — including PAN-1927 and PAN-1928. Do
> **not** touch out-of-scope issues and do **not** push any remaining work **through the pipeline**
> (`pan plan` / `pan start` → review → test → merge). The flywheel will pick those up when it's turned
> back on.
>
> **Work the in-scope state issues DIRECTLY (operator-merged bypass), NOT through the pipeline** — the
> pipeline machinery is exactly what this work is changing underneath itself, and the flywheel is off.
> Implement on the feature branch, run the gates, hand the diff to the operator (or merge per the
> operator's standing direction) in the §6 dependency order. Recoverable git only.


- **Recoverable actions only.** FORBIDDEN one-way doors: force-push, `rebase -i`, `reset --hard`,
  `commit --amend` on pushed commits, branch/workspace deletion, `git stash`, deep-wipe, deleting JSONL
  session files, `--no-verify`. Merges/normal pushes/file edits are fine.
- **No bandaids.** Root-cause every fix. Do not paper over symptoms; do not hand-edit the live DB to
  force a value; do not "make a failing protective check succeed."
- **Complete, not piecemeal.** Deliver every item below. A partial foundation provides zero value.
- **Dashboard server is Node 22 only** (never Bun). After changing dashboard server code:
  `npm run build` then `pan restart --dashboard --no-resume --health-timeout 180000`.
- **Before any schema/migration change reaches the live DB:** back it up first with an online sqlite
  backup (WAL-safe), then watch the migration boot. Example used today:
  `python3 -c "import sqlite3; s=sqlite3.connect(SRC); d=sqlite3.connect(DST); s.backup(d)"`.
- Async tmux primitives only (`sendKeysAsync`), no `execSync` in server code, fake timers for any
  delay/retry test, `pan sync` after hook/context changes.
- Do **not** pass `--model`/`--harness` when spawning (let Cloister route; kimi→pi, gpt-5.5→codex,
  claude-*→claude-code).
- **Never** write a destructive "delete X to prove nothing's lost" test (e.g. `rm -rf ~/.panopticon`).
  State derivability is a **property to validate non-destructively on a COPY**, never an imperative.

---

## 2. SCOREBOARD — verified status of every issue (2026-06-16)

| Issue | What it is | Status | Branch / PR |
|---|---|---|---|
| **PAN-1920** | Reconstruct cache from git+GitHub (replaces boot event-replay) | ✅ **DONE, CLOSED**, live | merged |
| **PAN-1847** | Delete dead `projection_cache` table + remove write-through | ✅ **merged today (#1930)**; table dropped live; issue still OPEN (closes on close-out) | `feature/pan-1847` merged |
| **PAN-1925** | Stop persisting `agent.output_received` (events table ~721 MB) | 🔄 **IN FLIGHT** — `agent-pan-1925` running, 3 beads | `feature/pan-1925` |
| **PAN-1922** | Verdicts reconstruction-safe | 🔄 **IN FLIGHT** — `agent-pan-1922` running, 5 beads | `feature/pan-1922` |
| **PAN-1919** | **KEYSTONE** — unified per-issue record; retire `state.json` as source | ❌ **NOT STARTED** (branch empty); planning vBRIEF being generated now | `feature/pan-1919` (empty) |
| **PAN-1921** | Single write surface + CI guard | ❌ **NOT STARTED** (empty local branch, no remote, no PR) | `feature/pan-1921` (empty) |
| **PAN-1929** | Auto-commit background rebase rewrites history in shared worktree | ❌ filed, unstarted — **fires repeatedly (3× today)** | — |
| **PAN-1931** | `complete-planning` force-adds gitignored `.pan/` via `git add -f` | ❌ filed, unstarted | — |
| **PAN-1932** | Schema migration downgrades `user_version` (DB newer than code) | ❌ filed, unstarted — **CONFIRMED LIVE RIGHT NOW** (`user_version` stuck at 55) | — |
| ~~PAN-1927~~ | Remove hardcoded model-fallback ladder | ⛔ **OUT OF SCOPE** — leave for flywheel | — |
| ~~PAN-1928~~ | Lock model switching to brand-new conversations | ⛔ **OUT OF SCOPE** — leave for flywheel | — |

---

## 3. The two IN-FLIGHT agents — let them finish, then REVIEW + MERGE them

These two are being implemented now by running work agents. Do **not** re-implement. Your job is to
**review each diff, run the gates, and merge** when the agent signals `pan done` (the flywheel is
stalled, so nothing auto-advances — you land them manually).

**PAN-1925** (`agent-pan-1925`, 3 beads) — Decision locked: **stop persisting `agent.output_received`
durably** (Option 1). Beads: `emit-only` (use `emitOnly()` not `appendAsync()` in
`src/dashboard/server/event-store.ts`), `purge-migration` (one-time startup purge of existing rows +
`PRAGMA incremental_vacuum`), `sse-frame-id` (omit `id:` for sequence<0 frames; keep
`agent.output_received` as a live-only event in `packages/contracts/src/events.ts`).
→ **Merge independently** whenever green.

**PAN-1922** (`agent-pan-1922`, 5 beads) — Decision locked: **hybrid split by ownership** —
Overdeck's own verdicts (review-convoy synthesis + test pass/fail) restore from the **per-issue git
record**; **PR-owned merge-state** (mergeable, CI) is **re-derived live from GitHub**. Beads:
`restore-core` (`restoreReviewStatusFromRecords()` rebuilds `review_status` from the record),
`blocker-refresh` (`refreshMergeStateFromGitHub()`), `restore-cli` (`pan admin db restore-verdicts`),
`wire-rebuild` (call restore from the `pan admin db rebuild` action in `src/cli/commands/db.ts`),
`noloss-audit` (round-trip every `review_status` column). Accepts `status_history` as lost on rebuild.
Decision recorded at issue #1922 comment. **Depends on PAN-1919 → merge AFTER 1919.**
Touches `src/lib/database/review-status-db.ts`, `src/dashboard/server/review-status.ts`,
`src/lib/pan-dir/records-backfill.ts`.

---

## 4. THE REMAINING WORK — all of it

### A. PAN-1919 — the keystone (DO FIRST; everything below leans on it)

Consolidate per-issue resume/progress state into **ONE git-tracked record**. Today it's scattered across
5 places (project continue `.pan/continues/<issue>.vbrief.json`, gitignored workspace
`.pan/continue.json`, machine-local `state.json` holding the only non-derivable data: **harness+model**,
the unwired records plane, and beads). **Decisions already locked:**
- **Rename "continues" → "record"** → `.pan/records/<issue>.json` (the maintainer dislikes "continues").
- **Location: the feature branch, not `main`** (progress churns; keep the immutable spec on `main`).
- **Fold `state.json`'s `harness`+`model` into the record**, then retire `state.json` as a *source*.
- **No-loss audit gate** (REQUIRED): a focused test asserting the new record is a **superset** of every
  field in (project continue ∪ workspace continue ∪ `state.json` harness/model): `decisions`, `hazards`,
  `resumePoint`, `beadsMapping`, `statusOverrides`, `sessionHistory`, `feedback`, `harness`, `model`.
  The test blocks until every field has a home.

Files: `src/lib/pan-dir/record.ts` (exists), `src/lib/pan-dir/records.ts` (exists),
`src/lib/vbrief/io.ts` (`updateItemStatus`/`updateSubItemStatus` — NB: these live in `vbrief/`, not
`pan-dir/`), `src/lib/agents.ts` (write harness/model into record at spawn; stop reading from
state.json), `src/lib/pan-dir/records-backfill.ts` (one-time migration from existing continues),
`readWorkspacePlan` callers in `src/dashboard/server/routes/{command-deck,specialists,workspaces}.ts`.
A planning vBRIEF is being generated at `.pan/specs/...PAN-1919....vbrief.json` — **read it** (or re-plan
with `pan plan PAN-1919 --auto`). Acceptance: epic PAN-1919 "Acceptance criteria" checklist, incl.
cross-machine resume (`git clone` + `pan start <issue>` resumes with full decisions/progress).

### B. PAN-1921 — single write surface + CI guard (AFTER 1919)

Route **all** durable per-issue mutations through 1919's single record writer; add a CI guard that fails
if code writes per-issue state to the filesystem outside that writer. The guard is referenced in
`reference/state-model.mdx` as `scripts/lint-state-writes.sh` (create it). Un-started (empty branch).

### C. Wire the records plane (folds into A/B)

`pan_records` is **NOT configured** in `projects.yaml` (verified: 0 occurrences); only 1 ad-hoc
`.pan/records/pan-1847.json` exists on main. Finish wiring it so records are produced + read by the
reconstruction path. `src/lib/pan-dir/records-backfill.ts` already builds a record from `review_status`
(the mirror direction); 1922 adds the restore direction.

### D. Integrity bugs — MUST fix (they break the state machinery itself)

- **PAN-1932 (do early — it's live):** `src/lib/database/schema.ts:744` —
  `if (currentVersion === SCHEMA_VERSION)` lets old code re-stamp a newer DB's `user_version`
  **downward**. Change `===` → `>=`. Then **regenerate** `sync-sources/hooks/record-cost-event.js` from
  source (the deployed hook re-stamps `user_version` and is the live downgrader — it's why the DB sits
  at 55 after PAN-1847's bump to 56). Do **not** hand-edit the generated hook. Full detail in issue
  #1932.
- **PAN-1931:** `src/dashboard/server/routes/issues.ts:1426` — `git add -f '.pan/'` force-adds
  gitignored `.pan/continue.json` + `.pan/spec.vbrief.json`. Drop the `-f` (only ephemeral files are
  gitignored; the canonical dirs `drafts/specs/continues/records` are tracked, so plain
  `git add '.pan/'` is correct). Add a test that this path respects gitignore. Detail in #1931.
- **PAN-1929 (the record-write reliability bug — 1919/1922 write to this path):**
  `src/lib/pan-dir/auto-commit.ts` runs a background `git rebase origin/main` in the **shared primary
  `main` worktree** and commits by pathspec, leaving `.beads` files unstaged so the rebase refuses on a
  dirty tree. **DO NOT "make the rebase succeed"** — that failure is protective against history-rewrite
  on the shared worktree. The correct fix is to **stop mutating the shared worktree / stop the
  background history-rewrite**. Full required direction in issue #1929.

### E. OUT OF SCOPE — do not touch, do not pipeline

**PAN-1927** (hardcoded model-fallback ladder) and **PAN-1928** (lock model switching) are **NOT part of
this effort.** They are filed and will be picked up by the flywheel when it is running again. Do not
implement them, do not plan them, do not route them (or any other non-state issue) through the pipeline.
They are listed here only so you know they are deliberately excluded, not forgotten.

---

## 5. Validation — prove the DB is disposable (NON-destructive)

On a **COPY** of `panopticon.db` (NEVER the live DB, NEVER `rm -rf ~/.panopticon`): run
`pan admin db rebuild-agents`, `pan admin db backfill-records`, and (once 1922 lands)
`pan admin db restore-verdicts`, then confirm the board, agents, and verdicts reconstruct. This validates
the north star without risking live state.

---

## 6. EXECUTION ORDER (dependency-correct)

1. **PAN-1932** then **PAN-1931** — small, mechanical; fixes the live downgrade + stops re-tracking junk.
2. **PAN-1929** — record-write reliability; 1919/1922 write to this path.
3. **PAN-1919 (keystone)** — read/finish the in-flight vBRIEF; land with the no-loss audit gate.
4. **PAN-1921** — write surface + CI guard, after 1919.
5. **Merge PAN-1925** (independent) and **PAN-1922** (after 1919) when their agents finish.
6. **Non-destructive rebuild validation** (§5).
7. **Then** the operator re-enables the flywheel — a **separate axis**: it was frozen for
   throughput/throttle reasons (PAN-1665/PAN-1666), not state. The flywheel then picks up the
   out-of-scope remainder (PAN-1927/1928, etc.). See `project_pipeline_throughput_unfreeze_plan`.

---

## 7. Per-issue landing checklist

- `npm run typecheck && npm run lint && npm test` green (no new failures).
- Dashboard server changes → `npm run build` → `pan restart --dashboard --no-resume --health-timeout 180000`.
- Schema/migration changes → back up DB first; watch the migration boot; confirm `user_version`
  advances and no table is wrongly dropped.
- Hook/context changes → `pan sync`, then verify the deployed artifact refreshed.
- Merge in the §6 dependency order; recoverable git only.

---

## 8. Gotchas / current live facts (so you don't relearn them the hard way)

- `user_version` is **stuck at 55** right now (PAN-1932 live) — the `projection_cache` table IS dropped;
  the version just won't advance until 1932's guard + a fresh hook land.
- `dist/dashboard/` accumulates content-hashed chunk orphans across builds; old
  `agent-state-service-*.js` chunks still contain `agent-runtime:` strings but are **not loaded** — only
  the chunk the fresh `server.js` imports matters. Harmless.
- The flywheel last ticked **2026-06-14** (stalled); `pan flywheel status` shows a stale HEAD.
- DB backup taken today (pre-PAN-1847):
  `/home/eltmon/.panopticon/panopticon.db.pre-pan1847.20260616-153029.bak`.
- `pan plan` agents run as `planning-*` tmux sessions and are **not** in the `agents` table, so they do
  **not** appear as live agents in the issue tree; **work** agents (`pan start`) do register and appear.
- Recurring non-fatal spawn-time noise to ignore until fixed: `[pan-dir/auto-commit] rebase failed for
  main` (= PAN-1929), and a `src refspec feature/1847 does not match any` push error in the dashboard
  log (a separate malformed-branch-name bug, not yet filed).

---

## 9. Issue links

PAN-1919 keystone · PAN-1920 (done) · PAN-1921 write-surface · PAN-1847 (merged #1930) ·
PAN-1922 verdicts (in flight) · PAN-1925 events (in flight) · PAN-1927 model-fallback ·
PAN-1928 model-switch-lock · PAN-1929 auto-commit-rebase · PAN-1931 force-add · PAN-1932 version-downgrade.
All on `github.com/eltmon/overdeck/issues/<n>`.
