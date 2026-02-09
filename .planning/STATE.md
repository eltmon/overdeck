# STATE.md - PAN-163: Mission Control E2E Test Coverage

## Overview

PAN-163 adds comprehensive test coverage for Mission Control's activity sections (PLANNING, WORK, REVIEW, TEST, MERGE) and planning artifacts, verifying the full workflow pipeline renders correctly.

## What Was Done

### 1. Extracted Testable Mission Control Module
- Created `src/dashboard/lib/mission-control.ts` with pure, testable functions
- Extracted from the monolithic `src/dashboard/server/index.ts`
- Functions: `buildAgentSections`, `buildSpecialistSections`, `sortSections`, `readPlanningArtifacts`, `uploadPlanningArtifact`, `initPlanningDirectory`, `determineStateLabel`, `determineFeatureStatus`
- Refactored server endpoints to use the extracted module (reduces duplication, improves maintainability)

### 2. Backend Tests (72 tests)
- File: `tests/dashboard/mission-control.test.ts`
- Tests cover:
  - **buildAgentSections**: planning/work agents, state parsing, model fallbacks, duration calculation, status mapping, malformed state handling
  - **buildSpecialistSections**: review/test/merge log parsing, metadata extraction, run limiting, multi-project key search, missing fields handling
  - **sortSections**: chronological ordering, empty startedAt handling, immutability
  - **readPlanningArtifacts**: PRD/STATE/INFERENCE reading, PLANNING_PROMPT fallback, subdirectory artifacts, file type filtering, sort order
  - **uploadPlanningArtifact**: filename sanitization, extension handling, subdirectory creation
  - **initPlanningDirectory**: directory creation, shadow INFERENCE.md, idempotency
  - **determineStateLabel**: all lifecycle states (In Progress, Done, In Review, Suspended, Planning, Has Context, Idle), priority ordering
  - **determineFeatureStatus**: running/has_state/idle detection
  - **Full pipeline integration**: aggregating all 5 section types in chronological order

### 3. Frontend Component Tests (46 tests)
- **AgentSection.test.tsx** (20 tests): type badges, transcript rendering, model formatting, duration formatting, status classes, unread indicators, click handling
- **FeatureItem.test.tsx** (17 tests): issue ID display, title rendering, cost formatting, status icons (spinner/alert/check/circle/eye), state labels, selection
- **IsolationMode.test.tsx** (9 tests): section rendering, close button, overlay structure, all section types

### 4. Server Refactoring
- Imported extracted functions in `server/index.ts`
- Refactored activity, planning, upload, and init endpoints to use shared module
- Refactored project tree state/status determination to use `determineStateLabel`/`determineFeatureStatus`
- TypeScript compiles cleanly

## Test Results

- **New tests**: 118 (72 backend + 46 frontend)
- **All new tests pass**: 118/118
- **Pre-existing failures**: 6 test files (unchanged from before PAN-163)
- **Zero regressions** introduced by this change

## Files Created

1. `src/dashboard/lib/mission-control.ts` - Extracted testable module
2. `tests/dashboard/mission-control.test.ts` - Backend tests (72)
3. `src/dashboard/frontend/src/components/MissionControl/__tests__/AgentSection.test.tsx` - 20 tests
4. `src/dashboard/frontend/src/components/MissionControl/__tests__/FeatureItem.test.tsx` - 17 tests
5. `src/dashboard/frontend/src/components/MissionControl/__tests__/IsolationMode.test.tsx` - 9 tests

## Files Modified

1. `src/dashboard/server/index.ts` - Refactored to use extracted module

## Remaining Work

None - implementation complete.
