# PAN-166: Rally WSAPI Query Parse Error Fix

**Status:** Planning Complete
**Issue:** https://github.com/eltmon/panopticon-cli/issues/166
**Severity:** High - Rally tracker completely non-functional

## Problem Statement

Rally tracker fails on every poll cycle with WSAPI query parse error:
```
[IssueDataService] Rally poll error: Rally API query failed: Could not parse: Error parsing expression -- expected ")" but saw "AND" instead.
```

This prevents the dashboard from displaying any Rally issues.

## Root Cause Analysis

**Location:** `src/lib/tracker/rally.ts:382` in `buildQueryString()` method

**Issue:** When multiple query conditions are combined with `AND`, Rally WSAPI requires the entire expression to be wrapped in parentheses.

**Current Code:**
```typescript
return conditions.length > 0 ? conditions.join(' AND ') : '';
```

**Problem:** Generates queries like:
```
((ScheduleState != "Completed") AND (ScheduleState != "Accepted") AND (State != "Closed")) AND (Owner.Name contains "John")
```

**Required by Rally WSAPI:**
```
(((ScheduleState != "Completed") AND (ScheduleState != "Accepted") AND (State != "Closed")) AND (Owner.Name contains "John"))
```

Rally's WSAPI parser requires the outermost parentheses to properly parse compound expressions.

## Solution Design

### 1. Core Fix (CRITICAL)

**File:** `src/lib/tracker/rally.ts`
**Change:** Line 382 - Wrap joined conditions in parentheses
```typescript
// Before:
return conditions.length > 0 ? conditions.join(' AND ') : '';

// After:
// Rally WSAPI requires the entire query expression to be wrapped in parentheses
// when multiple conditions are combined with AND/OR operators.
// See: Rally WSAPI v2.0 Query Syntax Documentation
return conditions.length > 0 ? `(${conditions.join(' AND ')})` : '';
```

**Impact:** Fixes query parsing for all multi-condition queries

### 2. Comprehensive Testing

**File:** `tests/lib/tracker/rally.test.ts`

**Add Test Coverage For:**
- Single condition (should work with or without outer parens)
- Multiple conditions (requires outer parens)
- Empty query (should return empty string)
- All filter types:
  - `state` filter
  - `includeClosed` filter (the failing case)
  - `assignee` filter
  - `labels` filter (single and multiple)
  - `query` filter (search term)
- Complex combinations (state + assignee + labels)
- Nested OR conditions (labels)

**Mock Rally API Server:**
- Create test fixture that validates WSAPI query syntax
- Simulate actual Rally parser behavior
- Return appropriate error messages for malformed queries
- File: `tests/fixtures/rally-api-mock.ts`

### 3. Error Handling Improvements

**Current Issues:**
- Generic error messages don't indicate what query failed
- No logging of actual WSAPI query sent to Rally
- Parsing errors don't include query context

**Improvements:**
1. **Enhanced Error Context** (`src/lib/tracker/rally-api.ts`)
   - Log the full query string when API calls fail
   - Include query in error message for debugging
   - Differentiate between auth errors, parse errors, and network errors

2. **Debug Logging** (`src/lib/tracker/rally.ts`)
   - Add debug log before sending query: `[Rally] Query: (query string)`
   - Log filter parameters: `[Rally] Filters: {state, assignee, labels, ...}`
   - Controlled by environment variable: `DEBUG=rally`

3. **Better Error Messages** (`src/dashboard/server/services/issue-data-service.ts`)
   - Surface parsing errors to dashboard with actionable guidance
   - Suggest checking workspace/project configuration
   - Include link to Rally integration docs

### 4. Configuration Validation

**Add Startup Checks:**
- Validate `RALLY_API_KEY` is present when Rally is primary tracker
- Check if `workspace` and `project` are configured (log warning if missing)
- Test Rally API connectivity on dashboard start
- Display configuration status in Settings page

**File:** `src/dashboard/server/services/tracker-config.ts`
- Add `validateRallyConfig()` function
- Called from `issue-data-service.ts` startup

**File:** `src/dashboard/server/index.ts`
- Add `/api/rally/validate` endpoint for Settings page
- Returns: connection status, workspace/project info, query test results

