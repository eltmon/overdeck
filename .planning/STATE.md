# PAN-573: Flexible Tracker ID Resolution

## Status: Implementation Complete

## Current Phase
All implementation complete - feature branch pushed and ready for PR creation.

## Completed Work
- [x] Created unified issue ID parser `src/lib/issue-id.ts` with:
  - `parseIssueId()` - parses standard (MIN-123), Rally (F29698), and custom formats
  - `extractPrefix()` - extracts prefix from any format
  - `extractNumber()` - extracts number from any format
  - `normalizeIssueId()` - returns filesystem-safe lowercase form
- [x] Added `tracker`, `issue_pattern`, `issue_prefixes` fields to `ProjectConfig`
- [x] Updated `resolveProjectFromIssue()` to support `issue_prefixes` array
- [x] Updated `resolveTrackerType()` to use new parser and support explicit `tracker` field
- [x] Migrated 54 `split('-')` callsites across 15 files to use unified parser
- [x] Created comprehensive tests in `tests/lib/issue-id.test.ts` (37 tests)

## Remaining Work
- [ ] Create GitHub PR via `pan work done`

## Key Decisions
- [D1] Used `extractPrefix` with fallback to `split('-')[0]` at each callsite to maintain backward compatibility while gradually migrating. This approach avoids breaking changes in dashboard routes that may receive mixed format IDs.
- [D2] `extractTeamPrefix()` is now a thin wrapper around `extractPrefix()` - this maintains API compatibility for external consumers while using the unified parser internally.
- [D3] `issue_prefixes` array in ProjectConfig supersedes single `issue_prefix` when both are specified (array takes precedence for matching).

## Files Modified
- `src/lib/issue-id.ts` (NEW)
- `src/lib/projects.ts`
- `src/lib/tracker-utils.ts`
- `src/lib/lifecycle/close-issue.ts`
- `src/lib/lifecycle/label-cleanup.ts`
- `src/lib/lifecycle/workflows.ts`
- `src/lib/lifecycle/teardown-workspace.ts`
- `src/lib/close-out.ts`
- `src/lib/agent-enrichment.ts`
- `src/lib/costs/wal.ts`
- `src/cli/commands/work/done.ts`
- `src/cli/commands/work/wipe.ts`
- `src/dashboard/server/routes/issues.ts`
- `src/dashboard/server/routes/workspaces.ts`
- `src/dashboard/server/routes/misc.ts`
- `src/dashboard/server/routes/agents.ts`
- `src/dashboard/server/routes/specialists.ts`
- `src/dashboard/server/routes/mission-control.ts`
- `tests/lib/issue-id.test.ts` (NEW)

## Specialist Feedback
None yet.
