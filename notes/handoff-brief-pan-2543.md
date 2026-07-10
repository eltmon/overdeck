# Brief: implement PAN-2543 directly on main (operator-authorized bypass)

Read, in order, before writing any code:
1. `~/.overdeck/state/panopticon-cli/drafts/pan-2543.md` — the PRD, the **execution source of truth** (triple-reviewed 2026-07-09: my amendments, your own 7-finding feedback applied with operator decisions, and the vBRIEF-review amendments — typed ResumeGateBlock contract, intent-aware stoppedByUser matrix, monotonic slot-index requeue, durable needs-you trip identity, modal fixture + never-bare-Enter, model-divergence checkpoint with fallback, pinned cadences).
2. `~/.overdeck/state/panopticon-cli/drafts/pan-2543-FEEDBACK-gpt5.6-sol.md` — your own findings (context for why).
3. The spec `~/.overdeck/state/panopticon-cli/specs/2026-07-09-PAN-2543-*.vbrief.json` — 21 items + edges as work order; **where spec and amended PRD disagree, the PRD wins.**
4. https://github.com/eltmon/overdeck/issues/2543 — and skim the 14 cluster issue bodies it links; their acceptance criteria are binding (especially PAN-2536's, which the intent-matrix exists to satisfy).

## Mode (identical to your PAN-2541 run)
- Directly on the primary `main` worktree; no branch, no PR, no `pan done`. Commit per item, path-scoped, never `--amend`, never stash. Operator reviews continuously and owns all pushes.
- NEVER restart the dashboard/supervisor/deacon; never spawn or resume agents. The deacon is frozen and stays frozen — which is also why your patrol changes get runtime-verified only after an operator-driven restart, not by you.
- The project is now MIGRATED (PAN-2541): state reads/writes resolve to `~/.overdeck/state/panopticon-cli/`; never recreate `.pan/` or `.beads/` in the repo (the tripwire you helped build will flag it).

## Hard boundaries
- **WI-11's one-time ~90-issue label sweep is NOT yours to run.** Implement the patrol + `pan admin reconcile-labels --dry-run`; the operator runs the real sweep after review.
- **WI-16 (cluster close-out): do NOT close the 14 issues.** Deliver the per-issue mapping (issue → WI → commit SHA → test) in your final summary; the operator closes after verification.
- Every new re-drive/respawn path MUST route through the shared gate classifier + `decideResumeGate(block, intent)` and the memory admission gate (D12) — the WI-14 structural test enforces this; write it early, not last.

## Repo rules that intersect (do not skip)
- Fake timers for every retry/delay/cadence test; never real timers. No `execSync` server-reachable. `sendKeysAsync` + load-buffer for any tmux keystrokes (WI-10's modal answer).
- The codex-sandbox false test failures (PAN-2511) are environmental — run your changed test files individually; **but ALSO run the pre-existing suites for every module you touch before declaring an item done** (the PAN-2541 lesson: 31 regressions hid in untouched-by-you tests). The operator owns the final full-suite baseline.
- deacon.ts is at its file-size ratchet — extract new patrol logic into modules (you did this correctly with state-recreation-patrol.ts).
- Quality gates before done: `npm run typecheck && npm run lint` green + your changed-module suites green.

## Done means
All 21 spec items implemented + tested + committed on main (NOT pushed), the WI-16 mapping table delivered in your summary, dry-run label-reconciler output included, and anything deferred named with its reason. STOP and ask here if any step needs a decision the PRD doesn't make.
