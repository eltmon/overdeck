# PAN-158: Fix 17 pre-existing test failures across 6 test files

## Issue Summary

Fix 17 failing tests across 6 test files. These are pre-existing failures unrelated to recent work.

**Issue URL:** https://github.com/eltmon/panopticon-cli/issues/158
**Branch:** feature/pan-158

---

## Current Status

### Implementation: COMPLETE

## Root Cause Analysis

### 1. settings.test.ts (1 failure)
- **Test:** "should return Kimi models when API key is configured"
- **Cause:** Test expects `available.kimi` = `[]` but implementation returns `['kimi-k2', 'kimi-k2.5']` when API key set
- **Fix:** Update assertion to `['kimi-k2', 'kimi-k2.5']`

### 2. work-type-router.test.ts (3 failures)
- **Tests:** override tests + selective providers
- **Cause:** Tests use `'claude-opus-4-5'` (non-existent model), should be `'claude-opus-4-6'`. Also "selective providers" test has wrong expected model selections.
- **Fix:** Update model names and expected values to match smart selector behavior

### 3. specialist-context.test.ts (6 failures)
- **Cause:** `SPECIALISTS_DIR` is a module-level constant computed once at import time. Tests change `process.env.PANOPTICON_HOME` in beforeEach but the constant is already computed with the original value.
- **Fix:** Make SPECIALISTS_DIR a function that reads env var lazily

### 4. specialist-logs.test.ts (4 failures)
- **Cause:** Same as #3 - module-level `SPECIALISTS_DIR` doesn't respect test env changes
- **Fix:** Same approach - use lazy function

### 5. specialists/logs.test.ts CLI (1 failure)
- **Cause:** Mock returns `{ maxDays: 30, maxRuns: 100 }` (camelCase) but source reads `retention.max_days` / `retention.max_runs` (snake_case)
- **Fix:** Change mock to use snake_case property names

### 6. migration.test.ts (1 failure)
- **Cause:** Test checks for `'Session directory not found'` but actual warning is `'No session directory found for...'`
- **Fix:** Update expected substring

---

## Remaining Work

- [x] Root cause analysis
- [x] Fix source files (paths.ts, specialist-context.ts, specialist-logs.ts)
- [x] Fix test files (6 files)
- [x] Verify all tests pass (1049 passed, 0 failures)
- [x] Ensure no new failures
- [ ] Commit and push
