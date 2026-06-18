# Flexible Tracker ID Resolution

## Problem

Overdeck's issue ID parsing assumes all IDs follow the `PREFIX-NUMBER` format (e.g., `MIN-123`, `PAN-456`). This is hardcoded throughout the codebase via `extractTeamPrefix()` which uses the regex `/^([A-Z]+)-\d+$/i` and numerous `split('-')` calls.

Issue trackers like Rally use a different format: **type prefix directly concatenated with the number** — `F29698` (Feature), `US12345` (User Story), `DE118304` (Defect), `TA4567` (Task). There is no dash separator.

**Impact:** With the current code, `resolveProjectFromIssue("F29698")` returns `null` because `extractTeamPrefix()` returns `null` for IDs without dashes. This means:
- Workspace creation fails (can't resolve project)
- Agent spawning fails (can't determine workspace path)
- Tracker type detection falls back to Linear (wrong)
- Cost tracking loses project attribution

There are **46 locations** in the codebase that use `split('-')` to parse issue IDs. All silently produce wrong results for dash-less IDs.

## Decision

Introduce a unified issue ID parser that handles multiple formats through configurable patterns. The parser uses project-level configuration to determine how IDs map to prefixes, making it extensible to any tracker format.

---

## Architecture

### Unified Issue ID Parser

**New file: `src/lib/issue-id.ts`**

```typescript
/**
 * Parsed representation of any issue ID format.
 */
export interface ParsedIssueId {
  /** Original ID as provided (e.g., "MIN-123", "F29698") */
  raw: string;
  /** Extracted prefix for project resolution (e.g., "MIN", "F", "US") */
  prefix: string;
  /** Numeric portion (e.g., 123, 29698) */
  number: number;
  /** Normalized lowercase form for filesystem use (e.g., "min-123", "f29698") */
  normalized: string;
  /** Format that was matched */
  format: 'standard' | 'rally' | 'custom';
}

/**
 * Parse an issue ID into its components.
 *
 * Supports:
 * - Standard:  PREFIX-NUMBER  (e.g., MIN-123, PAN-456)
 * - Rally:     TYPENUMBER     (e.g., F29698, US12345, DE118304, TA4567)
 * - Custom:    Per-project regex patterns
 *
 * @param issueId - The raw issue ID string
 * @param projectConfig - Optional project config for custom patterns
 * @returns ParsedIssueId or null if no format matches
 */
export function parseIssueId(issueId: string, projectConfig?: ProjectConfig): ParsedIssueId | null {
  // Try standard format first (most common): PREFIX-NUMBER
  const standardMatch = issueId.match(/^([A-Za-z]+)-(\d+)$/);
  if (standardMatch) {
    return {
      raw: issueId,
      prefix: standardMatch[1].toUpperCase(),
      number: parseInt(standardMatch[2], 10),
      normalized: issueId.toLowerCase(),
      format: 'standard',
    };
  }

  // Try Rally format: TYPE_PREFIX followed by NUMBER (no separator)
  // Known Rally prefixes: F (Feature), US (User Story), DE (Defect),
  // TA (Task), TC (Test Case)
  const rallyMatch = issueId.match(/^(F|US|DE|TA|TC)(\d+)$/i);
  if (rallyMatch) {
    return {
      raw: issueId,
      prefix: rallyMatch[1].toUpperCase(),
      number: parseInt(rallyMatch[2], 10),
      normalized: issueId.toLowerCase(),
      format: 'rally',
    };
  }

  // Try custom project pattern if provided
  if (projectConfig?.issue_pattern) {
    const customMatch = issueId.match(new RegExp(projectConfig.issue_pattern, 'i'));
    if (customMatch && customMatch[1] && customMatch[2]) {
      return {
        raw: issueId,
        prefix: customMatch[1].toUpperCase(),
        number: parseInt(customMatch[2], 10),
        normalized: issueId.toLowerCase(),
        format: 'custom',
      };
    }
  }

  return null;
}

/**
 * Extract just the team/project prefix from an issue ID.
 * Replacement for the current extractTeamPrefix() that only handles dashes.
 */
export function extractPrefix(issueId: string): string | null {
  const parsed = parseIssueId(issueId);
  return parsed?.prefix ?? null;
}

/**
 * Extract the numeric portion of an issue ID.
 * Replacement for split('-')[1] patterns throughout the codebase.
 */
export function extractNumber(issueId: string): number | null {
  const parsed = parseIssueId(issueId);
  return parsed?.number ?? null;
}

/**
 * Get the normalized (lowercase, filesystem-safe) form of an issue ID.
 * Standard IDs keep the dash: "min-123". Rally IDs stay concatenated: "f29698".
 */
export function normalizeIssueId(issueId: string): string {
  const parsed = parseIssueId(issueId);
  return parsed?.normalized ?? issueId.toLowerCase();
}
```

### Project Config Changes

**`src/lib/projects.ts` — ProjectConfig additions:**

```typescript
export interface ProjectConfig {
  // ... existing fields ...

  /** Tracker type for this project. Affects ID parsing and state management. */
  tracker?: 'linear' | 'github' | 'gitlab' | 'rally';

  /**
   * Custom regex pattern for issue ID parsing. Must have two capture groups:
   * group 1 = prefix, group 2 = number. Example: "^(PROJ)-(\\d+)$"
   */
  issue_pattern?: string;

  /**
   * Multiple prefixes that map to this project.
   * For Rally: ['F', 'US', 'DE', 'TA'] — all artifact types route here.
   * For standard trackers: usually just one prefix via issue_prefix.
   */
  issue_prefixes?: string[];
}
```

### Project Resolution Changes

**`src/lib/projects.ts` — `resolveProjectFromIssue()` rewrite:**

```typescript
export function resolveProjectFromIssue(
  issueId: string,
  labels: string[] = []
): ResolvedProject | null {
  const parsed = parseIssueId(issueId);
  if (!parsed) return null;

  const config = loadProjectsConfig();

  for (const [key, projectConfig] of Object.entries(config.projects)) {
    // Check single issue_prefix (existing behavior)
    const singlePrefix = getIssuePrefix(projectConfig);
    if (singlePrefix?.toUpperCase() === parsed.prefix) {
      return buildResolvedProject(key, projectConfig, labels);
    }

    // Check issue_prefixes array (new: multiple prefixes per project)
    if (projectConfig.issue_prefixes?.some(p => p.toUpperCase() === parsed.prefix)) {
      return buildResolvedProject(key, projectConfig, labels);
    }

    // Fallback: derive prefix from project key
    if (!singlePrefix && !projectConfig.issue_prefixes) {
      const derivedPrefix = key.toUpperCase().replace(/-/g, '');
      if (derivedPrefix === parsed.prefix) {
        return buildResolvedProject(key, projectConfig, labels);
      }
    }
  }

  return null;
}
```

### Tracker Type Resolution Changes

**`src/lib/tracker-utils.ts` — `resolveTrackerType()` rewrite:**

```typescript
export function resolveTrackerType(issueId: string): TrackerType {
  const parsed = parseIssueId(issueId);
  if (!parsed) return 'linear'; // fallback for unparseable IDs

  // Check if the prefix matches a configured project
  const config = loadProjectsConfig();
  for (const [_key, project] of Object.entries(config.projects)) {
    const prefixes = [
      getIssuePrefix(project),
      ...(project.issue_prefixes || []),
    ].filter(Boolean).map(p => p!.toUpperCase());

    if (prefixes.includes(parsed.prefix)) {
      // Return tracker from project config
      if (project.tracker) return project.tracker;
      if (project.github_repo) return 'github';
      if (project.rally_project) return 'rally';
      return 'linear';
    }
  }

  return 'linear'; // default
}
```

### Migration of `split('-')` Callsites

All 46 `split('-')` locations must be migrated to use the unified parser. These fall into categories:

**Category 1: Prefix extraction (replace with `extractPrefix()`)**
Locations that do `issueId.split('-')[0]` to get the project prefix:
- `src/lib/tracker-utils.ts:79` — `extractIssuePrefix()`
- `src/lib/agent-enrichment.ts:101`
- `src/lib/costs/wal.ts:26`
- `src/dashboard/server/routes/specialists.ts:118`
- All dashboard route prefix extractions (19 locations in workspaces.ts)

**Category 2: Number extraction (replace with `extractNumber()`)**
Locations that do `issueId.split('-')[1]` to get the issue number:
- `src/lib/tracker-utils.ts:94` — `resolveGitHubIssue()`
- `src/lib/close-out.ts:295, 378, 379, 442, 443`
- `src/lib/lifecycle/close-issue.ts:210, 211, 353, 354`
- `src/lib/lifecycle/workflows.ts:370, 371`
- `src/lib/lifecycle/label-cleanup.ts:82, 83`

**Category 3: Normalized ID construction (replace with `normalizeIssueId()`)**
Locations that do `issueId.toLowerCase()` for filesystem paths:
- `src/lib/planning/spawn-planning-session.ts:41`
- `src/cli/commands/workspace.ts` (workspace folder naming)
- `src/dashboard/server/routes/mission-control.ts:132, 377, 479`

### Backward Compatibility

- Standard format (`MIN-123`, `PAN-456`) continues to work identically
- `extractTeamPrefix()` is deprecated but remains as a thin wrapper around `extractPrefix()` for any external consumers
- `extractIssuePrefix()` in tracker-utils.ts is replaced with `extractPrefix()` re-export
- Workspace folder naming: `MIN-123` → `feature-min-123` (unchanged), `F29698` → `feature-f29698` (new, valid)

### Configuration Example

```yaml
# Rally-tracked project with multiple artifact type prefixes
enterprise-integration:
  name: "Enterprise Integration"
  path: /home/user/Projects/EnterpriseIntegration
  tracker: rally
  issue_prefixes: [F, US, DE, TA]    # All Rally artifact types → this project
  rally_project: "Integration Team"
```

With this config:
- `pan workspace create F29698` → resolves to `enterprise-integration` project
- `pan workspace create US12345` → resolves to `enterprise-integration` project
- `pan workspace create DE118304` → resolves to `enterprise-integration` project

---

## Testing

### Unit Tests (`tests/lib/issue-id.test.ts` — new file)

1. **Standard format parsing**:
   - `parseIssueId("MIN-123")` → `{ prefix: "MIN", number: 123, format: "standard" }`
   - `parseIssueId("PAN-456")` → `{ prefix: "PAN", number: 456, format: "standard" }`
   - `parseIssueId("min-123")` → case-insensitive, prefix uppercased

2. **Rally format parsing**:
   - `parseIssueId("F29698")` → `{ prefix: "F", number: 29698, format: "rally" }`
   - `parseIssueId("US12345")` → `{ prefix: "US", number: 12345, format: "rally" }`
   - `parseIssueId("DE118304")` → `{ prefix: "DE", number: 118304, format: "rally" }`
   - `parseIssueId("TA4567")` → `{ prefix: "TA", number: 4567, format: "rally" }`

3. **Invalid inputs**:
   - `parseIssueId("notanid")` → `null`
   - `parseIssueId("123")` → `null`
   - `parseIssueId("")` → `null`

4. **Normalized forms**:
   - `normalizeIssueId("MIN-123")` → `"min-123"`
   - `normalizeIssueId("F29698")` → `"f29698"`
   - `normalizeIssueId("US12345")` → `"us12345"`

5. **Multiple prefixes resolution**:
   - Project with `issue_prefixes: [F, US, DE]` matches all three Rally types
   - Project with `issue_prefix: MIN` still works (backward compat)

### Integration Tests

1. **Workspace creation with Rally IDs**:
   - `pan workspace create F29698` → `workspaces/feature-f29698/` created
   - Project resolution works with `issue_prefixes` config

2. **Backward compatibility suite**:
   - All existing test cases pass unchanged
   - `MIN-123`, `PAN-456` resolve identically to before

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/issue-id.ts` | **NEW FILE** — unified parser, extractPrefix, extractNumber, normalizeIssueId |
| `src/lib/projects.ts` | Add `tracker`, `issue_pattern`, `issue_prefixes` to ProjectConfig; rewrite `resolveProjectFromIssue()` and `extractTeamPrefix()` |
| `src/lib/tracker-utils.ts` | Rewrite `extractIssuePrefix()`, `resolveGitHubIssue()`, `resolveTrackerType()` to use unified parser |
| `src/lib/agent-enrichment.ts` | Replace `split('-')` with `extractPrefix()` |
| `src/lib/costs/wal.ts` | Replace `split('-')` with `extractPrefix()` |
| `src/lib/close-out.ts` | Replace 5 `split('-')` calls |
| `src/lib/lifecycle/close-issue.ts` | Replace 4 `split('-')` calls |
| `src/lib/lifecycle/workflows.ts` | Replace 2 `split('-')` calls |
| `src/lib/lifecycle/label-cleanup.ts` | Replace 2 `split('-')` calls |
| `src/lib/lifecycle/teardown-workspace.ts` | Replace `split('-')` call |
| `src/cli/commands/work/done.ts` | Replace `split('-')` call |
| `src/cli/commands/work/wipe.ts` | Replace `split('-')` call |
| `src/cli/commands/inspect.ts` | Replace `split('-')` call |
| `src/dashboard/server/routes/workspaces.ts` | Replace 19 `split('-')` calls |
| `src/dashboard/server/routes/mission-control.ts` | Replace 6 `split('-')` calls |
| `src/dashboard/server/routes/specialists.ts` | Replace `split('-')` call |
| `src/dashboard/server/routes/agents.ts` | Replace `split('-')` call |
| `src/dashboard/server/routes/misc.ts` | Replace 3 `split('-')` calls |
| `src/dashboard/server/routes/issues.ts` | Replace 7 `split('-')` calls |
| `tests/lib/issue-id.test.ts` | **NEW FILE** — comprehensive parser tests |
| `tests/lib/projects.test.ts` | Update project resolution tests for multi-prefix |

## Files NOT to Modify

- `src/lib/tracker/rally.ts` — Rally tracker already handles its own ID formats internally
- `src/lib/tracker/interface.ts` — Issue interface is already format-agnostic
- Any MCP or external tool code — they pass IDs through, don't parse them
