# Polyrepo Workspaces

**Guide for managing multi-repository projects with Panopticon.**

---

## Overview

A polyrepo workspace creates git worktrees for multiple repositories, allowing an agent to work across all of them from a single directory.

---

## Standard Polyrepo (2-10 Repos)

For projects with 2-10 repositories, Panopticon creates worktrees for **all repos** when a workspace is created.

```yaml
projects:
  my-project:
    workspace:
      type: polyrepo
      repos:
        - name: frontend
          path: apps/web
        - name: backend
          path: services/api
        - name: shared
          path: packages/shared
```

All repos are checked out when `pan workspace create` runs. This is simple and predictable.

---

## Progressive Polyrepo (10+ Repos)

For large projects with 10+ repositories, see the [Progressive Polyrepo](./progressive-polyrepo.md) guide.

**When to use progressive mode:**
- 10+ repositories
- Most issues only touch 1-3 repos
- You want a meta repo for shared skills/docs
- Workspace creation should be fast regardless of repo count

---

## Configuration

### Basic Polyrepo Config

```yaml
projects:
  my-project:
    workspace:
      type: polyrepo
      default_branch: main
      repos:
        - name: frontend
          path: apps/web
          default_branch: master
        - name: backend
          path: services/api
        - name: infra
          path: infrastructure
```

### Per-Repo Settings

```yaml
repos:
  - name: frontend
    path: apps/web
    default_branch: master        # Override default branch
    branch_prefix: feature/       # Prefix for feature branches
  - name: docs
    path: docs
    readonly: true               # Agent should not commit
```

---

## Repositories

### Repo Resolution

Each repo entry requires:
- `name` — Identifier used in commands and logs
- `path` — Path relative to the project root

Optional:
- `default_branch` — Branch for worktree base (default: `main`)
- `branch_prefix` — Prefix for feature branches (default: `feature/`)
- `readonly` — Prevent agent from committing

---

## See Also

- [Progressive Polyrepo](./progressive-polyrepo.md) — For 10+ repo projects
- [Meta Repos](./meta-repos.md) — Shared skills and documentation repos
- [Setup Wizard](./setup-wizard.md) — Interactive project setup
