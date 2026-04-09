# Issue Trackers

**Configuring Panopticon to work with Linear, GitHub, Rally, and GitLab issue trackers.**

---

## Overview

Panopticon resolves issue IDs to projects and tracks work state through a unified interface that supports multiple tracker types.

---

## Supported Trackers

| Tracker | Prefix Format | Configuration |
|---------|---------------|---------------|
| Linear | `TEAM-123` | `linear_team` |
| GitHub Issues | `#123` | `github_repo` |
| Rally | `F123`, `US123`, `DE123`, `TA123` | `tracker: rally`, `issue_prefixes` |
| GitLab Issues | `#123` | `gitlab_project` |

---

## Linear

Linear is the default tracker. Configure it with the `linear_team` field:

```yaml
projects:
  my-project:
    linear_team: TEAM
    # Issues like TEAM-123 resolve to this project
```

Panopticon auto-detects Linear issues from the `TEAM-123` format.

---

## GitHub Issues

For projects using GitHub Issues without a project prefix:

```yaml
projects:
  my-project:
    github_repo: owner/repo
```

Issue IDs use the format `#123` (just the number, no prefix).

---

## GitLab Issues

For GitLab-managed projects:

```yaml
projects:
  my-project:
    gitlab_project: group/project
```

---

## Rally

Rally uses a different ID format than other trackers. Instead of `PREFIX-NUMBER`, Rally artifacts use **type prefixes directly concatenated with numbers**:

| Artifact Type | Prefix | Example |
|---------------|--------|---------|
| Feature | `F` | `F29698` |
| User Story | `US` | `US12345` |
| Defect | `DE` | `DE118304` |
| Task | `TA` | `TA4567` |

### Rally Configuration

```yaml
projects:
  enterprise-integration:
    name: "Enterprise Integration"
    tracker: rally
    issue_prefixes: [F, US, DE, TA]    # All artifact types route here
    rally_project: "Integration Team"
```

### Multiple Prefixes Per Project

Rally projects often use multiple artifact types. The `issue_prefixes` array maps all types to the same project:

```yaml
tracker: rally
issue_prefixes: [F, US, DE, TA, TC]    # Feature, User Story, Defect, Task, Test Case
```

### Shadow Mode for Rally

Rally doesn't support the same API capabilities as Linear. Shadow mode is recommended:

```yaml
projects:
  enterprise-integration:
    tracker: rally
    issue_prefixes: [F, US, DE, TA]
    rally_project: "Integration Team"
    shadow:
      enabled: true
      trackers:
        rally: true    # Track Rally state locally, don't modify Rally
```

In shadow mode, Panopticon tracks state locally without making changes to Rally.

---

## Custom Issue Patterns

For trackers with non-standard formats, use `issue_pattern` to define a custom regex:

```yaml
projects:
  my-project:
    tracker: custom
    issue_pattern: "^(PROJ)-(\\d+)$"    # Matches PROJ-123
    issue_prefixes: [PROJ]
```

The regex must have two capture groups:
1. **Group 1** — The prefix (used for project resolution)
2. **Group 2** — The numeric ID

---

## Project Resolution

Panopticon resolves issue IDs to projects using this precedence:

1. Check `linear_team` field (e.g., `MIN` matches `MIN-123`)
2. Check `issue_prefixes` array (for Rally multi-prefix)
3. Check `issue_prefix` field (single prefix)
4. Fall back to deriving prefix from project key

### Resolution Examples

```yaml
projects:
  my-app:
    issue_prefix: APP        # APP-123 → this project
  enterprise:
    tracker: rally
    issue_prefixes: [F, US]  # F123, US456 → this project
```

| Issue ID | Project |
|----------|---------|
| `APP-123` | `my-app` |
| `F29698` | `enterprise` |
| `US12345` | `enterprise` |

---

## Configuration Fields

### ProjectConfig Fields for Trackers

| Field | Type | Description |
|-------|------|-------------|
| `tracker` | `linear \| github \| gitlab \| rally` | Tracker type |
| `linear_team` | `string` | Linear team prefix |
| `github_repo` | `string` | GitHub repo (`owner/repo`) |
| `gitlab_project` | `string` | GitLab project (`group/project`) |
| `rally_project` | `string` | Rally project name |
| `issue_prefix` | `string` | Single issue prefix |
| `issue_prefixes` | `string[]` | Multiple prefixes (Rally-style) |
| `issue_pattern` | `string` | Custom regex for ID parsing |
| `shadow` | `object` | Shadow mode configuration |

---

## See Also

- [Projects](./projects.md) — Complete project configuration reference
- [Flexible Tracker ID Resolution](../prds/planned/flexible-tracker-id-resolution.md) — Technical details on ID parsing
