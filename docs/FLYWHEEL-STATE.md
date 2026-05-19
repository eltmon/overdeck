# Flywheel State — 2026-05-18 (Run 1)

This file is the per-run state snapshot written by `pan flywheel report`. The next `pan flywheel start` run reads it before doing anything else. Updated at the END of each revolution.

**Run window:** 2026-05-18T05:30Z → 2026-05-18T10:00Z (Claude Opus 4.7, custom twist brief)

**Headline result:** 6 substrate bugs filed and fixed in code; SWARM proven operational end-to-end on PAN-1148 (8 slot PRs merged across waves 0 and 2-3); PAN-1170 ready for user UAT/merge; PAN-1169 in review cycle.

---

## Active Pipeline

| Issue   | Phase                   | Root Cause / Blocker                                                                 | Auto-Requeues | Runs Stuck | Notes                                                                                |
|---------|-------------------------|--------------------------------------------------------------------------------------|---------------|------------|--------------------------------------------------------------------------------------|
| PAN-1170| ship complete, awaiting user merge | none — PR #1172 mergeable, CI green                                       | 0             | 0          | User UAT + click MERGE. 4 review cycles converged via gpt-5.5 work agent.            |
| PAN-1148| in_progress, swarm wave 3 active   | SWARM auto-advance still requires manual /api/swarm/slot-merged POSTs (#1178)| 0             | 0          | 8/43 plan items merged into feature branch (f1-f7 primitives + i1 audit + a4 deacon→health). 2 wave-3 slots still running. |
| PAN-1169| in_review cycle 2+, work agent iterating | tts-style review loops; cycle 1 blocked, cycle 2 verification mixed | 0             | 0          | PR #1187 open. Substrate bug fix for bun --filter docker init. Has not converged yet. |
| PAN-1052| parked (user-stopped 02-3am pre-reboot)   | stoppedByUser=true; --force needed to resume | 0             | 0          | Activity feed redesign. Substantive commits exist. User decides whether to resume.   |

---

## Cycling Alerts

None this run — first revolution. Watch list for next run:

- **PAN-1170 review loop convergence.** Took 4 cycles (~2h with gpt-5.5) to clear AC. If reviewers keep finding new blockers in the same area (TTS daemon lifecycle), it may indicate the AC set or review scope is overly broad. Mark as cycling if Runs Stuck ≥ 2 next time.
- **PAN-1169 review loop.** Just entering its cycle. Watch if it churns through 4+ cycles like 1170 did — similar pattern (work agent + reviewers in the same dashboard server module).

---

## Infrastructure Gaps

| Gap | Status | Notes |
|---|---|---|
| Stack-health gate fails for `pan-1148` and `pan-1169` workspaces (No Docker containers found) | Workaround: `--host --yes` | PAN-1169 itself is the fix for the bun --filter portion. |
| SWARM auto-advance requires manual `/api/swarm/slot-merged` POST after each slot PR merges | OPEN (#1178) | Deacon's merge-detection patrols only check issue-level PRs vs main, not slot PRs into feature branches. |
| `--max-slots N` is observed per-dispatch but auto-advance can spawn beyond N when many slots merge concurrently | OPEN, not blocking | Observed when 5 wave-2 slots dispatched after 2 slot-merged events fired. Real cap is the project's `current/maxAgentCapacity` (10). |
| Slot PRs require manual rebase to be mergeable | OPEN, not blocking | File overlap between slots produces non-fast-forward merge state. SWARM's `files_scope` should serialize but didn't catch overlaps in the wave-2 dispatch. Possibly missing/incomplete `files_scope` metadata on plan items. |
| Deacon's first-completion nudge sent `pan done <issueId>` to slot agents | Resolved (#1185, fix in `src/lib/cloister/deacon.ts`) | Slot agents now detected by workspace path suffix `-slot-N/` and skipped. Pushed at `a23753157`. |
| `pan show <bare-num>` resolution missing for PAN-prefixed issues | Resolved (#1173, fix in `src/lib/issue-id.ts`) | `resolveBareNumericId` probes `~/.panopticon/agents/agent-*-<num>/state.json`. Pushed at `9785dc2c9`. |
| Spec writer leaves stale `.writer.lock/` + `.tmp` debris on crash | Resolved (#1174, fix in `src/lib/vbrief/dag.ts` + `dag-cli.ts`) | `isPidDead` + `removeStaleLockAsync` reclaim orphan locks when owner PID fails `process.kill(0)`. 6 new regression tests. |
| SWARM dispatch: `git branch --show-current` against main project (impossible) | Resolved (#1175, fix in `src/dashboard/server/routes/swarm.ts`) | Direct probe of localList + remoteList for `feature/<lower>` and `feature/<numeric>`. Pushed at `df2b5c10a`. |
| SWARM slot ref naming `feature/<parent>/slot-N` collides with leaf parent ref | Resolved (#1176, fix in `swarm.ts` + `merge-agent.ts`) | Sibling naming `feature/<parent>-slot-N`. Workspace dir already used hyphen. Pushed at `a1d87cde0`. |

---

## Pattern Ledger

New recurring signatures observed this run:

- **Pattern: "Failed to dispatch any slots for PAN-XXX wave N" → almost always means `createSlotWorktree` errored.** Fast diagnosis: hit `POST /api/swarm` directly with the internal token to see the real error in `.errors[]`. The CLI swallows the per-slot errors and shows a generic message.
- **Pattern: dashboard log shows `[deacon] First-completion gap detected: <slot-agent>` followed by an unexpected feature → main PR within ~1 min.** Root cause: deacon's `pan done <issueId>` nudge. Fix: PAN-1185 (skip slot-pattern workspaces). If a stale-binary dashboard is running an older deacon, kill the workspace work agent (which is paused) and close the bad PR.
- **Pattern: `pan show <num>` reports DEAD for a clearly-running PAN agent.** Root cause: PAN-1173 (bare-number resolution). Workaround: use full `PAN-NNNN`. Fix landed at `9785dc2c9`.
- **Pattern: review specialist tmux sessions linger with `Pane is dead (status 0)` even after review completes.** Source: `remain-on-exit on` per session lifecycle. They count toward `tmux list-sessions` but not toward dashboard agent capacity. Safe to ignore; can be cleaned with `tmux kill-session -t <id>`.
- **Pattern: PAN-1170-style review-cycle convergence.** Work agent receives blocked verdict → reads `.pan/feedback/NNN-*.md` → commits a fix → `pan review request PAN-NNNN` → verification passes → review cycle 2 → repeat. Typical 3-5 cycles to convergence. Each cycle ~10-15 min with gpt-5.5 work + minimax-m2.7-highspeed main reviewer.

---

## Skill Gaps

- **Slot-PR-auto-merger.** Slot PRs need to be merged into the feature branch and then the merge-agent's slot-merged callback fired. Currently both steps are manual (rebase + `gh pr merge` + `curl /api/swarm/slot-merged`). A `pan swarm merge-slot <issue> <slot>` command (or auto-merge as part of dispatch) would close this gap.
- **Issue-level "consolidate feature → main PR" command.** Once all plan items merge, opening the final feature → main PR currently requires `pan done` from the work agent (which is paused during SWARM). Need either a `pan swarm ship <issue>` that creates the final PR explicitly, or wire the swarm runtime to spawn the ship role when `dispatchableItems(doc) == []`.
- **Run-report autosave.** End-of-run requires writing FLYWHEEL-STATE.md + appending to OPERATION-FIX-ALL.md + committing. A `pan flywheel report` command that snapshots the active pipeline, opens the file in the editor, and stages changes would shave off ~15 min of bookkeeping at every run boundary.
