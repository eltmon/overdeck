# Handoff brief — does `pan reload` kill the running Flywheel?

## Goal
Determine whether `pan reload` (dashboard rebuild + restart) tears down the running Flywheel orchestrator, and propose/implement a fix. Supervised investigation.

## Evidence (from the supervising session, 2026-07-01)
- Flywheel run **RUN-47** (gpt-5.5 Codex orchestrator, tmux session `flywheel-orchestrator` on socket `-L overdeck`) was running and working.
- The operator ran `pan reload` to deploy the PAN-2200 fix. **Immediately after**, RUN-47's tmux session had **vanished** AND its **active-run gate was stuck**:
  - `pan flywheel status` → "no active flywheel run" (0 flywheel sessions).
  - `pan flywheel start` → refused: *"Flywheel run RUN-47 is already active; pause, resume, or report it before starting another run."*
  - `pan flywheel resume` → failed: *"no such session: flywheel-orchestrator"*.
- So the session **died but the active-run gate was NOT cleared** → a stuck state that blocks a fresh `start`.
- **PAN-2108** (flywheel self-heals on orchestrator/omp death + records exit-status) did **not** fire.
- Recovery required `pan flywheel stop` (killed nothing live, cleared the gate, wrote the RUN-47 report) then `pan flywheel start` (→ RUN-49).

## Investigate (verify against code; cite file:line)
1. Read the `pan reload` command (likely `src/cli/commands/reload.ts`) — what exactly does it stop/restart? Does it kill tmux sessions, or restart the dashboard server process, and could either take out the `flywheel-orchestrator` session?
2. Flywheel lifecycle: `src/lib/cloister/flywheel*.ts`, the flywheel dashboard routes (`src/dashboard/server/routes/flywheel.ts`), and `pan flywheel start/stop/report/status/resume`. Is the `flywheel-orchestrator` tmux session a **child of the dashboard server process** (dies when the server restarts) or independent? Where is the active-run gate stored (SQLite? a file?) and what clears it?
3. Why didn't PAN-2108's self-heal fire for this case? Where is it wired (deacon patrol? boot reconciliation?) and what condition did it miss (session-gone-but-gate-set)?
4. Why did the active-run gate persist after the session died?

## Deliver
- **Root cause**: does `pan reload` kill the flywheel, and by what mechanism.
- **Fix** — one or more of: (a) make `flywheel-orchestrator` survive a `pan reload`/server restart; (b) on server boot, **auto-clear a stuck active-run gate** when its session is gone (so `start` isn't blocked by a dead run); (c) make PAN-2108 self-heal catch the session-gone-but-gate-set case.
- File a GitHub issue on `eltmon/overdeck` with the root cause + proposed fix. If you implement it, do so **on a feature branch**.

## Hard constraints (Overdeck dev rules)
- **Do NOT push to `origin/main`** and **do NOT run `pan done`** — this is a supervised conversation, not a pipeline agent. (An agent self-pushing to main is the exact defect tracked in PAN-2204.)
- Async tmux only (`sendKeysAsync`, never `sendKeys`); no `execSync` in server-reachable code; worktree discipline.
- tmux socket is `-L overdeck`; deacon logs at `~/.overdeck/logs/deacon.log`.
