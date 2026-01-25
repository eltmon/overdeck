# Pan Test Config

Configure test suites for your project in Panopticon.

## Trigger Patterns

- "configure tests"
- "setup test runner"
- "add test suite"
- "run all tests"

## What This Skill Does

Guides you through configuring test suites in `~/.panopticon/projects.yaml`:

1. **Backend Tests** - Maven, pytest, Cargo, etc.
2. **Frontend Unit Tests** - Vitest, Jest
3. **E2E Tests** - Playwright, Cypress
4. **Container Support** - Run tests inside Docker containers

## Configuration Schema

```yaml
projects:
  myproject:
    name: "My Project"
    path: /home/user/projects/myproject
    linear_team: PRJ

    tests:
      backend:
        type: maven           # Test framework type
        path: api             # Path relative to workspace
        command: ./mvnw test  # Command to run
        container: false      # Run inside container?

      frontend_unit:
        type: vitest
        path: fe
        command: pnpm test:unit --run
        container: true
        container_name: "{{COMPOSE_PROJECT}}-fe-1"

      frontend_e2e:
        type: playwright
        path: fe
        command: pnpm test:e2e
        env:
          BASE_URL: "https://{{FEATURE_FOLDER}}.{{DOMAIN}}"
          USE_LOCALIAS: "true"
```

## Supported Test Types

| Type | Framework | Output Parsing |
|------|-----------|----------------|
| `maven` | Maven/JUnit | Tests run: X, Failures: Y |
| `vitest` | Vitest | X passed, Y failed |
| `jest` | Jest | X passed, Y failed |
| `playwright` | Playwright | X passed, Y failed |
| `pytest` | pytest | X passed, Y failed |
| `cargo` | Rust/Cargo | test result: ok. X passed |

## Running Tests

```bash
# Run all tests for a workspace
pan test run min-123

# Run all tests for main branch
pan test run main

# Run specific tests only
pan test run min-123 --tests backend,frontend_unit

# List configured tests
pan test list

# List tests for specific project
pan test list myproject
```

## Example Configurations

### Java Backend + React Frontend

```yaml
tests:
  backend:
    type: maven
    path: api
    command: ./mvnw test -Pfast-test

  frontend_unit:
    type: vitest
    path: fe
    command: pnpm test:unit --run

  frontend_e2e:
    type: playwright
    path: fe
    command: pnpm test:e2e
    env:
      BASE_URL: "https://{{FEATURE_FOLDER}}.myapp.test"
```

### Python Backend + Vue Frontend

```yaml
tests:
  backend:
    type: pytest
    path: api
    command: pytest -v

  frontend:
    type: vitest
    path: frontend
    command: npm run test

  e2e:
    type: playwright
    path: e2e
    command: npx playwright test
```

### Rust Project

```yaml
tests:
  unit:
    type: cargo
    path: .
    command: cargo test

  integration:
    type: cargo
    path: .
    command: cargo test --test integration
```

### Running Tests in Docker Containers

For feature workspaces with devcontainers, tests can run inside the container:

```yaml
tests:
  frontend_unit:
    type: vitest
    path: fe
    command: pnpm test:unit --run
    container: true
    container_name: "{{COMPOSE_PROJECT}}-fe-1"
```

The `container_name` uses placeholders:
- `{{COMPOSE_PROJECT}}` - e.g., `myapp-feature-min-123`
- So container becomes: `myapp-feature-min-123-fe-1`

## Test Reports

Reports are saved to `{project}/reports/`:

```
reports/
├── test-run-main-20260124-093000.md
├── test-run-feature-min-123-20260124-100000.md
├── backend-main-20260124-093000.log
├── frontend_unit-main-20260124-093000.log
└── frontend_e2e-main-20260124-093000.log
```

### Report Format

```markdown
# Test Run Report - feature-min-123

**Date:** 2026-01-24T10:00:00Z
**Target:** feature-min-123
**Base URL:** https://feature-min-123.myapp.test

## Summary

| Suite | Status | Passed | Failed | Duration |
|-------|--------|--------|--------|----------|
| backend | ✅ PASS | 142 | 0 | 45s |
| frontend_unit | ✅ PASS | 89 | 0 | 12s |
| frontend_e2e | ✅ PASS | 23 | 0 | 2m 15s |

**Overall: ✅ ALL PASSED** (0 failures)
```

## Desktop Notifications

When tests complete, a desktop notification is sent:
- **Windows/WSL2**: PowerShell toast notifications
- **macOS**: osascript notifications
- **Linux**: notify-send

Disable with `--no-notify`:
```bash
pan test run min-123 --no-notify
```

## Related Skills

- `/pan-workspace-config` - Workspace configuration
- `/test-all` - Project-specific test runner skill
