# Testing Guide

How to run tests and write new ones for Panopticon.

## Test Suites

| Command | Scope | Runner |
|---------|-------|--------|
| `npm test` | All tests (unit + integration + e2e + frontend) | Vitest + frontend tests |
| `npm run test:unit` | Unit tests only | Vitest (`tests/unit/`) |
| `npm run test:integration` | Integration tests | Vitest (`tests/integration/`) |
| `npm run test:e2e` | End-to-end tests | Vitest (`tests/e2e/`) |
| `npm run test:coverage` | All tests with coverage report | Vitest |

Frontend tests run separately: `cd src/dashboard/frontend && npm test`.

## Test Structure

```
tests/
├── unit/                     # Fast, isolated unit tests
│   ├── cli/                  # CLI command tests
│   └── lib/                  # Library function tests
├── integration/              # Tests requiring file system or subprocess
│   └── e2e/                  # Legacy location (some tests here)
├── e2e/                      # End-to-end tests
├── cloister/                 # Specialist system tests
│   └── sync-main.test.ts     # Sync with Main feature tests
├── dashboard/                # Dashboard-specific tests
│   └── utils/                # Utility tests
└── lib/                      # Library tests
    ├── settings.test.ts
    └── tracker/

src/dashboard/frontend/
└── src/
    └── __tests__/            # Frontend component tests
```

## Specialist Pipeline Tests

The specialist pipeline (review → test → merge) has dedicated tests in `tests/cloister/`:

- `sync-main.test.ts` — Tests for the Sync with Main feature: uncommitted changes auto-commit, merge with stats, fetch failure, conflict delegation to merge-agent, wake failure, git lock blocking, `scanForConflictMarkers`

## Writing Tests

### Conventions

- Test files: `*.test.ts` or `*.spec.ts`
- Co-locate with source when practical, otherwise use `tests/` directory
- Use `describe` blocks to group related tests
- Test names should describe behavior, not implementation

### Mocking

Vitest provides `vi.mock()` for module mocking. Common patterns:

```typescript
// Mock execAsync for git command tests
vi.mock('util', () => ({
  promisify: () => vi.fn(),
}));

// Mock file system
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));
```

## Dashboard UI Testing

### Playwright MCP

The Panopticon dashboard can be tested interactively using the Playwright MCP server (configured in `~/.claude/mcp.json`). This provides browser automation tools for navigation, clicking, form filling, and screenshots.

### `data-testid` Convention

All interactive dashboard elements should have `data-testid` attributes for reliable Playwright selection. This avoids brittle selectors based on CSS classes (which Tailwind compiles away) or DOM structure.

**Naming convention**: `<component>-<element>`

| Example | Element |
|---------|---------|
| `workspace-panel` | WorkspacePanel root container |
| `workspace-sidebar` | Left sidebar in WorkspacePanel |
| `workspace-actions` | Actions section in WorkspacePanel |
| `sync-with-main-btn` | Sync with Main button |
| `merge-btn` | MERGE button |
| `review-test-btn` | Review & Test button |
| `git-status` | Git status section |

**Rules:**
- Every clickable button should have a `data-testid`
- Every section/panel that needs scrolling or targeting should have a `data-testid`
- Prefer `data-testid` over `getByRole` or `getByText` for action buttons
- Use `getByRole` for standard semantic elements (nav, headings)
- Use `getByText` only for content verification, not for clicking

**Playwright patterns:**

```typescript
// Preferred: testid
await page.getByTestId('sync-with-main-btn').click();

// For scrolling to an element
const sidebar = page.getByTestId('workspace-sidebar');
await sidebar.evaluate(el => el.scrollTop = el.scrollHeight);

// For dialogs
page.once('dialog', dialog => dialog.accept());
await page.getByTestId('sync-with-main-btn').click();
```

### Smoke Tests (PAN-249)

A Playwright smoke test suite is planned (PAN-249) covering:

1. **Navigation**: All nav tabs load, project tree renders
2. **Mission Control**: Workspace selection, session timeline, tab buttons
3. **Board**: Kanban columns render, cards are clickable
4. **Workspace actions**: Sync with Main, Review & Test, MERGE buttons exist and are functional

## Test Agent (Specialist)

The test-agent specialist runs tests as part of the review pipeline:

1. **Feature branch tests**: Runs `npm test` in the workspace, output redirected to file
2. **Baseline comparison**: If failures found, runs tests on main and compares
3. **Pass criteria**: Feature branch introduces ZERO new test failures vs main
4. **Status update**: Reports results via API (`POST /api/review/:issueId/status`)

Test-agent prompt template: `src/lib/cloister/prompts/test-agent.md`

See [SPECIALIST_WORKFLOW.md](./SPECIALIST_WORKFLOW.md) for the full pipeline.
