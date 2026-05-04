# MIN-698: Kaia Over-Confirms Instead of Acting on Clear User Directives

## Status: IN PROGRESS

## Problem
Kaia asks for confirmation or presents option menus when user intent is clear. She should just act.

## Root Cause
1. Sharing tools (shareTask, getSharedTasks, respondToShare, getTaskShares) are not registered in AIService.buildToolCallbacks() - so Kaia can't actually share and instead asks "should I share?"
2. System prompt has a MANDATORY auto-schedule confirmation step after task creation
3. No "act on clear directives" guidance in system prompt
4. Some response examples model over-confirming behavior

## Files
- `api/src/main/java/com/myn/services/AIService.java` - needs sharing tool callbacks + TaskSharingService injection
- `api/src/main/resources/templates/ai/shared-instructions.txt` - needs behavioral guidance changes

## Tasks

- [x] myn-1: Add sharing tools to buildToolCallbacks()
- [x] myn-2: Add 'Act on Clear Directives' section to system prompt
- [x] myn-3: Remove MANDATORY auto-schedule confirmation step
- [x] myn-4: Fix over-confirming response examples

## Current Status
COMPLETE. All 4 tasks implemented. Committed and pushed to origin/feature/min-698.

## Changes Made

### AIService.java
- Injected `TaskSharingService` into `AIService`
- Added 4 new FunctionToolCallback factory methods: `createShareTaskFunction()`, `createGetSharedTasksFunction()`, `createRespondToShareFunction()`, `createGetTaskSharesFunction()`
- Registered all 4 in `buildToolCallbacks()`

### shared-instructions.txt
- Removed auto-schedule confirmation step ("After creation, ask: 'Would you like me to auto-schedule these tasks?'")
- Added "Act on Clear Directives" section with examples and rules
- Fixed sharing response example (removed "Would you like me to add any notes for her?")
- Fixed cleaning routine example (removed "Should I schedule this for today?")

## Remaining Work
None.

## Specialist Feedback

- **[2026-02-24T12:43Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
