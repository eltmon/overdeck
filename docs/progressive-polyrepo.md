# Progressive Polyrepo Workspaces

**Guide for managing large-scale polyrepo projects with 10+ repositories using progressive worktree creation.**

---

## Overview

Progressive polyrepo workspaces solve the problem of managing projects with many repositories (10+). Instead of creating worktrees for **all** repos at workspace creation (which is slow and wastes disk space), progressive mode starts with only essential repos and adds more on demand.

This is ideal for:
- Large integration projects with 30+ repositories
- Projects where most issues only touch 1-3 repos
- Teams using a meta repo for shared skills and documentation

---

## When to Use Progressive vs Standard Polyrepo

| Scenario | Recommendation |
|----------|----------------|
| 2-10 repos | Standard polyrepo (all repos checked out) |
| 10+ repos | Progressive polyrepo |
| Meta repo for shared skills/docs | Progressive with symlinked meta repo |
| All repos are actively developed | Standard polyrepo |
| Most issues touch 1-3 repos | Progressive polyrepo |

---

## Configuration

### New Config Fields

Add these fields to your `projects.yaml` entry:

```yaml
projects:
  my-project:
    workspace:
      type: polyrepo
      progressive: true                    # Enable progressive mode
      always_include: [meta]             # Repos to include on workspace creation
      groups_file: team-meta/panopticon/repo-groups.yaml  # Path to groups file
      pr_target: qa                       # Default PR target for all repos
    repos:
      - name: meta
        path: team-meta
        link_type: symlink                # Symlink = no feature branch, no worktree
        readonly: true                    # Agent should not commit to this repo
      - name: api-service
        path: HS/api-service
        default_branch: master
      # ... more repos
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `progressive` | `boolean` | When `true`, only `always_include` repos are created on workspace init |
| `always_include` | `string[]` | Repo names to always include (typically meta repos) |
| `groups_file` | `string` | Path (relative to project root) to `repo-groups.yaml` |
| `pr_target` | `string` | Default PR target branch for all repos (e.g., `qa`) |
| `link_type` | `symlink \| worktree` | How to include a repo (default: `worktree`) |
| `readonly` | `boolean` | If `true`, agent should not commit to this repo |

### Per-Repo PR Target

Override the default `pr_target` for individual repos:

```yaml
repos:
  - name: api-service
    path: HS/api-service
    pr_target: main    # This repo targets 'main', others target 'qa'
```

---

## Repo Groups

Repo groups define logical collections of repositories that can be added to a workspace together.

### Creating repo-groups.yaml

Create `repo-groups.yaml` in your meta repo (version-controlled by the team):

```yaml
# repo-groups.yaml
groups:
  simphony:
    - int-micros-simphony
    - int-micros-simphony-api
    - micros-symphony-canonical-transform
    - micros-symphony-job-importschedule
    - micros-symphony-raw-job
  aloha:
    - int-aloha
    - int-aloha-hrbridge
    - aloha-agent-canonical-transfer
    - aloha-agent-nrt-canonical-transfer
  agent-infra:
    - agent-service
    - agent-cli
    - agent-installer
  shared-lib:
    - int-aws-hs-service
    - int-aws-store-config-labels
  canonical:
    - int-canonical-to-hs
    - int-canonical-to-fourth
  # Individual providers
  toast: [int-toast]
  brink: [int-brink]
  square: [int-square]
  all: "*"   # Special: includes every repo
```

### Using Groups

Add repos to your workspace by group:

```bash
# Add all repos in the 'simphony' group
pan workspace add-repo my-issue --group simphony

# Add all repos
pan workspace add-repo my-issue --group all
```

---

## Adding Repos Mid-Work

### Command Reference

```bash
pan workspace add-repo <workspace-id> <repo-name> [repo-name...]
pan workspace add-repo <workspace-id> --group <group-name>
```

### Examples

```bash
# Add specific repos
pan workspace add-repo int-123 int-provider-a int-canonical-to-hs

# Add a named group
pan workspace add-repo int-123 --group simphony

# Add all repos
pan workspace add-repo int-123 --group all
```

### How It Works

1. Find the workspace and project config
2. Resolve repo names (expand groups if `--group` specified)
3. Filter out repos already in the workspace
4. Create worktrees for each new repo
5. Done — new repos are ready to use

### After Adding Repos

New repos appear as subdirectories in the workspace with feature branches ready. Run git commands inside each repo subdirectory.

---

## Symlink Behavior for Meta Repos

When `link_type: symlink` is set on a repo:

- Creates a symlink to the repo directory (no git worktree, no feature branch)
- The symlink always reflects the latest state of the actual repo
- The `readonly: true` flag tells the agent not to commit changes

### Workspace CLAUDE.md Note

The generated workspace `.claude/CLAUDE.md` includes a note about readonly repos:

```markdown
## Readonly Repos
The following repos are symlinked for reference only — do NOT commit changes to them:
- meta/ — shared skills and architecture docs
```

---

## Migration from Standard Polyrepo

If you have an existing polyrepo project and want to switch to progressive mode:

1. **Add the `progressive: true` flag** to your workspace config
2. **Create `repo-groups.yaml`** in your meta repo
3. **Add `always_include`** with repos that should always be available
4. **Update repo configs** for meta repos with `link_type: symlink` and `readonly: true`
5. **Test workspace creation** with a new issue

### Example Migration

Before:
```yaml
workspace:
  type: polyrepo
  repos:
    - name: meta
      path: team-meta
    - name: api-service
      path: HS/api-service
```

After:
```yaml
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
```

---

## Full Example Config

```yaml
# ~/.panopticon/projects.yaml
enterprise-integration:
  name: "Enterprise Integration"
  path: /home/user/Projects/EnterpriseIntegration
  issue_prefix: INT
  tracker: rally
  rally_project: "Integration Team"
  shadow:
    enabled: true
    trackers:
      rally: true
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
      - name: int-provider-b
        path: HS/int-provider-b
        default_branch: main
      - name: int-canonical-to-hs
        path: Integration/canonical/int-canonical-to-hs
      - name: int-canonical-to-fourth
        path: Integration/canonical/int-canonical-to-fourth
      - name: int-toast
        path: Providers/toast/int-toast
      - name: int-brink
        path: Providers/brink/int-brink
      - name: int-square
        path: Providers/square/int-square
  specialists:
    merge: false
```

---

## Agent Context

When an agent works in a progressive workspace, it receives context that includes:

- **Which repos are currently in the workspace**
- **How to add more repos** (via `/workspace-add-repo` skill)
- **Which repos are readonly** (symlinked meta repos)
- **Where to find `repo-map.md` and `repo-groups.yaml`** for architecture context
- **The `pr_target` branch** for each repo

---

## See Also

- [Setup Wizard](./setup-wizard.md) — Interactive project setup with progressive polyrepo template
- [Meta Repos](./meta-repos.md) — Meta repo pattern and structure
- [Issue Trackers](./issue-trackers.md) — Rally and other tracker configuration
