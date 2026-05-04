---
specialist: review-agent
issueId: PAN-859
outcome: changes-requested
timestamp: 2026-04-27T23:14:51Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-859 fixes the Command Deck first-click terminal opening bug (REQ-1 through REQ-4 all implemented and verified) but introduces a regression in specialist tmux session name resolution in `command-deck.ts:500` — the `issueId` argument was dropped from `getTmuxSessionName()`, causing all per-issue specialist session lookups to generate wrong names and always show `ended` status. Combined with the status revert to cached `ss.status` instead of tmux-liveness-derived status (command-deck.ts:517), the specialist presence and status indicators will both be wrong for all running specialists. One blocker must be fixed before merge; three high-priority findings should be addressed together since they share the same session resolution root cause.

## Blockers (MUST fix before merge)

### 1. Specialist tmux session name resolution dropped `issueId` — `command-deck.ts:500` — `!`
**Raised by**: correctness
**Why it blocks**: `getTmuxSessionName` without `issueId` generates `specialist-${projectKey}-${name}` instead of `specialist-${projectKey}-${issueId}-${name}`. Since specialists are spawned per-issue, the generated name will never match the actual tmux session — all running specialists will incorrectly show `ended` in the Command Deck.

The old code passed `issueId` (line 36-40); the new code dropped it (line 45).

<fix instruction>
In `src/dashboard/frontend/src/components/CommandDeck/command-deck.ts` at the `getTmuxSessionName` call around line 500, restore the `issueId` argument:

```typescript
tmuxSessionName = getTmuxSessionName(specialistType as never, resolved?.projectKey, issueId);
```

This must be fixed before the status fix (Warning #1) can work correctly.
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Specialist status reverted to cached `ss.status` instead of tmux-liveness check — `command-deck.ts:517` — `~`
**Raised by**: correctness
**Conditions**: Specialist session alive but status cache stale, or specialist dead but cache still says `running`.

The old code cross-checked tmux session liveness:
```typescript
status: specialistIsLive ? 'running' : ss.status,
```

The new code uses only the cached status. If the specialist crashes or is killed, `ss.status` remains stale. Combined with Blocker #1 (session name resolution broken), presence and status will both be wrong.

<fix instruction>
After fixing Blocker #1 (so the session name resolves correctly), restore the tmux liveness cross-check:

```typescript
status: tmuxSessionName && tmuxSessionNames.has(tmuxSessionName) ? 'running' : ss.status,
```
</fix>

### 2. Active-issue filtering removed from resource discovery — `resource-discovery.ts` — `~`
**Raised by**: correctness
**Conditions**: After merging an issue, feature branch and workspace debris persist and pollute the tree.

The old code filtered to only show issues with active tracker state (`in_progress`, `in_review`, `started`), live resources (tmux, docker, open PR), or `readyForMerge` flag. The new code shows any issue with `resourceSources.size > 0`, including issues with lingering workspace directories or feature branches from already-merged work.

<fix instruction>
Restore the filter in `resource-discovery.ts` (or confirm this is intentional and document a cleanup mechanism). The `isLiveResource` check was a meaningful quality gate preventing tree pollution from stale merged issues.
</fix>

### 3. Review agent coordinator loses logging, `remain-on-exit`, and error visibility — `review-agent.ts` — `~`
**Raised by**: correctness
**Conditions**: Coordinator encounters an error (network issue, config problem) — failure becomes completely invisible.

The old coordinator spawn created a log directory and file, wrapped the command with exit-code capture and logging, set `remain-on-exit on` for post-mortem inspection, and piped output to the log. The new code:
```typescript
const command = `bash -lc 'pan review run ${opts.issueId} || true; exit'`;
```
silently swallows all errors (`|| true`), creates no log, and lets tmux destroy the session immediately on exit. If `pan review run` fails, there is zero observability.

<fix instruction>
At minimum: (1) remove the `|| true` so failures are not silently swallowed; (2) restore `remain-on-exit on` so the pane survives for debugging; (3) log the exit code to a file.
</fix>

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/conversations.ts:1251` — `?` — Redundant dynamic import of `node:fs/promises`. `readFile` and `stat` are already at top-level; `readdir` should be restored there instead of using dynamic import inside a try block. (correctness)
- `src/dashboard/server/routes/conversations.ts:314-320` — `?` — GET/HEAD origin-check bypass means any same-network client can read conversation data without CSRF. Deliberate design choice noted; confirm it aligns with security posture for sensitive conversation content. (correctness)
- `src/dashboard/server/routes/conversations.ts:332` — `?` — `normalizeOrigin(referer)` after `origin` narrowing gap — no runtime bug (control flow guarantees `referer` is truthy), just TypeScript expressiveness gap. Safe to defer. (correctness)

## Cross-cutting groups

**Specialist session resolution** (fix together — all stem from the `getTmuxSessionName` call):
- [blocker-1] `command-deck.ts:500` — missing `issueId` argument breaks per-issue session lookups
- [high-1] `command-deck.ts:517` — status uses stale cache instead of tmux liveness (requires blocker-1 fix first)

## What's good
- All 4 PAN-859 requirements implemented and Playwright-verified with screenshots
- CSRF protection materially improved: exact-origin validation for unsafe methods, loopback-aware rate limiting
- Upload path hardened: MIME allowlist, magic-byte verification, pre-write containment, atomic rename
- Specialist session file resolution in `conversations.ts` rewritten with batched async and bounded caching
- New regression tests cover first-click opening (REQ-1, REQ-2) and second-click idempotency (REQ-3)
- No performance regressions introduced; server-side changes reduce prior overhead

## Review stats
- Blockers: 1   High: 3   Medium: 0   Nits: 3
- By reviewer: correctness=6, security=0, performance=0, requirements=0
- Files touched: 12   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-859 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

