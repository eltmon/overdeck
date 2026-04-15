# PAN-653 — Hotfix commits on main get silently lost

**Status:** Planning complete
**Updated:** 2026-04-12
**Author:** planning agent (claude-opus-4-6)

## Problem

Hotfix commits pushed to `origin/main` are silently clobbered by concurrent approve-flow merges. The root cause is a check-then-act race in `src/dashboard/server/routes/workspaces.ts:3789-3941`: we `git pull origin main --ff-only`, then run the merge-agent, then `git push origin main` without re-fetching. Any commit landing between the pull and the push is orphaned.

The bug is invisible because:
- Activity log is in-memory only (`workspaces.ts:97`, cap 100, wiped on restart) and never emits `git.*` events.
- "Stuck" is a derived heuristic in `health.ts:41-54` (30-min inactivity), not a persistent flag — a clean divergence-abort never trips it.
- Deacon's resolution patrol (`deacon.ts:1960-2035`) would force-poke/respawn anything marked stuck, creating an infinite loop if we ever did mark it.
- Secondary push sites (`merge-agent.ts:1742` salvage, `:1538` rebase force-push, `:1385` auto-revert force-push) have the same blind-push pattern.

## Decisions

1. **Stuck storage: extend `review_status`** — add `stuck`, `stuck_reason`, `stuck_at`, `stuck_details` columns. One row per issue already exists; upsert helpers are in place. Bump `SCHEMA_VERSION` to 17 with a `currentVersion < 17` migration block.
2. **Scope: all three phases in one PR** — per CLAUDE.md's "deliver complete features" rule. The five pieces are coupled; shipping subsets recreates the bug or makes it worse.
3. **Git layer: thin helper wrapper** — new `src/lib/git/operations.ts` exporting `gitFetch`, `gitPush`, `gitMerge`, `gitForcePush`, `gitRevParse`. Each wraps `execAsync`, records before/after/remote SHAs, and emits a `git.*` activity event via a new `git-activity` service. Migrate the approve flow and all `merge-agent.ts` push sites to use them. Other `execAsync('git ...')` call sites in the repo are left alone — we target the push/fetch/force-push surface only.
4. **Tmux streaming: pattern-match, not firehose** — add a periodic tail on the merge-agent specialist's tmux capture-pane output (similar to how `merge-agent.ts` already polls for the MERGE_RESULT marker). Match lines containing `rejected`, `non-fast-forward`, `pushing to`, `retrying`, `force-with-lease` and emit them as activity events. No raw capture dump into the DB.
5. **Phase 1 ship order is non-negotiable:** Deacon-respect → persistent stuck schema → divergence guard (approve + salvage) → unstick UI. Deacon must land first so the first stuck-mark isn't instantly clobbered by an infinite respawn loop.
6. **Activity persistence: new `git_operations` SQLite table.** Replaces the in-memory `activityLog` array for git events specifically. Schema: `id, operation, branch, issue_id, before_sha, after_sha, remote_sha, status, error, ts`. Existing `ActivityEntry` in-memory store stays for non-git entries (command shell output) to minimise blast radius — we can migrate those in a follow-up.
7. **Kanban stuck count = union** of `review_status.stuck = 1` AND agents with `health.state === 'stuck'`, deduped by issue. Implemented in `metrics.ts:114` via a new helper in `cloister/service.ts`.
8. **Unstick surface:** a menu-item on the kanban card (no drag, no new lane per the comment clarification). Card gets a red-border visual indicator + warning badge when `stuck = 1`. `POST /api/workspaces/:issueId/unstick` clears the flag and re-enables Deacon for that workspace.

## Out of scope

- New kanban lane / 5th column (explicitly ruled out in the issue comment).
- Full git abstraction replacing every `execAsync('git ...')` site.
- Migrating the non-git in-memory activity log to SQLite (follow-up).
- UI for browsing the historical `git_operations` table beyond the existing Activity panel.

