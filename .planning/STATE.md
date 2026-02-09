# PAN-168: Rally WSAPI Cannot Query Generic Artifact with ScheduleState

**Status:** Implementation Complete
**Issue:** https://github.com/eltmon/panopticon-cli/issues/168
**Severity:** High - Rally tracker completely non-functional when filtering by state

## Problem

After PAN-166 fixed query syntax, the Rally query was syntactically valid but
semantically broken: querying the generic `Artifact` endpoint with `ScheduleState`
filters fails because not all artifact subtypes have that field.

Error: `Could not read: could not read all instances of class com.f4tech.slm.domain.Artifact`

## Root Cause

- `ScheduleState` applies to HierarchicalRequirement (stories) and Tasks
- `State` applies to Defects
- The generic `Artifact` endpoint cannot filter by fields that don't exist on all subtypes

## Solution

**Approach:** Query specific types separately and merge results (Option 1 from issue).

### Changes Made

### 1. Type-Specific Queries (`src/lib/tracker/rally.ts`)
- Added `QUERYABLE_TYPES` configuration array with type-specific state fields:
  - `hierarchicalrequirement` → `ScheduleState` (closed: Completed, Accepted)
  - `defect` → `State` (closed: Closed)
  - `task` → `State` (closed: Completed)
- `listIssues()` now queries each type in parallel via `Promise.all()`
- Results are merged, sorted by `updatedAt` descending, and limited
- Individual type query failures are caught and logged (non-auth errors) so
  other types still return data

### 2. Type-Aware Query Builder (`src/lib/tracker/rally.ts`)
- Replaced `buildQueryString()` with `buildQueryStringForType()` that accepts
  an `ArtifactTypeQuery` parameter
- Each type gets its own state field in the exclude-closed and state-filter conditions
- Other filters (assignee, labels, search) remain the same across all types

### 3. Updated Unit Tests (`tests/lib/tracker/rally.test.ts`)
- Updated `listIssues` tests to expect 3 separate queries (one per type)
- Added tests for: type-specific query types, result merging, sorting, limit
  handling, partial failure resilience, workspace/project propagation
- Updated `buildQueryStringForType` tests to verify type-specific state fields
- Added sample data for all 3 artifact types (story, defect, task)

### 4. Updated Integration Tests (`tests/integration/rally-tracker.test.ts`)
- Added PAN-168 test suite for type-specific query validation
- Tests that each type generates valid WSAPI queries
- Tests that new queries don't mix ScheduleState/State in the same filter
- Regression test documenting the old problematic mixed-field query

### Preserved Behavior
- `getIssue()` still uses generic `artifact` endpoint (OK because it filters
  by FormattedID, not state fields)
- `updateIssue()` still correctly routes state updates to ScheduleState or State
  based on artifact `_type`
- All other methods (createIssue, getComments, addComment, etc.) unchanged

## Remaining Work

None - implementation complete. All 49 Rally tests pass.
