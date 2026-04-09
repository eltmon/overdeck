# Projects Configuration

**Complete reference for `projects.yaml` project configuration.**

---

## Overview

Projects are configured in `~/.panopticon/projects.yaml`. Each project defines how Panopticon manages workspaces, issue tracking, and agent behavior for a codebase.

---

## Basic Structure

```yaml
projects:
  my-project:
    name: "My Project"
    path: /path/to/project
    issue_prefix: PREFIX
    # ... more fields
```

---

## Required Fields

### `name`

Human-readable project name for display in the dashboard.

```yaml
name: "Enterprise Integration"
```

### `path`

Absolute path to the project root on disk.

```yaml
path: /home/user/Projects/EnterpriseIntegration
```

### `issue_prefix` or `issue_prefixes`

Issue ID prefix(es) for resolving issues to this project.

```yaml
# Single prefix
issue_prefix: INT

# Multiple prefixes (for Rally)
issue_prefixes: [F, US, DE, TA]
```

---

## Optional Fields

### Tracker Configuration

#### `tracker`

Issue tracker type for this project.

```yaml
tracker: rally    # linear | github | gitlab | rally
```

See [Issue Trackers](./issue-trackers.md) for full documentation.

#### `linear_team`

Linear team prefix (e.g., `MIN` for `MIN-123` issues).

```yaml
linear_team: MIN
```

#### `github_repo`

GitHub repository for GitHub Issues.

```yaml
github_repo: owner/repo
```

#### `gitlab_project`

GitLab project path.

```yaml
gitlab_project: group/project
```

#### `rally_project`

Rally project name.

```yaml
rally_project: "Integration Team"
```

#### `issue_pattern`

Custom regex pattern for issue ID parsing. Must have two capture groups (prefix, number).

```yaml
issue_pattern: "^(PROJ)-(\\d+)$"
```

#### `shadow`

Shadow mode configuration. When enabled, Panopticon tracks state locally without modifying the tracker.

```yaml
shadow:
  enabled: true
  trackers:
    rally: true
```

---

## Workspace Configuration

### `workspace.type`

Workspace type: `monorepo` or `polyrepo`.

```yaml
workspace:
  type: polyrepo
```

### Standard Polyrepo Fields

```yaml
workspace:
  type: polyrepo
  default_branch: main
  repos:
    - name: frontend
      path: apps/web
    - name: backend
      path: services/api
```

### Progressive Polyrepo Fields

For 10+ repo projects, enable progressive mode:

```yaml
workspace:
  type: polyrepo
  progressive: true
  always_include: [meta]
  groups_file: team-meta/panopticon/repo-groups.yaml
  pr_target: qa
```

| Field | Type | Description |
|-------|------|-------------|
| `progressive` | `boolean` | Enable progressive workspace creation |
| `always_include` | `string[]` | Repos to include on workspace creation |
| `groups_file` | `string` | Path to repo-groups.yaml |
| `pr_target` | `string` | Default PR target for all repos |

### Per-Repo Fields

```yaml
repos:
  - name: meta
    path: team-meta
    link_type: symlink      # symlink | worktree (default: worktree)
    readonly: true         # Prevent agent from committing
    default_branch: main   # Branch for worktree base
    branch_prefix: feature/ # Prefix for feature branches
    pr_target: qa          # Per-repo PR target override
```

---

## Specialists Configuration

### `specialists`

Control which specialist agents run for this project.

```yaml
specialists:
  merge: false    # Disable merge automation
```

### Quality Gates

```yaml
specialists:
  quality_gates:
    typecheck: true
    lint: true
    test: true
```

---

## Package Manager

```yaml
package_manager: bun    # bun | npm | pnpm
```

Determines which command runs during workspace creation and verification.

---

## Complete Example

```yaml
projects:
  enterprise-integration:
    name: "Enterprise Integration"
    path: /home/user/Projects/EnterpriseIntegration
    tracker: rally
    issue_prefixes: [F, US, DE, TA]
    rally_project: "Integration Team"
    package_manager: bun
    workspace:
      type: polyrepo
      progressive: true
      always_include: [meta]
      groups_file: team-meta/panopticon/repo-groups.yaml
      pr_target: qa
      repos:
        - name: meta
          path: team-meta
          link_type: symlink
          readonly: true
        - name: api-service
          path: HS/api-service
          default_branch: master
        - name: int-provider-a
          path: HS/int-provider-a
          default_branch: master
        - name: int-canonical-to-hs
          path: Integration/canonical/int-canonical-to-hs
        - name: int-toast
          path: Providers/toast/int-toast
    specialists:
      merge: false
    shadow:
      enabled: true
      trackers:
        rally: true
```

---

## See Also

- [Issue Trackers](./issue-trackers.md) — Tracker-specific configuration
- [Polyrepo](./polyrepo.md) — Polyrepo workspace configuration
- [Progressive Polyrepo](./progressive-polyrepo.md) — Progressive workspace configuration
- [Setup Wizard](./setup-wizard.md) — Interactive project setup
- [Meta Repos](./meta-repos.md) — Meta repo pattern
