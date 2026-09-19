# Brief: implement PAN-2541 directly on main (operator-authorized bypass)

Read, in order, before writing any code:
1. `.pan/drafts/pan-2541.md` — the PRD. It is the **execution source of truth** (hardened through three review layers, 2026-07-09, including the D12 completion-marker, WI-2 migration-lock/atomic-push, D10 domain-writer conflict model, D13 redirect repair, WI-11 site 8, and the WI-10 manifest/failure-matrix amendments).
2. `.pan/drafts/pan-2541-FEEDBACK-gpt5.6-sol.md` — the second-eyes findings the PRD now incorporates (context for WHY).
3. The vBRIEF spec at `.pan/specs/2026-07-09-PAN-2541-*.vbrief.json` — use its 18 items and dependency edges as your work order, but **where the spec and the amended PRD disagree, the PRD wins** (the spec predates the final amendments; do not re-plan it).
4. https://github.com/eltmon/overdeck/issues/2541 including comments.

## Mode (identical to your PAN-2545 run)
- Work **directly on the primary `main` worktree** (`/home/eltmon/Projects/overdeck`). Operator-directed. No feature branch, no PR, no `pan done`.
- Commit per work item as it lands, path-scoped (`git commit -- <files>`), meaningful messages, never `--amend`, never `git stash`. The operator reviews commits continuously and owns all pushes.
- NEVER restart the dashboard/supervisor, never spawn agents, never run `pan up`/`pan restart`/`pan tell`. The deacon is frozen and stays frozen.

## Order of work
Follow the spec's DAG: foundations first (`state-branch-paths`, `resolve-state-home`), then doors/guards/remediations, migration command last among code items. The docs item and no-loss audit close it out.

## The hard boundary — the REAL migration run is NOT yours
Implement `pan admin state migrate` fully, including `--dry-run`, the WI-2 lock, the manifest, and the failure-injection test matrix. Validate against the throwaway-clone checkpoint (`git clone . /tmp/...` fixture). **Do NOT run the real migration against this repository or push `overdeck-state` to origin** — the live cutover is performed together with the operator after your code review. Same for other projects.

## Repo rules that intersect (do not skip)
- Fake timers for every retry/delay test (`vi.useFakeTimers()` + `advanceTimersByTimeAsync`).
- No `execSync` anywhere server-reachable; `execFileAsync`/`spawn` only.
- The known codex-sandbox false test failures (PAN-2511: git-fixture/socket/auth suites) are environmental — run your changed test files individually; the operator owns the full-suite baseline on the host.
- Quality gates before done: `npm run typecheck && npm run lint` green, plus your changed test files passing.

## Done means
All 18 spec items implemented + tested + committed on main (NOT pushed), dry-run migration validated on a throwaway clone, then reply in this conversation with: per-item commit SHAs, test names, and anything you deliberately deferred with the reason. If any step requires a decision the PRD does not make, STOP and ask here instead of guessing.
