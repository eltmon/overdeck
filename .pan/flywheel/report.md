# Flywheel report: run 2026-10-04 (stopped)

Run: 2026-10-04 02:04 → 20:10 UTC, stopped by the operator. Auto-pickup was
OFF. The loop drained the issues the operator started with `pan start` plus
the issues it filed itself, then handled the v0.65.0 release.

## Outcome

- **20 PRs merged, deployed and closed out**, all with no Definition-of-Done
  override: the 12 operator-started issues, PAN-4383 (stuck in review for 2
  days), and 7 issues the Flywheel filed and launched (PAN-4522, PAN-4523,
  PAN-4528, PAN-4529, PAN-4541, PAN-4543, PAN-4548).
- **v0.65.0 released:** npm `@overdeck/core@0.65.0` is `latest`, the GitHub
  release has 11 desktop assets, and a clean-cache `npx` prints `0.65.0`.
- **Live build `06b724af9bb` = `origin/main` tip**, reporting 0.65.0 (operator
  approved the restart at ~20:05 UTC).
- **No open PRs.**

## Merged, deployed and closed

| Issue | Commit | What |
| --- | --- | --- |
| PAN-4509 | d28b9815 | Docs lint: Mintlify math `$` and bare `<` |
| PAN-4507 | 967f1411 | Issue poller backs off when nothing changes |
| PAN-4506 | f68331a7 | Herdr review-kickoff `invalid_request` fix (unblocked PAN-4383) |
| PAN-4258 | 5ea1be0e | Planning effort levels |
| PAN-4383 | c90bc115 | Work agents blocked on an operator decision reach Needs-you |
| PAN-4257 | be8b33e4 | Tier effort reaches slots |
| PAN-4498 | 9ecda10a | Conversation bookmarks |
| PAN-4508 | 66777e33 | Jev settings in the dashboard |
| PAN-4528 | f22dee6a | New-conversation Skills field: descriptions and collapsible groups |
| PAN-4514 | ff4bad3d | AskUserQuestion is for decisions only |
| PAN-4256 | 832b65e0 | Effort on role launch surfaces |
| PAN-4522 | 849baa1d | God View: liveness survives dashboard restart |
| PAN-4529 | e98acf50 | Claude Code mods evaluation (report only) |
| PAN-4515 | 6d2e0eb7 | Idle conversations no longer jump to 'active just now' |
| PAN-4523 | 9c871fc4 | God View river: bands, merged-exit, stage counters |
| PAN-4260 | 19089607 | Harness effort correctness |
| PAN-4259 | 6eb8d3d1 | Show effort everywhere, record it in cost data |
| PAN-4541 | cd27acfd | Deploy preflight reads real imports only |
| PAN-4543 | b1490382 | `pan close`: deploy-probe retry, stale-artifact rule, async cost reads |
| PAN-4548 | 06b724af | lint-docs test uses `fileURLToPath` |
| release | 91d2ae9c | v0.65.0 (changelog `3f2e6f95`) |

## Waiting on the operator

1. **Conversation 3230 (held):** the supervised handoff for PAN-4527, 4532,
   4531, 4540 and 4534 (verification and auto-merge reliability). Press Send,
   or run `pan handoff start 3230`. Brief:
   `~/Projects/hoff-verify-merge-bundle/.pan/handoff-brief.md`.
2. **PAN-4551, the Effect upgrade** (4.0.0-beta.73 → 4.0.0;
   `@effect/language-service` 0.87.3): needs-handoff, sequenced after the 3230
   bundle merges.
3. **PAN-4546** (two concurrent quality gates with a pressure fallback) and
   **PAN-4547** (restore automatic close-out): needs-handoff.
4. **PAN-4530** (Flywheel idle rule): input for the flywheel/gauntlet design
   session; already applied through `state.md`.
5. **PAN-4550** (two tests depend on host state): low priority, not started.
6. **Review:** the Claude Code Mods Evaluation
   (https://claude.ai/artifact/JevxSris6qA2X34rjXxxdc) and the rescued PRD
   `.pan/drafts/operator-ui-parity.md` (never filed).

## Stream (flywheel/gauntlet design session)

Ready. The brief `.pan/drafts/flywheel-gauntlet-runs.md`, the `grilling`
skill, and `pan handoff --skill/--pack/--hold` are all present and checked.
Suggested addition to the kickoff: also read this report and
`.pan/flywheel/state.md` as a case study of a full drain-and-fix run.

## What the run learned (detail in state.md)

- **Throughput was bounded by machinery, not agents:** the five verification
  and merge bugs above, plus the single-slot gate queue.
- **Deploy restarts during verification lose review dispatches**
  (PAN-4532). Guard: never restart while a `verification-worker.js` is alive.
- **The Flywheel's own pushes to `main` can trigger the mergeability race**
  (PAN-4540): hold state pushes while a merge is pending.
- **Close-out is manual until PAN-4547:** `pan close <id> --force`, no overrides.
- **Release preflight on a host:** reinstall `node_modules` and clean `dist/`
  first. The 292 false test failures came from a stale install and a stale
  `dist/` chunk, not from agent environment variables. CI's green full-suite
  run on the exact commit is the test record.
- **Primary-checkout drift recurred** (17 spec flips, 2 stranded drafts) and
  was reconciled with the backup-first recipe; backup at
  `backup/primary-2026-10-04-worktree`.

## Unaddressed SHOULD-level review findings

- None outstanding: PR #4513's `fileURLToPath` finding was fixed by PAN-4548.
