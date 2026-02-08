# PAN-154: Deacon agent state cleanup + fix idle detection (PAN-133)

## Issue Summary

Consolidates Deacon maintenance improvements: agent state cleanup, health API staleness filtering, and fixing the idle/lazy detection false positives from PAN-133.

**Issue URL:** https://github.com/eltmon/panopticon-cli/issues/154
**Branch:** feature/pan-154

---

## Current Status

### Implementation: COMPLETE

All three requirements implemented and tested:

### 1. Deacon Agent State Cleanup ✅
- Added `cleanupStaleAgentState()` to `src/lib/cloister/deacon.ts`
- Scans `~/.panopticon/agents/` for directories with no active tmux session
- Purges agent state dirs older than configurable threshold (default: 30 days)
- Respects `completed` markers (keeps recently completed agents for 7 days minimum)
- Runs at ~daily frequency via `Math.random() < 0.003` in patrol cycle
- Added `RetentionConfig` interface with `agent_state_days` to `src/lib/cloister/config.ts`

### 2. Fix Idle/Lazy Detection (PAN-133) ✅
- Added `isAgentActiveInTmux()` function that checks tmux output for Claude Code status indicators
- Status indicators detected: Computing, Fermenting, Thinking, Reading, Writing, Editing, Searching, Running, Executing, tool names (Bash, Read, Write, Edit, Grep, Glob, Task)
- `checkAndSuspendIdleAgents()` now calls `isAgentActiveInTmux()` before suspending — agents showing active status are skipped
- `checkLazyAgent()` now checks for active status patterns before checking lazy patterns
- Both features RE-ENABLED in `runPatrol()` (were disabled due to PAN-133)
- 5-minute cooldown on lazy detection messages preserved

### 3. Health API Staleness ✅
- `health-filtering.ts` now reads staleness threshold from Cloister config (`retention.health_staleness_hours`)
- Default: 24 hours (same as previous hardcoded value)
- Configurable via `cloister.toml` `[retention]` section

### Files Changed
- `src/lib/cloister/deacon.ts` — Added cleanup function, active status detection, re-enabled idle/lazy features
- `src/lib/cloister/config.ts` — Added `RetentionConfig` interface and defaults
- `src/dashboard/lib/health-filtering.ts` — Made staleness threshold configurable
- `tests/lib/cloister/deacon-cleanup.test.ts` — 24 new tests (all passing)

### Test Results
- 24 new tests: ALL PASSING
- Full suite: 17 pre-existing failures (18 on main — improved by 1)
- TypeScript: clean compilation (no errors)

---

## Remaining Work

None - All requirements implemented and tested.
