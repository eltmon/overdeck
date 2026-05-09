# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-05-09 (Run 16) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-1044 | in_progress | Agent implementing — Command Deck: Project Overview Panel with pipeline swimlanes. Active agent (agent-pan-1044). | 0 | 0 | PAN-1044 agent healthy |
| PAN-1030 | in_review | Agent at confirmation prompt awaiting user input. Issue is `Surface 'awaiting user input' state` — the agent IS the feature. | 0 | 0 | agent-pan-1030 at prompt; needs human to respond |
| PAN-1034 | in_review | review-coordinator dies on specialist timeout. Review-coordinator sessions dying; needs fix. | 0 | 0 | review-coordinator dead; specialist timeout |
| PAN-945 | in_review | Planning artifact path mismatch (`pan plan` writes to `api/docs/prds/planned/` vs runtime reads from `<workspace>/.planning/`). | 0 | 0 | Was in_progress; now in review |
| PAN-1029 | in_review | Harness picker UI never landed — PAN-636 shipped backend + CLI. | 0 | 0 | Harness picker UI incomplete |
| PAN-934 | in_progress | CLIProxy auto-install on startup + macOS `/proc/meminfo` ENOENT + title generation failure. | 0 | 0 | agent-pan-934 healthy |
| PAN-977 | in_progress | DAG-driven swarm dispatch implementation. | 0 | 0 | agent-pan-977 healthy |

---

## Cycling Alerts

| Issue | Phase | Runs Stuck | Why It Cycles | Candidate Fix | Status |
|-------|-------|------------|---------------|---------------|--------|
| PAN-457 | in_review | 2+ | mergeStatus=merged but PR was closed without merge; agent re-doing work. PAN-1027 filed but not yet fixed. | Reset mergeStatus when GH PR state diverges (PAN-1027) | **PERSISTING — PAN-1027 not yet merged** |

---

## Infrastructure Gaps

| Gap | Impact | First Seen | Filed? | Status |
|-----|--------|-----------|--------|--------|
| Merge-status drift forward: deacon auto-detect paths skip postMergeLifecycle | Stale `in-review`/`in-progress` labels after GH merge | Run 15 | **PAN-1027** | Not yet fixed |
| Merge-status drift reverse: no path resets mergeStatus when PR reverted/closed | `mergeStatus=merged` persists after PR closed without merge | Run 15 | **PAN-1027** | Not yet fixed |
| `vbrief/active/continue-PAN-*.vbrief.json` workspace artifacts on main | Feature work leaks onto main during planning agent sessions; clutters tracked tree | Run 16 | No | **NEW — planning agents working directly on main** |
| Source files modified on main (src/, tests/) | Feature implementation done on main instead of in workspace; requires manual recovery to branch | Run 16 | No | **NEW — 20+ files salvaged via `git stash`** |

---

## Pattern Ledger

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| (Prior patterns unchanged — see OPERATION-FIX-ALL.md) | | | |
| **Feature work on main** | Modified source files (src/, tests/) and untracked new files on main branch; vbrief/active/continue-PAN-*.vbrief.json artifacts accumulating | Planning agent or user worked directly on main instead of in feature workspace | Stashed 20+ files via `git stash "salvageable: feature work leaked onto main"`; requires manual triage to assign to proper feature branches | Run 16 |
| **Snapshot bloat via `turnDiffSummariesByAgentId`** | WS bootstrap fails "Max payload size exceeded" | `state.turnDiffSummariesByAgentId` accumulates per-turn checkpoint diffs unboundedly | Hotfix: send `{}` over WS (a0a8829ea). Long-term in PAN-1024. | Run 15 |
| **Sync FS reads in getSnapshot hot path** | getSnapshot slows geometrically (50ms → 17s → 54s) | `computePlanningState` reads `plan.vbrief.json` per issue × 870 issues | mtime-cached `computePlanningState` (a0a8829ea) | Run 15 |
| **Case-sensitive vbrief continue-file paths** | Duplicate `continue-PAN-N.json` and `continue-pan-N.json` files | `continueFilename(issueId)` did not normalize case | Uppercase in `continueFilename` (c448ec02a) | Run 15 |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| **Merge-status reconciliation with GitHub PR state** | Inverse drift: `mergeStatus=merged` persists after PR closed-without-merge | High | **OPEN — PAN-1027 not yet merged** |
| Planning agent isolation from main | Agents ran planning sessions directly on main, producing source file modifications and vbrief artifacts on the tracked branch | High | **Run 16 — feature work stashed, not yet fixed in substrate** |
| Consolidated post-merge cleanup helper | Three deacon repair paths duplicate-or-skip postMergeLifecycle steps | High | **OPEN — PAN-1027** |
| Per-project specialist wake via API/CLI | Wake route only supports legacy global specialists | Medium | Ongoing |
| GitHub check status → Panopticon DB sync on server startup | When server was down during CI run, internal DB never learns panopticon/review passed | Medium | Ongoing |
| Review circuit breaker can't self-reset | Manual `pan review reset` after 7 requeues | Medium | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Medium | Ongoing |

---

## Run 16 Summary (2026-05-09)

**Main hygiene**:
- FLYWHEEL-STATE.md was deleted from working tree (not committed deletion) — **restored from HEAD**
- Feature work leaked onto main: 20+ source files modified, new untracked files created during planning agent sessions — **salvaged via `git stash "salvageable: feature work leaked onto main"`**
- `.gitignore` updated: added `vbrief/active/*.vbrief.json` (workspace artifacts) and `graphify-out/cost.json` (machine-specific output)
- Beads state synced and committed (`.beads/export-state.json`, `.beads/issues.jsonl`)
- Main is clean and pushed (`28410a4b4`)

**Issues inventoried**: 7 active PAN issues
- PAN-1044, PAN-934, PAN-977: In Progress (healthy agents running)
- PAN-1030, PAN-1034, PAN-945, PAN-1029: In Review

**Bugs found (to be fixed this run)**:
1. PAN-1034: review-coordinator dies on specialist timeout — substrate bug in review coordinator specialist dispatch
2. Feature work on main — planning agents not isolated to workspaces

**Still to do this run**:
- Drive PAN-1030, PAN-1034, PAN-945, PAN-1029 to readyForMerge
- Monitor PAN-1044, PAN-934, PAN-977 through pipeline
- Fix any substrate bugs found during oversight

**Bugs filed** (from prior run, still open):
- PAN-1027: Merge-status drift bidirectional — affects PAN-457 and stale-label issues

**Next-run priorities**:
1. Fix PAN-1034 (review-coordinator timeout)
2. Fix PAN-1027 (merge-status drift) — will clear PAN-457 and stale labels
3. PAN-1015 planning: claudish removal in favor of CLIProxy
