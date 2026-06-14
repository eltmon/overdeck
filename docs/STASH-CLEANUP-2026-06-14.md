# Stash cleanup, 2026-06-14

Operator decision: agents do not use `git stash` for any reason. Existing
stash entries in the primary `panopticon-cli` worktree were reviewed as stale
or superseded. They are approved cleanup candidates; deleting the refs still
requires an explicit destructive-action approval in the harness.

## Reviewed entries

| Original ref | Commit | Date | Message | Contents | Disposition |
| --- | --- | --- | --- | --- | --- |
| `stash@{0}` | `4c65cc099800075c28c1ef7256cbd0fa1db8e2be` | 2026-05-25 | `salvageable:PAN-1476:2026-05-25:in-progress-state-and-launch-docs` | `.beads`, `.pan/continues/pan-1190.vbrief.json`, `docs/token-spend-report/index.html`, `graphify-out/*` | Old planning/report output; not needed for current work. |
| `stash@{1}` | `08ead17ef50011a811c90ccad155771ef86868a9` | 2026-05-23 | `salvageable:noise:2026-05-23:bot-state-noise` | `.pan/continues/pan-1190.vbrief.json`, one `.pan/specs/*PAN-1331*.vbrief.json` | Bot/planning residue. |
| `stash@{2}` | `1843f30d5814fb01bdc971439e2914a8c97297ef` | 2026-05-23 | `salvageable:scratch:2026-05-23:research-and-noise` | `.beads`, `.pan/continues/pan-1190.vbrief.json`, multiple `.pan/specs/*.vbrief.json` | Scratch planning residue. |
| `stash@{3}` | `7a91d41fe7fe091eb6fd17e4add70b7e70d0cfca` | 2026-05-23 | `salvageable:PAN-1408:2026-05-23T09:07:37Z:preexisting-record-cost-event-doc-diff` | `sync-sources/hooks/record-cost-event.js` | Superseded by current tracked source. |
| `stash@{4}` | `b7fc3fd49cd6a88b32903c6a3cb972f4f1bba2d9` | 2026-05-23 | `salvageable:PAN-1405:2026-05-23T08:51:48Z:preexisting-record-cost-comment` | `sync-sources/hooks/record-cost-event.js` | Superseded by current tracked source. |
| `stash@{5}` | `20615e26528da78174b9cbc11bad00cf035dd940` | 2026-05-23 | `salvageable:PAN-1331:20260523T082015Z:pre-existing-unrelated-edits` | `src/dashboard/server/routes/workspaces.ts`, `tests/lib/cloister/review-agent.test.ts` | Old Effect API cleanup; already in current code. |
| `stash@{6}` | `e49aa2f2933c2f4f2d243318d4678993564b1b04` | 2026-05-21 | `salvageable:PAN-1249:2026-05-21T04:01:29Z:runtime-and-checkpoint-effect-migrations-uncommitted` | `src/lib/checkpoint/checkpoint-manager.ts`, `src/lib/cloister/merge-agent.ts`, `src/lib/close-out.ts`, `src/lib/runtime/*` | Stale Effect migration snapshot. The migration has since landed while preserving legacy APIs where needed. |
| `stash@{7}` | `6f782cd2024efd33279268c70dae3deb1202dbc4` | 2026-05-09 | `salvageable:PAN-1024:2026-05-09T21:20:23Z:bun-lock-background-dirt` | `bun.lock` | Old lockfile noise. |
| `stash@{8}` | `865a058d9422aa4cdade7b620a56746a245288c5` | 2026-05-09 | `salvageable:PAN-1044:2026-05-09T21:18:00Z:pre-existing-record-cost-event-edits` | `scripts/record-cost-event.js` | Superseded by the current synced hook implementation. |
