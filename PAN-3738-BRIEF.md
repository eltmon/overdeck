# PAN-3738 (rescoped) — busy-agent mail naming: dedup-keyed mail must be hook-drainable; delivered backups must be distinguishable

Issue (read the CORRECTION comment first — the original body was a misdiagnosis): https://github.com/eltmon/overdeck/issues/3738

## Verified mechanics (do not re-derive; verify line numbers before editing)

- `queueAgentMail` (src/lib/agents/messaging.ts:~80-100): dedup-keyed messages are named `dedup-<sha256-24>.md` REGARDLESS of `pendingTurnEndDelivery`; unkeyed busy mail gets `<ts>.pending.md`; unkeyed post-delivery backups get `<ts>.md`.
- The codex notify hook drains ONLY `*.pending.md`, oldest-first, one per turn end, deleting after successful tmux paste+submit (sync-sources/hooks/codex-notify-hook:~70-95).
- The monitor transport treats `*.md` but NOT `*.pending.md` as plain mail it may drain for display (`isPlainMailFile`, src/lib/agents/monitor-transport.ts:147).
- Consequences: (a) a dedup-keyed message to a busy codex agent strands forever (`dedup-*.md` matches no drain path for conversations, which run no monitor); (b) post-delivery backups (`<ts>.md`) accumulate in `mail/` and are visually indistinguishable from queued mail — this misled two investigations on 2026-08-14.

## WI-1: Dedup-keyed busy mail becomes hook-drainable

In `queueAgentMail`, when BOTH `dedupKey` is defined AND `pendingTurnEndDelivery` is true, name the file `dedup-<hash>.pending.md` (deterministic per key, so crash-replay still overwrites the same file; `.pending.md` suffix so the notify hook drains it).

Before changing, run a **no-loss audit of every filename consumer**: `git grep -rn "dedup-\|pending.md\|\.md" -- src/lib/agents sync-sources/hooks src/cli/commands/monitor.ts` and list, in your report, every code site that matches mail filenames, with a one-line statement of how the new name flows through it. Known consumers to check: codex-notify-hook filter (endsWith `.pending.md` — catches the new name), `isPlainMailFile` (excludes `.pending.md` — correct), any dedup-overwrite/cleanup logic keyed on the exact `dedup-*.md` name, and tests.

## WI-2: Delivered backups distinguishable from queued mail

Rename the post-delivery durable backup (the `queueAgentMail(normalizedId, message, false)` call after successful delivery, messaging.ts:~611-618) so a human inspecting `mail/` can tell receipt from queue — suffix `.delivered.md` via a new explicit parameter or a small dedicated writer.

CONSTRAINT: this must not change monitor display behavior silently. `isPlainMailFile` currently includes these backups in monitor drain; decide ONE of: (a) keep them monitor-drainable by adding `.delivered.md` to the plain-mail filter, preserving today's monitor behavior exactly, or (b) exclude them and state why. Default to (a) — behavior-preserving. Document the choice in the commit body.

## WI-3: Soften the overclaiming comment from PAN-3736

`busyAgentQueuedReason`'s doc comment (messaging.ts:~70-77) says PAN-3738 "tracks the queue that nothing drains for conversations" — now false. Reword to: timestamp-named pending mail IS drained by the codex notify hook at turn end; the strand risk was dedup-keyed mail (fixed by this change). Do not change the user-facing phrase itself.

## WI-4: Tests

Extend `src/lib/agents/__tests__/messaging-busy-agent-mail.test.ts` (added by PAN-3736) with the filename matrix: (dedupKey × pendingTurnEndDelivery) → expected filename shape; delivered-backup suffix; and assert the notify-hook filter predicate (`endsWith('.pending.md')`) matches the new dedup-pending name — express that as a plain string assertion so drift in either side breaks the test. If monitor filter behavior changes (WI-2 choice), test `isPlainMailFile` accordingly.

## Verification gates (all from worktree root; report tail output of each)

1. `npx vitest run --configLoader runner src/lib/agents/__tests__/`
2. `npx vitest run --configLoader runner src/cli/commands/__tests__/tell.test.ts src/cli/commands/__tests__/monitor*.test.ts` (skip a pattern if no such file — say so)
3. `npx tsc --noEmit`
4. `npx eslint <every changed .ts file> --no-inline-config`

## Constraints

- Worktree `/home/eltmon/Projects/hoff-pan-3738`, branch `feature/pan-3738`; verify with `git branch --show-current` first. Never `git checkout`/`git stash`; never touch `/home/eltmon/Projects/overdeck`.
- Scope: mail file NAMING, the comment fix, and tests. Do NOT touch delivery/paste mechanics, retry logic, `delivered`/`queuedToMail` semantics, or the notify hook script itself unless the no-loss audit proves a consumer must change — if so, justify per file in the report.
- Deps are symlinked; if a tool hits EROFS on `node_modules` caches, redirect its cache into the worktree — never into the primary checkout.
- Commit when green: `fix(agents): drainable dedup-keyed busy mail + distinguishable delivered backups (PAN-3738)`. Do NOT push. Do NOT commit this brief.
- Pre-existing gate failures outside your files: report and stop.

Report: files changed, diff summary, the consumer no-loss audit table, each gate's tail output, commit SHA.
