# PAN-222: Fix pre-existing specialist-logs test failure

## Problem

`tests/lib/cloister/specialist-logs.test.ts` has a pre-existing failure in the `cleanupOldLogs > should keep last N runs even if older than maxDays` test. Expected 2 remaining runs, got 3. This masks real regressions in every test run.

## Scope

- Fix the `cleanupOldLogs` test or the underlying cleanup logic
- Ensure all tests pass with 0 failures
- Minimal change — fix the root cause, don't refactor

## Acceptance Criteria

- [ ] `specialist-logs.test.ts` passes
- [ ] Full test suite passes (0 failures)
- [ ] No unrelated changes
