# PAN-3736 — Post-spawn status honesty: fallback badge lifecycle + busy-agent queue messaging

Issue: https://github.com/eltmon/overdeck/issues/3736
Adjacent but OUT OF SCOPE: https://github.com/eltmon/overdeck/issues/3738 (queued mail is never drained for conversations — do NOT change delivery mechanics or the `delivered` return shape; that issue owns them).

## Context (do not re-investigate)

Conversation 2335 (`20260814-473d`) spawned via handoff with a degraded seed. Its row stores `forkFallbackReason = 'handoff-request-failed'` forever, and the dashboard renders a red `Fallback: handoff-request-failed` badge although the conversation has been active and completing turns for over an hour. Separately, when a peer messaged it mid-turn, `messageAgent` logged `queued mail for codex turn-end delivery: agent busy`, and the peer (and operator) read that as "the conversation is dead and needs a resume". The conversation was `active`, `isWorking: true` the whole time.

## WI-A: Fallback badge downgrades once the conversation is demonstrably alive

1. Locate the badge: `git grep -rn "forkFallbackReason\|Fallback:" src/dashboard/frontend/src` — find the component that renders the red badge from the conversation row.
2. New behavior:
   - RED (current styling) only while the fork is unresolved: `forkStatus` non-null (in-progress states) or `forkStatus === 'failed'`.
   - Once the conversation is healthy — `forkStatus` null AND status `active` AND (`sessionAlive` OR `lastActivityAt` after `createdAt`) — render the fallback reason as a NEUTRAL/muted informational chip (e.g. gray text `Seeded via fallback: <reason>`), or move it to a tooltip on an info glyph, per the dashboard style guide.
   - Load the `pan-style-guide` skill (Skill tool) BEFORE styling: color restraint rules apply — red is reserved for live failures; no decorative color; badge formula in the guide.
3. If the badge logic lives in a shared helper, change it there; do not fork per-view copies. Check both Broadsheet (default) and Ledger themes render acceptably if the component is theme-sensitive.

## WI-B: Busy-agent queue responses must say the agent is alive

1. `src/lib/agents/messaging.ts:515` currently logs `messageAgent queued mail for codex turn-end delivery: agent busy` and line ~518 returns `reason: 'queued for turn-end delivery'`.
2. Change the *user-facing strings only* (log line, returned `reason`, and wherever `pan tell` prints the outcome — trace the reason string to the CLI output):
   - New wording, one consistent phrase: `agent is alive and mid-turn; message queued to its mail file (<path>)` — states the agent is NOT dead, and does not promise turn-end delivery (PAN-3738 shows that promise is currently false for conversations).
   - `pan tell` should print the mail file path so a human or agent can verify/deliver manually.
3. Do NOT change: the `delivered`/`queuedToMail` return fields, the queueing behavior, drainMailOnce, or any retry logic. Strings and their propagation only.

## WI-C: Tests

- Badge state helper: unit-test the red-vs-neutral decision across the states in WI-A.2 (fork in progress → red; failed → red; healthy with stale fallback reason → neutral). Follow the existing frontend test style (`src/dashboard/frontend/src/lib/__tests__/`, vitest).
- Messaging strings: extend the existing messaging tests (`src/lib/agents/__tests__/`) to assert the new reason/log wording and that the mail path is included in the tell output.
- No fake-timer needs expected; if you touch anything with retries/delays, the repo rule requires `vi.useFakeTimers()`.

## Verification gates (run all from the worktree root; report tail output of each)

1. `npx vitest run --configLoader runner src/lib/agents/__tests__/`
2. Frontend: `npm --prefix ./src/dashboard/frontend run test -- <the test files you touched/added>` (match how package.json's `test` script invokes it)
3. `npx tsc --noEmit`
4. `bash scripts/lint-frontend-types.sh` (frontend typecheck) — if it needs a build first, say so rather than skipping silently
5. `npx eslint <every changed file> --no-inline-config`

## Constraints

- You are in git worktree `/home/eltmon/Projects/hoff-pan-3736`, branch `feature/pan-3736`. Verify with `git branch --show-current` before editing. Never `git checkout`, never `git stash`, never touch `/home/eltmon/Projects/overdeck` (primary checkout).
- Node deps are symlinked from the primary checkout; `packages/contracts/dist` is prebuilt. If a tool insists on writing inside a symlinked `node_modules` (cache EROFS-style failures), redirect its cache into the worktree or scratch space — do not modify the primary checkout.
- Touch only files that trace to WI-A/B/C. Commit when all gates are green with message: `fix(status): honest post-spawn status — fallback badge downgrades when healthy, busy-agent queue message says alive (PAN-3736)`. Do NOT push. Do NOT commit this brief.
- If a gate fails for pre-existing reasons outside your changes, report and stop rather than widening the diff.

Report back: files changed, diff summary, each gate's tail output, commit SHA, plus screenshots-in-words of the badge states you implemented (exact classNames/conditions).