### 5. Documentation

**Inline Code Comments:**
- Document Rally WSAPI query syntax requirements in `buildQueryString()`
- Add examples of valid vs invalid queries
- Reference Rally WSAPI documentation URL

**Configuration Documentation:**
- Update `configuration/issue-trackers.mdx` with Rally query debugging tips
- Add troubleshooting section for WSAPI errors
- Include example configurations with workspace/project

## Files Modified

### Core Changes
- `src/lib/tracker/rally.ts` - Fix query builder, add logging
- `src/lib/tracker/rally-api.ts` - Improve error context

### Testing
- `tests/lib/tracker/rally.test.ts` - Add comprehensive query tests
- `tests/fixtures/rally-api-mock.ts` - Create mock Rally WSAPI server (NEW)

### Error Handling & Validation
- `src/dashboard/server/services/issue-data-service.ts` - Better error surfacing
- `src/dashboard/server/services/tracker-config.ts` - Add validation
- `src/dashboard/server/index.ts` - Add validation endpoint (NEW)

### Documentation
- `configuration/issue-trackers.mdx` - Rally troubleshooting guide

## Task Breakdown

### Task 1: Fix Query String Builder (CRITICAL)
**Difficulty:** simple
**Files:** `src/lib/tracker/rally.ts`
**Changes:**
- Modify line 382 to wrap conditions: `(${conditions.join(' AND ')})`
- Add inline JSDoc comment explaining Rally WSAPI requirement
- Reference Rally WSAPI documentation URL

**Acceptance Criteria:**
- Query with single condition: `((State = "In-Progress"))` ✓ valid
- Query with multiple conditions: `(((State = "In-Progress")) AND ((Owner = "John")))` ✓ valid
- Empty query: `""` ✓ valid

---

### Task 2: Add Comprehensive Unit Tests
**Difficulty:** medium
**Files:** `tests/lib/tracker/rally.test.ts`
**Dependencies:** Task 1 (fix must be done first)
**Changes:**
- Add `describe('buildQueryString')` test suite
- Test all filter combinations
- Verify WSAPI syntax correctness
- Test edge cases (empty, special characters)

**Test Cases:**
1. No filters → empty string
2. `includeClosed: false` → `((ScheduleState != "Completed") AND (ScheduleState != "Accepted") AND (State != "Closed"))`
3. `state: 'in_progress'` → `((ScheduleState = "In-Progress") OR (State = "In-Progress"))`
4. `assignee: "John Doe"` → `((Owner.Name contains "John Doe"))`
5. `labels: ["bug", "urgent"]` → `(((Tags.Name contains "bug")) AND ((Tags.Name contains "urgent")))`
6. `query: "search term"` → `(((Name contains "search term")) OR ((Description contains "search term")))`
7. Multi-condition: all above combined → properly nested and wrapped

**Acceptance Criteria:**
- All test cases pass
- 100% coverage of `buildQueryString()` method
- Tests verify actual WSAPI syntax requirements

---

### Task 3: Create Mock Rally API Server
**Difficulty:** medium
**Files:** `tests/fixtures/rally-api-mock.ts` (NEW)
**Purpose:** Simulate Rally WSAPI for integration testing

**Features:**
- Parse WSAPI query syntax (validate parentheses matching)
- Return parse errors matching real Rally behavior
- Support all query operators (AND, OR, =, !=, contains)
- Configurable test data responses

**Usage:**
```typescript
const mock = new RallyApiMock();
mock.addTestData([{ FormattedID: 'US123', ... }]);
const result = await mock.query({ query: '((State = "Open"))' });
```

**Acceptance Criteria:**
- Correctly validates query syntax
- Returns appropriate errors for malformed queries
- Supports all RallyRestApi methods (query, create, update)

---

### Task 4: Improve Error Context & Logging
**Difficulty:** simple
**Files:**
- `src/lib/tracker/rally-api.ts`
- `src/lib/tracker/rally.ts`
- `src/dashboard/server/services/issue-data-service.ts`

**Changes:**

