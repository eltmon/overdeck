# PAN-805 — Epic A: Labels as display, internal state as source of truth

## Problem

GitHub labels are currently used as the state-machine source of truth for Panopticon's
issue lifecycle. Writes are fire-and-forget (`fetch` with no `.ok` check), non-idempotent
(`transitionIssueToInProgress` fires on every work-agent respawn), and amplified by five
boot-time `repair*` sweeps that shell `gh issue edit` for every tracked issue on every
dashboard restart (600+ calls observed). Failures and 429 rate-limit drops are silent —
no audit, no structured log. This is the root cause behind PAN-676, PAN-698
(in-review-stuck), boot slowness, and a long tail of label drift bugs.

Epic D (#804) cleaned the repo; this epic fixes the architecture.

## Proposal

Introduce a **reconciler service** that owns all GitHub label writes. Internal SQLite
state (`issue_state`) becomes authoritative; GitHub labels become a display mirror the
reconciler keeps in sync. All call sites that previously wrote labels directly either
mutate `issue_state` (intent) or enqueue via the reconciler. Every API attempt — success,
failure, rate-limited, or skipped — is recorded to `label_sync_audit` so failures are
debuggable after the fact.

Bidirectional sync: the reconciler also **pulls** current GitHub label state each tick
(via the list-issues endpoint, paginated — not per-issue fetches) and reconciles local
`canonical_state` against remote. This supports the multi-developer scenario where two
Panopticon instances (or a human editing labels on github.com) target the same repo.

PAN-676 close-issue behavior is fixed by removing `Closes #NNN` from PR bodies and
having `postMergeLifecycle` explicitly close via API while enqueueing the `merged`
label through the reconciler. An external-merge sweep handles PRs merged via the
GitHub web UI.

## Resolved decisions

- **Migrations pattern:** bump existing `src/lib/database/schema.ts` (SCHEMA_VERSION 27 → 28)
  with `CREATE TABLE IF NOT EXISTS` for the two new tables — matches the current codebase
  pattern. No new per-file migration directory.
- **CI enforcement:** grep-based script invoked in CI (not a custom ESLint rule). Low
  ceremony; easy to maintain.
- **Pull-sync scope:** only open/active issues (state != terminal), fetched in one
  paginated list-issues call per tick rather than N per-issue fetches. Bounds API usage
  at ~1–3 requests per tick even with many tracked issues.
- **Backfill scope:** seed `issue_state` on boot from issues Panopticon already knows
  locally (workspaces + agent state). Plus: `transitionIssueToInProgress` gets a
  **lazy-insert** clause so any issue that escaped the boot backfill gets a row on its
  first local transition.
- **PAN-676 mechanism:** option (b) — remove `Closes #NNN`, Panopticon owns the API
  close; reconciler sweep handles outside-Panopticon merges.

## Architecture

New module: `src/lib/lifecycle/reconciler/`

- `index.ts` — public API: `startReconciler(config)`, `enqueueLabelChange(intent)`,
  `setCanonicalState(issueId, state)`
- `loop.ts` — fixed-interval tick driver, single-instance mutex
- `push.ts` — tick step 1: diff `issue_state` vs last-synced labels, write deltas
- `pull.ts` — tick step 2: list-issues pagination, update local canonical_state on
  divergence, write `reason='remote_ahead_pulled'` audit rows
- `external-merge-sweep.ts` — tick step 3: find state=closed + no `merged` label,
  enqueue the write
- `github-client.ts` — wrapped `fetch` with `.ok` check, 429/5xx exponential backoff
  (1s → 60s, max 5 attempts, `Retry-After` honored), structured error logging
- `audit.ts` — `label_sync_audit` writer
- `desired-labels.ts` — pure function from `canonical_state` → desired label set

New schema (schema.ts v28):

```sql
CREATE TABLE IF NOT EXISTS issue_state (
  issue_id         TEXT PRIMARY KEY,
  canonical_state  TEXT NOT NULL,  -- todo|in_progress|in_review|merged|closed_wontfix
  last_synced_at   TEXT NOT NULL,
  pending_mutation TEXT,            -- nullable; non-null = write in flight
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS label_sync_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id      TEXT NOT NULL,
  attempted_at  TEXT NOT NULL,
  target_label  TEXT NOT NULL,
  action        TEXT NOT NULL CHECK(action IN ('add','remove')),
  outcome       TEXT NOT NULL CHECK(outcome IN ('success','failure','rate_limited','skipped')),
  reason        TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  http_status   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_audit_issue_time ON label_sync_audit(issue_id, attempted_at);
```

## Call-site migration summary

| Call site | Current | After |
|---|---|---|
| `src/lib/agents.ts:1058` `transitionIssueToInProgress` | Fires label write every respawn | Reads `issue_state.canonical_state`; early-returns if already `in_progress`; lazy-inserts missing rows; otherwise sets canonical_state + enqueues |
| `src/cli/commands/done.ts` `updateGitHubToInReview` (spec says `src/dashboard/server/done.ts` — actual path differs, keep an eye) | `fetch` no `.ok` check | Routes through reconciler queue; any remaining direct fetch has `.ok` + structured log + throws |
| `src/dashboard/server/routes/issues.ts` bulk-close (PAN-569) | Writes labels directly | Enqueues via reconciler |
| `src/dashboard/server/main.ts:154` | 5 `repair*` calls (currently commented out) | Deleted; starts reconciler instead |
| `src/lib/lifecycle/label-cleanup.ts` | 5 `repair*` functions | All deleted + tests removed |
| PR body template | Emits `Closes #NNN` | No close directives |
| `postMergeLifecycle` | Relies on `Closes #NNN` | Explicit `PATCH /issues/N` `state=closed` + enqueue `merged` label |

## Idempotency & retry semantics

- Push side: each tick diffs `issue_state` desired labels against the last-synced
  remote label set. No-op diffs skip the API call and write an `outcome='skipped'`
  audit row with `reason='no_diff'` (only when a diff was evaluated and found empty;
  we don't flood audit for issues we didn't touch).
- 429 / 5xx: exponential backoff 1s → 60s, max 5 attempts per intent. `Retry-After`
  header overrides the backoff schedule when present.
- Single-instance enforcement: in-process mutex (SQLite is opened by a single
  dashboard server process, so a JS-level mutex is sufficient; if that ever changes
  we can swap to an advisory lock).

## Pull-sync conflict resolution

When remote state differs from local AND a local `pending_mutation` exists:
- Log WARN with both states and the pending mutation.
- Allow the pending local write to proceed (local intent wins for writes in flight).
- Next tick re-reconciles.

Without a pending mutation: remote wins, local `canonical_state` updates, audit row
written with `outcome='skipped'`, `reason='remote_ahead_pulled'`.

## CI enforcement

A grep script (`scripts/check-label-writes.sh` or similar) greps for:
- `gh issue edit` calls
- Direct `fetch` calls to `/repos/.../labels` or `/repos/.../issues/.../labels`

…outside `src/lib/lifecycle/reconciler/**` and fails the build if found.
A fixture-based test proves the enforcement actually fails when a stray call is added.

## Testing approach

All tests live under `src/lib/lifecycle/reconciler/__tests__/` (Vitest). GitHub API
is mocked via `vi.mock`/fetch stubbing. No real network.

Required scenarios (see acceptance criteria per bead):
1. Respawn flood (idempotency)
2. Rate-limit recovery (exponential backoff + audit)
3. External merge sweep (closed + no merged → labeled)
4. `Closes #NNN` absence (PR body generator output)
5. CI enforcement works (fixture failing check)
6. Multi-developer pull-sync (remote-ahead detection)

## Out of scope

- Changing how labels are displayed in the dashboard UI (the event store already surfaces
  state; no UI work needed).
- Replacing GitHub as the external tracker.
- Beads cleanup (separate effort).
- Any Linear integration behavior changes.

## Playwright isolation

No browser-based verification required for this epic — all tests are unit/integration
level against mocked GitHub API. UAT specialist may still exercise the dashboard to
confirm no regressions in label display, but no bead requires a browser.

## Risks

- **Boot backfill accuracy:** if the initial backfill mislabels an issue's canonical
  state (e.g. a closed-wontfix issue seeded as `todo`), the next tick will push a
  spurious label write. Mitigation: backfill reads GitHub once on cold start for
  any issue missing from `issue_state`, not from local heuristics alone.
- **Pull-sync API budget:** list-issues is paginated; a repo with thousands of
  panopticon-labeled issues could still hit rate limits. Mitigation: filter the
  list query to non-terminal states only; increase interval if needed via the
  env var.
- **Migration ordering:** if the schema bump lands before the reconciler is wired,
  the new tables exist empty and label writes continue via legacy paths. That's
  safe — partial migration just means no behavior change until subsequent beads land.

## Acceptance criteria

Full list lives on each bead; summary:
- Two new tables, populated on boot.
- Reconciler service running, single-instance, interval configurable.
- All 5 `repair*` functions deleted; boot path clean.
- All three direct-write call sites migrated.
- `Closes #NNN` removed; explicit close via API after merge.
- External-merge sweep covers GitHub-web-UI merges.
- Pull-sync detects remote-ahead state and updates local canonical.
- CI enforcement prevents regressions.
- All 6 test scenarios pass.
