# PAN-136: Fix Pre-existing Test Failures

## Status: PLANNED

## Problem

6 test failures across 2 test files prevent the specialist handoff cycle from working — test-agent marks `testStatus: "failed"` even when all issue-specific tests pass.

## Root Cause Analysis

### Failure Group 1: settings.test.ts (4 failures)

**Files:** `tests/lib/settings.test.ts`, `src/lib/settings.ts`

**Cause:** Tests were written when all defaults were `kimi-k2.5`, but `DEFAULT_SETTINGS` in `src/lib/settings.ts` was subsequently updated to use a mix of Claude models. The tests were never updated.

**Actual defaults in source (lines 50-68):**
```
specialists.review_agent = 'claude-opus-4-6'
specialists.test_agent   = 'claude-sonnet-4-6'
specialists.merge_agent  = 'claude-sonnet-4-6'
planning_agent           = 'claude-opus-4-6'
status_review            = 'claude-opus-4-6'
complexity.trivial       = 'claude-haiku-4-5'
complexity.simple        = 'claude-haiku-4-5'
complexity.medium        = 'kimi-k2.5'
complexity.complex       = 'kimi-k2.5'
complexity.expert        = 'claude-opus-4-6'
```

**Test expectations (stale):** All values expected to be `'kimi-k2.5'`

**Fix:** Update test expectations in 4 test cases to match the actual `DEFAULT_SETTINGS`.

### Failure Group 2: tracker/factory.test.ts (2 failures)

**Files:** `tests/lib/tracker/factory.test.ts`, `src/lib/tracker/factory.ts`, `src/lib/config-yaml.ts`

**Cause:** Tests clear environment variables (`LINEAR_API_KEY`, `GITHUB_TOKEN`) in `beforeEach`, but `createTracker()` calls `getTrackerKeyFromConfig()` which reads `~/.overdeck/config.yaml` via `loadYamlConfig()`. If the test runner has a config file with stored tracker keys, the credential check passes and no `TrackerAuthError` is thrown.

**Fix:** Mock `loadYamlConfig` (from `config-yaml.ts`) in the test to return empty `trackerKeys`, ensuring full isolation from the filesystem.

## Decisions

1. **Tests match source** — update test expectations to match `DEFAULT_SETTINGS`, not the other way around
2. **Scope is the 6 current failures only** — the original 16 have been partially resolved in other PRs
3. **Tracker test isolation** — agent decides the mocking approach (likely mock `config-yaml.ts`)
4. **No "known failures" baseline** — out of scope; fix the tests directly

## Files to Modify

1. `tests/lib/settings.test.ts` — Update 4 test cases with correct default expectations
2. `tests/lib/tracker/factory.test.ts` — Add config-yaml mock for test isolation

## Verification

After fixes, `npx vitest run` should show 0 failures.