1. **rally-api.ts** (query method, line 79-134):
   ```typescript
   // Before error throw:
   console.error('[Rally WSAPI] Query failed:', {
     query: config.query,
     error: result.QueryResult.Errors
   });
   throw new Error(`Rally API query failed: ${result.QueryResult.Errors.join(', ')} (Query: ${config.query})`);
   ```

2. **rally.ts** (listIssues method, line 84-123):
   ```typescript
   // Add debug logging:
   const queryString = this.buildQueryString(filters);
   if (process.env.DEBUG?.includes('rally')) {
     console.debug('[Rally] Query filters:', filters);
     console.debug('[Rally] Generated query:', queryString);
   }
   ```

3. **issue-data-service.ts** (pollRally method, line 713-787):
   ```typescript
   // Improve error logging:
   catch (err: any) {
     const errorMsg = err.message.includes('Could not parse')
       ? `${err.message} - Check Rally workspace/project configuration`
       : err.message;
     console.error('[IssueDataService] Rally poll error:', errorMsg);
     this.trackers.rally.lastError = errorMsg;
   }
   ```

**Acceptance Criteria:**
- Parsing errors include the actual query that failed
- Debug logging can be enabled with `DEBUG=rally`
- Error messages are actionable for users

---

### Task 5: Add Configuration Validation
**Difficulty:** simple
**Files:**
- `src/dashboard/server/services/tracker-config.ts`
- `src/dashboard/server/services/issue-data-service.ts`

**Changes:**

1. **tracker-config.ts** - Add validation function:
   ```typescript
   export function validateRallyConfig(config: RallyConfig): {
     valid: boolean;
     warnings: string[];
     errors: string[];
   } {
     const warnings: string[] = [];
     const errors: string[] = [];

     if (!config.workspace) {
       warnings.push('RALLY_WORKSPACE not configured - may cause query issues');
     }
     if (!config.project) {
       warnings.push('RALLY_PROJECT not configured - may cause query issues');
     }

     return { valid: errors.length === 0, warnings, errors };
   }
   ```

2. **issue-data-service.ts** - Validate on startup (line 713):
   ```typescript
   private async pollRally(): Promise<void> {
     const config = getRallyConfig();
     if (!config) {
       this.trackers.rally.lastFetchedIssues = [];
       return;
     }

     // Validate config on first poll
     if (!this.trackers.rally.lastFetchedAt) {
       const validation = validateRallyConfig(config);
       if (validation.warnings.length > 0) {
         console.warn('[Rally] Configuration warnings:', validation.warnings);
       }
     }

     // ... rest of poll logic
   }
   ```

**Acceptance Criteria:**
- Warnings logged on dashboard startup if workspace/project missing
- Config validation available for Settings page UI
- Does not block functionality, only warns

---

### Task 6: Add Rally Validation Endpoint
**Difficulty:** simple
**Files:** `src/dashboard/server/index.ts`
**Dependencies:** Task 5 (validation function needed)
**Changes:**

Add new endpoint:
```typescript
// POST /api/rally/validate - Test Rally connection and config
app.post('/api/rally/validate', async (req, res) => {
  try {
    const { apiKey, server, workspace, project } = req.body;

    // Test connectivity
    const { RallyRestApi } = await import('../../lib/tracker/rally-api.js');
    const api = new RallyRestApi({ apiKey, server });

    // Try a simple query
    const result = await api.query({
      type: 'artifact',
      fetch: ['FormattedID'],
      query: '((State = "Open"))',
      limit: 1,
      workspace,
      project,
    });

    res.json({
      valid: true,
      message: 'Rally connection successful',
      testQueryResult: `Found ${result.QueryResult.TotalResultCount} issues`,
    });
  } catch (err: any) {
    res.status(400).json({
      valid: false,
      error: err.message,
    });
  }
});
```

**Acceptance Criteria:**
- Endpoint tests Rally connectivity
- Returns specific error messages for auth, parse, network failures
- Can be called from Settings page to validate config

---

### Task 7: Update Integration Testing
**Difficulty:** medium
**Files:** `tests/integration/rally-tracker.test.ts` (NEW)
**Dependencies:** Task 3 (mock server needed)
**Changes:**

