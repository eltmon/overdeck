# PAN-1: Add Rally Support as Secondary Tracker

## Problem Statement

Panopticon currently supports Linear (primary) and GitHub Issues (secondary). Enterprise teams using Rally need similar integration to leverage Panopticon's multi-agent orchestration capabilities.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Scope** | Full CRUD | Support create/read/update/delete to match Linear/GitHub parity |
| **Target users** | Both enterprise and individual | Start simple, design for enterprise extensibility |
| **Work item types** | All (User Stories, Defects, Tasks, Features) | Comprehensive coverage for different workflows |
| **Hierarchy handling** | Flatten all | Treat as flat issues with `parent_id` field. Matches Linear/GitHub model |
| **State mapping** | Standard 3-state | Defined→open, In-Progress→in_progress, Completed/Accepted→closed |
| **API client** | rally-node SDK | npm package 'rally' - handles auth/pagination, reduce boilerplate |
| **Out of scope v1** | Webhooks + Attachments | Keep v1 simple, add real-time updates later |

## State Mapping

| Rally State | Panopticon State |
|-------------|------------------|
| Defined | open |
| In-Progress | in_progress |
| Completed | closed |
| Accepted | closed |

## Architecture

### Files to Create

| File | Purpose |
|------|---------|
| `src/lib/tracker/rally.ts` | Rally adapter implementing `IssueTracker` interface |
| `tests/lib/tracker/rally.test.ts` | Unit tests with mocked Rally API |

### Files to Modify

| File | Changes |
|------|---------|
| `src/lib/tracker/interface.ts` | Add `'rally'` to `TrackerType` union |
| `src/lib/tracker/factory.ts` | Add `case 'rally'` handler, `RallyConfig` interface |
| `src/lib/config.ts` | Add `RallyConfig` interface, `rally?: RallyConfig` to `TrackersConfig` |
| `src/cli/commands/work/list.ts` | Add Rally to `getConfiguredTrackers()` and `getTrackerConfig()` |
| `src/dashboard/server/index.ts` | Add `fetchRallyIssues()` function, Rally config extraction |
| `src/dashboard/frontend/src/types.ts` | Add `'rally'` to `IssueSource` type |
| `skills/pan-tracker/SKILL.md` | Add Rally configuration documentation |

### Dependencies

```
rally  (npm package)
```

### Configuration Schema

```toml
[trackers.rally]
type = "rally"
api_key_env = "RALLY_API_KEY"   # Default: RALLY_API_KEY
server = "rally1.rallydev.com"  # Optional, defaults to rally1.rallydev.com
workspace = "/workspace/12345"  # Rally workspace OID
project = "/project/67890"      # Rally project OID (optional, filters to project)
```

### Interface Implementation

```typescript
// src/lib/tracker/rally.ts
export class RallyTracker implements IssueTracker {
  // Map Rally artifact types to unified Issue type
  // User Story, Defect, Task, Feature all become Issue

  async listIssues(filters?: IssueFilters): Promise<Issue[]>
  async getIssue(id: string): Promise<Issue>
  async createIssue(issue: NewIssue): Promise<Issue>
  async updateIssue(id: string, update: IssueUpdate): Promise<Issue>
  async addComment(issueId: string, comment: string): Promise<Comment>
  async getComments(issueId: string): Promise<Comment[]>
}
```

### Rally-Specific Considerations

1. **Reference format**: Rally uses FormattedID (e.g., `US123`, `DE456`, `TA789`, `F012`)
2. **Work item types**: Map to `artifactType` field in normalized Issue
3. **Parent references**: Rally's `Parent` field maps to `parent_id`
4. **Priority**: Rally uses strings ("High", "Normal", "Low") - map to numbers
5. **API pagination**: Rally SDK handles this automatically

## Implementation Order

1. **Core adapter** - Rally tracker implementing IssueTracker interface
2. **Factory integration** - Wire into createTracker factory
3. **Config support** - Add Rally config to TOML schema
4. **CLI integration** - Rally issues in `pan work list`
5. **Dashboard integration** - Rally issues in Kanban board
6. **Documentation** - Add to pan-tracker skill
7. **Tests** - Unit tests with mocked Rally API

## Testing Strategy

1. **Unit tests** (`tests/lib/tracker/rally.test.ts`)
   - Mock Rally SDK responses
   - Test state mapping
   - Test artifact type handling
   - Test error handling (auth, not found)

2. **Integration test** (manual)
   - Configure Rally in `~/.panopticon/config.toml`
   - Run `pan work list` and verify Rally issues appear
   - Test `pan work issue` spawns agent for Rally item
   - Verify dashboard shows Rally issues

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| rally-node SDK may be stale/unmaintained | Check npm stats, have fallback plan for raw REST |
| Enterprise Rally may have custom fields | Start with standard fields, add custom field support later |
| Rate limiting | Rally SDK likely handles this; add retry logic if needed |
| SSO/OAuth complexity | v1 uses API key only; document SSO workaround |

## Out of Scope (Explicitly)

- **Webhooks**: Rally's webhook system is complex; v1 is poll-based
- **Attachments**: File sync between trackers deferred to future issue
- **Custom fields**: Enterprise Rally often has custom fields; v1 uses standard fields only
- **SSO/OAuth**: API key auth only for v1
- **Rally Lookback API**: Historical/trend data not needed for v1

## Success Criteria

1. `pan work list` shows Rally issues alongside Linear/GitHub
2. `pan work issue RALLY-123` creates workspace and spawns agent
3. Rally issues appear in dashboard Kanban board with correct states
4. Documentation in pan-tracker skill covers Rally setup
5. Unit tests pass with mocked Rally API responses
