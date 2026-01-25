# PAN-50: Replace rally npm package with direct WSAPI calls

## Status: PLANNING COMPLETE

## Problem Statement

The `rally` npm package (v2.1.3) depends on deprecated `core-js@2.x`:
- `rally@2.1.3` → `babel-runtime@6.11.6` → `core-js@2.6.12`
- core-js@<3.23.3 is unmaintained and causes V8 performance issues (up to 100x slowdown)

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rally usage | Actively used | Not just dependency hygiene - needs to work correctly |
| Testing approach | Mock-only | Keep current approach, no real Rally instance needed |
| Artifact types | All (US, DE, TA, F) | Maintain existing functionality |
| Scope | Pure 1:1 replacement | No feature creep, match existing behavior exactly |

## Rally WSAPI Reference

- **Base URL**: `https://rally1.rallydev.com/slm/webservice/v2.0/`
- **Auth**: `ZSESSIONID` header with API key
- **Content-Type**: `application/json`

### Endpoints Used

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Query artifacts | GET | `/artifact?query=...&fetch=...` |
| Get by ref | GET | `/{type}/{objectId}` |
| Create | POST | `/{type}/create` |
| Update | POST | `/{type}/{objectId}` |

## Architecture

### New File: `src/lib/tracker/rally-api.ts`

Thin REST client (~100 lines) that:
- Wraps native `fetch` with Rally-specific headers
- Handles JSON serialization/deserialization
- Provides typed methods: `query()`, `get()`, `create()`, `update()`
- Does NOT handle business logic (normalization, state mapping)

```typescript
export interface RallyQueryResult {
  QueryResult: {
    Results: any[];
    TotalResultCount: number;
    Errors: string[];
    Warnings: string[];
  };
}

export class RallyRestApi {
  constructor(config: { apiKey: string; server?: string });
  async query(config: RallyQueryConfig): Promise<RallyQueryResult>;
  async create(type: string, data: any): Promise<RallyCreateResult>;
  async update(ref: string, data: any): Promise<RallyUpdateResult>;
}
```

### Modified File: `src/lib/tracker/rally.ts`

- Replace `import rally from 'rally'` with `import { RallyRestApi } from './rally-api.js'`
- Replace callback-based SDK calls with Promise-based REST calls
- Keep all existing normalization and business logic unchanged
- Remove Promise wrappers (no longer needed)

### Modified File: `tests/lib/tracker/rally.test.ts`

- Replace `vi.mock('rally')` with `vi.mock('../../../src/lib/tracker/rally-api.js')`
- Mock the new `RallyRestApi` class methods instead of SDK callbacks
- Keep same test cases and expected outcomes

## Implementation Tasks (Beads)

| Bead ID | Task | Description |
|---------|------|-------------|
| panopticon-kqx0.1 | Create rally-api.ts | REST client with fetch, typed responses |
| panopticon-kqx0.2 | Update rally.ts | Replace SDK with new client, simplify Promise handling |
| panopticon-kqx0.3 | Update rally.test.ts | Mock new client class |
| panopticon-kqx0.4 | Remove rally dependency | Update package.json, run npm install |
| panopticon-kqx0.5 | Verify clean | Run `npm ls core-js`, confirm empty |
| panopticon-kqx0.6 | Run tests | Ensure all tests pass |

**Dependency chain:** `.1` → `.2` → `.3` → `.4` → `.5` → `.6` (sequential)

## Test Strategy

- Existing test cases cover all functionality
- Tests will mock `RallyRestApi` class methods
- Mock responses match Rally WSAPI format (slightly different from SDK)
- No integration tests against real Rally

## Response Format Mapping

The rally SDK normalized responses; we need to handle raw WSAPI format:

**SDK Response** (current):
```javascript
{ Results: [...artifacts] }
```

**WSAPI Response** (new):
```javascript
{
  QueryResult: {
    Results: [...artifacts],
    TotalResultCount: 42,
    Errors: [],
    Warnings: []
  }
}
```

The `rally-api.ts` client will extract `QueryResult.Results` to maintain compatibility.

## Acceptance Criteria

- [ ] All Rally tracker tests pass (`npm test -- tests/lib/tracker/rally.test.ts`)
- [ ] `npm ls core-js` returns empty (no core-js in dependency tree)
- [ ] No changes to public API (`RallyTracker` class interface unchanged)
- [ ] Full test suite passes (`npm test`)

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| API differences | Low | Rally WSAPI is well-documented; SDK was just a wrapper |
| Auth changes | Low | Use same `ZSESSIONID` header pattern |
| Response format changes | Medium | Handle in rally-api.ts, test coverage |

## Out of Scope

- Adding retry logic
- Adding rate limiting
- Supporting new Rally features
- Changing the IssueTracker interface
- Adding integration tests

## References

- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/50
- Rally WSAPI Docs: https://rally1.rallydev.com/slm/doc/webservice/