Create integration test that validates the full flow:
```typescript
describe('Rally Integration', () => {
  let mockServer: RallyApiMock;

  beforeEach(() => {
    mockServer = new RallyApiMock();
  });

  it('should fetch issues with correct WSAPI query syntax', async () => {
    const tracker = new RallyTracker({
      apiKey: 'test',
      server: mockServer.url,
    });

    await tracker.listIssues({ includeClosed: false });

    // Verify mock server received correctly formatted query
    expect(mockServer.lastQuery).toMatch(/^\(.+\)$/); // Outer parens
  });

  it('should handle WSAPI parse errors gracefully', async () => {
    mockServer.setParseError('expected ")" but saw "AND"');

    const tracker = new RallyTracker({
      apiKey: 'test',
      server: mockServer.url,
    });

    await expect(tracker.listIssues()).rejects.toThrow('Could not parse');
  });
});
```

**Acceptance Criteria:**
- Integration tests use mock Rally API server
- Tests verify end-to-end query flow
- Tests validate error handling and recovery

---

### Task 8: Update Documentation
**Difficulty:** trivial
**Files:** `configuration/issue-trackers.mdx`
**Changes:**

Add Rally troubleshooting section:
```markdown
### Rally Troubleshooting

#### WSAPI Query Parse Errors

If you see errors like `Could not parse: Error parsing expression`, check:

1. **Workspace and Project Configuration**
   ```bash
   # In ~/.panopticon.env
   RALLY_WORKSPACE=/workspace/12345
   RALLY_PROJECT=/project/67890
   ```

2. **API Key Permissions**
   - Ensure API key has read access to workspace
   - Verify key is not expired

3. **Debug Logging**
   ```bash
   DEBUG=rally pan up
   ```
   This will log the actual WSAPI queries being sent.

4. **Test Configuration**
   Use the Settings page "Test Connection" button to validate Rally setup.

#### Finding Workspace and Project IDs

Rally workspace and project IDs are numeric strings prefixed with `/workspace/` or `/project/`:

1. Log into Rally web UI
2. Navigate to desired workspace/project
3. Check URL: `https://rally1.rallydev.com/#/workspace/12345/project/67890`
4. Use: `RALLY_WORKSPACE=/workspace/12345` and `RALLY_PROJECT=/project/67890`
```

**Acceptance Criteria:**
- Documentation includes WSAPI troubleshooting
- Explains how to find workspace/project IDs
- Links to Rally API documentation

## Testing Strategy

### Unit Tests
- Test query string builder with all filter combinations
- Verify WSAPI syntax correctness
- Test edge cases (empty, special characters)

### Integration Tests
- Use mock Rally API server
- Validate end-to-end query flow
- Test error scenarios (parse errors, auth failures)

### Manual Testing
1. Configure Rally tracker in test environment
2. Verify dashboard displays Rally issues
3. Test with various filter combinations
4. Verify error messages are actionable

## Rollout Plan

### Phase 1: Core Fix (Immediate)
- Task 1: Fix query string builder
- Task 2: Add unit tests
- Deploy to test environment

### Phase 2: Validation & Testing (Same PR)
- Task 3: Create mock API server
- Task 4: Improve error logging
- Task 5: Add config validation

### Phase 3: Integration & Documentation (Follow-up)
- Task 6: Add validation endpoint
- Task 7: Integration tests
- Task 8: Documentation updates

## Success Criteria

✅ Rally tracker successfully polls issues without WSAPI errors
✅ Dashboard displays Rally issues correctly
✅ Comprehensive test coverage (>90% for Rally tracker)
✅ Clear error messages guide users to fix configuration issues
✅ Debug logging helps troubleshoot query problems
✅ Documentation helps users set up Rally correctly

## Risk Assessment

**Low Risk:** Core fix is a simple one-line change with comprehensive test coverage

**Potential Issues:**
- Edge cases with special characters in queries (mitigated by comprehensive tests)
- Rally WSAPI version differences (mitigated by following v2.0 spec)
- Workspace/project configuration variations (mitigated by validation and docs)

## Dependencies

- No external dependencies
- All changes are internal to Overdeck
- Rally API key and access required for manual testing

## Follow-up Work

- Consider adding Rally workspace/project picker in Settings UI
- Add support for Rally Portfolio Items (Epics, Initiatives)
- Implement Rally webhook support for real-time updates
