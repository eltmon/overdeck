# MIN-512: Add replanning triggers to UnifiedTaskService

## Current Status: COMPLETE

Implementation is done, tests pass, changes committed.

## What Was Done

Added `aiChangeTrackingService.recordChange()` + `flushChanges()` calls to `UnifiedTaskService.java` for all task CRUD operations so web/mobile REST API clients trigger replanning the same way MCP/AI clients do.

### Changes Made

**`api/src/main/java/com/myn/services/UnifiedTaskService.java`**
- Added `@Autowired AIChangeTrackingService aiChangeTrackingService` field
- `createTask()`: records `TASK_CREATED` + flushes changes
- `updateTask()`: records `TASK_UPDATED` + flushes changes
- `completeTask()`: records `TASK_COMPLETED` + flushes changes
- `deleteTask()`: records `TASK_DELETED` + flushes changes
- `archiveTask()`: records `TASK_DELETED` + flushes changes

**Test files updated** (added `@Mock AIChangeTrackingService`)
- `UnifiedTaskServiceAutoCompletePastRecurringChoreTest.java`
- `UnifiedTaskSoftDeleteTest.java`
- `UnifiedTaskServiceRecurringTaskValidationTest.java`
- `UnifiedTaskServiceEarlyCompletionTest.java`

**New test file**
- `UnifiedTaskServiceReplanningTest.java` - 5 tests verifying replanning triggers

## Remaining Work

None — implementation complete.

## Specialist Feedback

None received.
- **[2026-03-21T01:15Z] review-agent → VERIFICATION-FAILED** — `.planning/feedback/001-review-agent-verification-failed.md`
- **[2026-03-21T01:22Z] review-agent → VERIFICATION-FAILED** — `.planning/feedback/002-review-agent-verification-failed.md`
- **[2026-03-21T03:11Z] review-agent → VERIFICATION-FAILED** — `.planning/feedback/003-review-agent-verification-failed.md`
- **[2026-03-21T03:18Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/004-review-agent-changes-requested.md`
