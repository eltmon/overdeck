# PAN-8: Fix Failing Unit Tests - STATE

## Status: PLANNING COMPLETE

## Summary
Fix 24 failing tests by updating test assertions and mocks to match current implementation. Also consolidate duplicate test suites.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Tests only | Fast path to green. API cleanup tracked separately. |
| Duplicate tests | Merge to tests/lib/tracker/ | Lib tests are more thorough; delete unit tests |
| Work location | Main repo | Workspace is missing test files |
| Test location | tests/lib/tracker/ | Better patterns, more complete coverage |

## Root Cause Analysis

### 1. Unit Tracker Tests (16 failures)
**Root cause:** Tests written for an older/different API than current implementation.

| Test Expectation | Actual Implementation |
|-----------------|----------------------|
| `tracker.type` | `tracker.name` |
| `issues.list` | `issues.listForRepo` |
| `identifier` property | `ref` property |
| `status` property | `state` property |
| `updateIssue` returns `boolean` | Returns updated issue object |
| `labels` is object | `labels()` is a function |

**Fix:** Delete `tests/unit/tracker/` entirely since `tests/lib/tracker/` already provides comprehensive coverage with correct mocks.

### 2. Config Tests (4 failures)
**Root cause:**
- `getDefaultConfig()` returns the same object reference, not a deep copy
- Some tests rely on temp directory that doesn't exist due to test isolation issues

**Fix:**
- Update `getDefaultConfig()` to return a deep copy (simple fix)
- Fix temp directory creation timing in tests

### 3. E2E Tests (2 failures)
**Root cause:**
- `rmSync` with `recursive: true, force: true` still failing on non-empty dir
- Exit code assertion off by one

**Fix:**
- Add retry logic or use different cleanup approach
- Fix the assertion

### 4. Paths Test (1 failure)
**Root cause:** `INIT_DIRS` grew from 8 to 12 entries (4 new traefik dirs added)

**Fix:** Update test to expect 12, and add assertions for new dirs (CERTS_DIR, TRAEFIK_DIR, TRAEFIK_DYNAMIC_DIR, TRAEFIK_CERTS_DIR)

### 5. Integration Tests (1 failure)
**Root cause:** Module resolution issue with require() in ESM context

**Fix:** Change `require()` to dynamic `import()`

## Implementation Plan

### Phase 1: Delete Redundant Tests
1. Delete `tests/unit/tracker/linear.test.ts`
2. Delete `tests/unit/tracker/github.test.ts`
3. Delete `tests/unit/tracker/` directory if empty

**Result:** -16 failing tests

### Phase 2: Fix Config Tests
1. Update `getDefaultConfig()` in `src/lib/config.ts` to return deep copy
2. Ensure temp directory exists before tests that need it
3. Fix module resolution in doctor.test.ts (require → import)

**Result:** -4 failing tests

### Phase 3: Fix Paths Test
1. Update `tests/lib/paths.test.ts` to expect 12 directories
2. Add assertions for new traefik directories

**Result:** -1 failing test

### Phase 4: Fix E2E Tests
1. Improve cleanup in `tests/e2e/work-flow.test.ts`
2. Fix exit code assertion

**Result:** -2 failing tests

### Phase 5: Fix Integration Test
1. Fix skills discovery test in `tests/integration/cli/sync.test.ts`

**Result:** -1 failing test

### Phase 6: Verify & Create Follow-up
1. Run full test suite - confirm all 164 pass
2. Create Linear issue for API cleanup (type vs name, etc.)

## Files to Modify

| File | Action |
|------|--------|
| `tests/unit/tracker/linear.test.ts` | DELETE |
| `tests/unit/tracker/github.test.ts` | DELETE |
| `src/lib/config.ts` | MODIFY - deep copy in getDefaultConfig |
| `tests/lib/paths.test.ts` | MODIFY - expect 12 dirs, add new asserts |
| `tests/e2e/work-flow.test.ts` | MODIFY - fix cleanup and assertion |
| `tests/unit/lib/config.test.ts` | MODIFY - fix temp dir handling |
| `tests/integration/cli/doctor.test.ts` | MODIFY - require → import |
| `tests/integration/cli/sync.test.ts` | MODIFY - fix skill discovery |

## Out of Scope (Follow-up Issue)
- Standardizing tracker property names (type vs name)
- Standardizing return types (boolean vs object)
- Adding missing properties (identifier vs ref)
- Other API cleanup

## Acceptance Criteria
- [ ] All 164 tests pass
- [ ] No skipped tests
- [ ] Follow-up issue created for API cleanup

## Risk Assessment
**Low risk** - These are test-only changes (except the deep copy fix which is a minor, safe change).

## Beads Tasks

| Phase | Bead ID | Description |
|-------|---------|-------------|
| 1 | `panopticon-8mb` | Delete redundant tracker unit tests |
| 2 | `panopticon-yqz` | Fix config tests |
| 3 | `panopticon-mwh` | Fix paths test |
| 4 | `panopticon-439` | Fix E2E tests |
| 5 | `panopticon-qwm` | Fix integration test |
| 6 | `panopticon-r9o` | Verify and create follow-up |

## Work Location

**Main repo:** `/home/eltmon/projects/panopticon/`
**Reason:** The workspace `feature-pan-8` is missing critical test infrastructure (tests/setup.ts, tests/unit/, tests/e2e/, tests/integration/).
