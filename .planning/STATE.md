# PAN-166: Rally WSAPI Query Parse Error Fix

**Status:** Implementation Complete
**Issue:** https://github.com/eltmon/panopticon-cli/issues/166
**Severity:** High - Rally tracker completely non-functional

## Changes Made

### 1. Core Fix - Query String Builder (`src/lib/tracker/rally.ts`)
- Fixed `buildQueryString()` to wrap compound conditions in outer parentheses
- Before: `conditions.join(' AND ')` → generates invalid WSAPI query
- After: `(${conditions.join(' AND ')})` → generates valid WSAPI query
- Added JSDoc comment explaining Rally WSAPI requirement
- Added debug logging (`DEBUG=rally`) for query filters and generated queries

### 2. Error Context Improvements
- **`src/lib/tracker/rally-api.ts`**: Error messages now include the failing query string, plus debug logging
- **`src/dashboard/server/services/issue-data-service.ts`**: Parse errors include actionable guidance about checking config and enabling debug mode

### 3. Configuration Validation (`src/dashboard/server/services/tracker-config.ts`)
- Added `validateRallyConfig()` function that checks for missing workspace/project config
- Called on first poll in issue-data-service.ts to log warnings at startup

### 4. Rally Validation Endpoint (`src/dashboard/server/index.ts`)
- Added `POST /api/rally/validate` endpoint
- Tests Rally API connectivity with a simple query
- Returns specific error types (auth, query, network)

### 5. Comprehensive Tests
- **Unit tests**: Added `buildQueryString` test suite in `tests/lib/tracker/rally.test.ts`
  - Tests all filter types: state, includeClosed, assignee, labels, query
  - Tests compound queries with multiple conditions
  - Tests edge cases: empty query, single condition
- **Mock Rally API**: Created `tests/fixtures/rally-api-mock.ts`
  - Validates WSAPI query syntax (parentheses matching)
  - Supports forced errors for testing error paths
- **Integration tests**: Created `tests/integration/rally-tracker.test.ts`
  - Tests that fixed query builder output passes WSAPI syntax validation
  - Tests error handling scenarios

### 6. Documentation (`configuration/issue-trackers.mdx`)
- Added Rally Troubleshooting section
- WSAPI query parse error debugging guide
- How to find workspace/project IDs
- Debug logging instructions
- API validation endpoint usage

## Remaining Work

None - implementation complete. Pending: test run, commit, push.
