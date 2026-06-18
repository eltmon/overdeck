# PAN-290: Fix 9 Pre-existing Test Failures

## Status: Planning Complete

## Problem

9 test failures on main across 2 test files, blocking specialist test-agent from cleanly distinguishing feature regressions from baseline failures.

**Actual distribution** (differs from issue description):
- `tests/cloister/session-rotation.test.ts` — 3 failures
- `tests/unit/lib/skills-merge.test.ts` — 6 failures

## Root Cause Analysis

### Session-rotation (3 failures)

**Cause:** Commit `5c303b7` added `setSessionId()` call to `rotateSpecialistSession()` (line 267 of `src/lib/cloister/session-rotation.ts`) but did not update the test mock. The mock for `specialists.js` only provides `getTmuxSessionName` — `setSessionId` is `undefined`, causing a TypeError caught by the function's try/catch, returning `{ success: false }`.

**Secondary issue:** `vi.resetAllMocks()` in `afterEach` strips factory implementations from vi.mock factories. This causes `getTmuxSessionName` to return `undefined` instead of the expected `specialist-${name}` pattern after the first test completes.

**Failing tests:**
1. `rotateSpecialistSession > should successfully rotate session with memory file`
2. `rotateSpecialistSession > should handle tmux kill failure gracefully`
3. `checkAndRotateIfNeeded > should rotate when needed`

### Skills-merge (6 failures)

**Cause:** Commit `093f184` (PAN-266) refactored `cleanupGitignore()` from deduplicating entries within Overdeck sections to **removing the entire Overdeck section** (skills are now file copies, not symlinks). Tests still expect the old deduplication behavior.

**Failing tests:**
1. `should not modify file without duplicates` — expects `cleaned: false`, gets `true`
2. `should remove duplicate entries` — expects `duplicatesRemoved: 3`, gets `0`
3. `should preserve user content before Overdeck section` — expects `duplicatesRemoved: 1`, gets `0`
4. `should sort entries alphabetically` — expects first call `cleaned: false`, gets `true`
5. `should handle severely duplicated content` — expects `duplicatesRemoved: 24`, gets `0`
6. `cleanupWorkspaceGitignore > should target correct path` — expects `duplicatesRemoved: 1`, gets `0`

## Decisions

1. **Skills-merge tests:** Update test expectations to match the new "remove entire section" behavior. Keep tests that verify useful behavior (section removed, user content preserved). Delete or rewrite tests whose premises are invalid (deduplication counts, sorting).
2. **Session-rotation mock:** Add missing `setSessionId: vi.fn()` to the specialists mock AND change `afterEach` from `vi.resetAllMocks()` to `vi.clearAllMocks()`.

## Implementation Plan

### Task 1: Fix session-rotation.test.ts mock (simple)

**File:** `tests/cloister/session-rotation.test.ts`

Changes:
1. Add `setSessionId: vi.fn()` to the `specialists.js` mock (line 24-26)
2. Change `afterEach` from `vi.resetAllMocks()` to `vi.clearAllMocks()` (line 78)

This fixes all 3 session-rotation failures.

### Task 2: Update skills-merge.test.ts expectations (medium)

**File:** `tests/unit/lib/skills-merge.test.ts`

The function now removes the entire Overdeck section instead of deduplicating. Update each failing test:

1. **"should not modify file without duplicates"** (line 41-57):
   - Now DOES clean (removes the section): `cleaned: true`, `entriesAfter: 0`
   - Rename test to reflect new behavior: "should remove Overdeck section even without duplicates"
   - Verify user content is preserved and Overdeck section is gone

2. **"should remove duplicate entries"** (line 59-91):
   - Rewrite: `duplicatesRemoved: 0` (not deduplicating anymore), `entriesAfter: 0`
   - Rename to "should remove entire Overdeck section including duplicates"
   - Verify single Overdeck section AND entries are all removed
   - User content preserved

3. **"should preserve user content before Overdeck section"** (line 93-123):
   - Just update `duplicatesRemoved` expectation from `1` to `0`
   - User content preservation checks stay the same

4. **"should sort entries alphabetically"** (line 125-151):
   - This test's premise is invalid (no sorting behavior anymore)
   - Replace with test verifying section removal with unsorted entries

5. **"should handle severely duplicated content"** (line 154-183):
   - Update: `duplicatesRemoved: 0`, `entriesAfter: 0`
   - Still verify only one (zero) Overdeck sections remain and user content preserved
   - Rename to "should remove all Overdeck sections from severely duplicated content"

6. **"cleanupWorkspaceGitignore > should target correct path"** (line 187-203):
   - Update: `duplicatesRemoved: 0`, `entriesAfter: 0`

### Task 3: Verify all tests pass

Run the full test suite to confirm 0 failures remain and no regressions introduced.

## Files Modified

- `tests/cloister/session-rotation.test.ts` — fix mock, fix afterEach
- `tests/unit/lib/skills-merge.test.ts` — update expectations

## Out of Scope

- No source code changes (implementations are correct)
- No changes to other test files
- No new features or refactoring
