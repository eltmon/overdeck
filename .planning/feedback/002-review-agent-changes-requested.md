---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T14:03:35Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 implements the Zone C tab-strip skeleton and Overview tab (billboard + tile grid) across 29 changed files. All 9 requirements pass coverage review. Security is clean. The single blocker is performance: the Overview tab polls `/api/issues/:id/pr` every 30 seconds, but that endpoint always generates and returns the full PR diff patch — a multi-MB payload — when the Overview UI only renders PR metadata (title, state, file counts). This wastes GitHub CLI subprocess time and transfers large payloads on every poll cycle. Additionally, one high-priority optimization was identified in session-tree title resolution.

## Blockers (MUST fix before merge)

### 1. PR endpoint over-fetches full diff on every 30s Overview poll — `~`
**Raised by**: performance
**Why it blocks**: The Overview tab polls `/api/issues/:id/pr` every 30s (`refetchInterval: 30_000`) via `usePrQuery(issueId)`. That endpoint always runs `gh pr diff --patch` in addition to `gh pr view --json`, producing and transferring the full PR patch on every cycle. The Overview UI only renders PR metadata (title, state, additions/deletions, changed file count) — the diff field is never displayed in the Overview tab. This is a `~` (SHOULD) on a hot path (30-second active poll), making it High severity per the policy threshold.

**Location**: `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:220`, `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/queries.ts:199`, `src/dashboard/server/routes/issues.ts:2517`

**Fix instruction**: Split the PR data retrieval so metadata is fetched separately from the diff. The `/api/issues/:id/pr` endpoint should serve only metadata (what `gh pr view --json` returns) for the polling path. If the Diff tab is opened, lazy-load the patch via a separate call or on-demand fetch. At minimum, remove the unconditional `gh pr diff --patch` subprocess call and full-patch transfer from the 30-second polling path.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Session-tree title resolution rescans full issue list per feature — `~`
**Raised by**: performance
**Why it blocks**: `resolveFeatureTitle()` in `projects.ts:200` calls `getIssues()` + `.find()` independently for every feature node in the session tree, producing O(F × I) linear scans. The session-tree build aggregates many features at once, so this compounds. The same pre-grouping optimization already exists in `command-deck.ts`.

**Location**: `src/dashboard/server/routes/projects.ts:200`

**Fix instruction**: Build a single `Map<issueId, title>` once in `fetchProjectSessionTree()` and pass it into `resolveFeatureTitle()` to reduce repeated issue-list scans to O(1) map lookups.

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/command-deck.ts:283` — `?` — Uses `isNaN()` instead of `Number.isNaN()`. No runtime impact since `ms` from `Date.getTime()` is always a number. Low priority.
- `src/dashboard/server/services/session-presence.ts:26,32` — `?` — Hardcoded `5000` ms freshness threshold should be a named constant. Style/preventive maintenance only.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:94-104` — `?` — `Date.parse` NaN guard is already correct; no action needed.
- `src/dashboard/frontend/src/components/CommandDeck/ActivitySparkline.tsx:62-63` — `?` — Index clamping logic is already correct; no action needed.

## Cross-cutting groups

**Overview poll efficiency** (all PR metadata polling code):
- [blocker-1] PR endpoint over-fetches full diff on every Overview poll
- [nit-1] `isNaN` vs `Number.isNaN` — same endpoint (`command-deck.ts:283`), no runtime impact but inconsistent with `projects.ts:120`

**Session-tree aggregation** (projects.ts route):
- [high-1] Feature title rescanning in session-tree build
- (also involves `src/dashboard/server/routes/projects.ts:200`)

## What's good
- All 9 PAN-865 requirements verified implemented with test coverage and visual Playwright smoke test
- Security review: zero PR-introduced vulnerabilities
- Schema change (`duration` → `Schema.NullOr(Schema.Number)`) is sound — all frontend consumers handle null correctly
- Clean refactors: `session-presence.ts` and `agent-status.ts` helper extractions preserve identical behavior
- Correctness reviewer self-resolved both initially-flagged critical items after deeper analysis; no functional bugs found

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 4
- By reviewer: correctness=0 blockers, security=0 blockers, performance=1 blocker, requirements=PASS
- Files touched: 29   Files with findings: 4

## Appendix: individual reviews

See individual reviewer output files:
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-865/.pan/review/review-PAN-865-1777298177848/security.md`
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-865/.pan/review/review-PAN-865-1777298177848/correctness.md`
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-865/.pan/review/review-PAN-865-1777298177848/performance.md`
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-865/.pan/review/review-PAN-865-1777298177848/requirements.md`

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