## Architecture outline

### New files
- `src/lib/git/operations.ts` — wrapped git primitives emitting activity events.
- `src/dashboard/server/services/git-activity.ts` — write path to `git_operations` table; read path for activity API.
- `src/dashboard/frontend/src/components/StuckBadge.tsx` — card visual indicator + unstick menu item.

### Modified files
- `src/lib/database/schema.ts` — bump `SCHEMA_VERSION` to 17; add columns to `review_status`; create `git_operations` table; migration block.
- `src/lib/cloister/deacon.ts:1960-2035` — skip workspaces where `stuck = 1` in the resolution patrol and the poke/respawn path.
- `src/lib/cloister/merge-agent.ts` — `salvageStrandedMerge` (1742), `spawnRebaseAgentForBranch` (1538), auto-revert force-push (1385) all routed through `gitPush` / `gitForcePush` helpers with divergence guard + activity emission.
- `src/dashboard/server/routes/workspaces.ts:3789-3941` — pre-push `git fetch origin main` + ancestor check; on diverge call `markWorkspaceStuck(issueId, 'main_diverged', {localSha, remoteSha})`, emit `git.main_diverged`, return error. Also hosts `POST /unstick`.
- `src/dashboard/server/routes/metrics.ts:114` — stuck count = union.
- `src/dashboard/server/routes/activity.ts` (or the existing activity handler) — read from SQLite for git events.
- `src/dashboard/frontend/src/components/MetricsSummary.tsx:133` — consume new stuckCount (no code change beyond binding, but verification required).
- `src/dashboard/frontend/src/components/KanbanCard.tsx` (or equivalent) — render StuckBadge.
- `src/dashboard/frontend/src/components/ActivityPanel.tsx` — group by issue, filter by event type, pin warnings/errors.

### Data flow (divergence case)
1. User clicks Approve.
2. `workspaces.ts` runs review/test specialists, merge-agent merges locally.
3. Before `git push origin main`: `gitFetch('main')` → `gitRevParse('origin/main')` → ancestor check.
4. If diverged: `markWorkspaceStuck` writes to `review_status`, `gitPush` is NOT called, `git.main_diverged` event written to `git_operations` table, response returns error.
5. Dashboard WS receives domain event → kanban card shows StuckBadge → stuck count increments by 1.
6. Deacon patrol runs 60s later → sees `stuck = 1` for this workspace → skips poke/respawn.
7. Human resolves (rebases locally / pushes), clicks Unstick on card → `review_status.stuck = 0` → Deacon resumes normal handling.

## Test plan

- Unit: `gitPush` helper emits event and refuses to push on divergence (mock execAsync for rev-parse).
- Unit: `markWorkspaceStuck` + `clearWorkspaceStuck` roundtrip; schema migration from v16 to v17.
- Integration: Deacon patrol skip-logic when `stuck = 1`.
- Integration: Concurrent approve repro — spawn two approves against the same repo with a manual `git push` to `origin/main` injected between them; confirm the second aborts cleanly, stuck flag persists across restart, Deacon does not respawn.
- UI: StuckBadge renders, unstick button clears flag, metrics stat increments/decrements by exactly 1.
- Activity panel: filter/group/persistence across restart.

## Risk notes

- The divergence-abort path must also leave the local merge-state clean (we're already running `git merge --abort` / `git reset --hard HEAD` in the existing fallback — preserve that).
- The salvage path in `merge-agent.ts:1742` runs in a recovery branch; the guard there must not mark-stuck if the remote already contains the local HEAD (the existing equality check at :1732 handles this; keep it).
- Deacon skip-logic should be keyed by `issueId`, not `agentId`, because the stuck flag lives on the issue/workspace and a respawned agent gets a new ID.
- Schema migration for v16 → v17 needs to `ALTER TABLE review_status ADD COLUMN` inside a try/catch (SQLite requires separate statements per column; columns may pre-exist if a prior attempt partially ran).
