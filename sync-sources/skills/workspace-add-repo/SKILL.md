---
name: workspace-add-repo
description: Add repositories to the current progressive polyrepo workspace
---

# Add Repos to Workspace

Use this when you need to work on repos that aren't in the workspace yet.

## Usage

Run from the workspace root:

```bash
pan workspace add-repo <workspace-id> <repo-name> [repo-name...]
pan workspace add-repo <workspace-id> --group <group-name>
pan workspace add-repo <workspace-id> --new <git-url>
```

Examples:

```bash
# Add specific repos
pan workspace add-repo int-123 int-provider-a int-canonical-to-hs

# Add a named group
pan workspace add-repo int-123 --group simphony

# Add all configured repos
pan workspace add-repo int-123 --group all

# Register a repo created as part of this issue
pan workspace add-repo int-123 --new git@github.com:acme/new-service.git
```

## How to decide which repos you need

1. Read `repo-map.md` in the meta repo for architecture and repo descriptions
2. Read `repo-groups.yaml` for available groups
3. Add only the repos you need — you can always add more later

## After adding repos

The new repos appear as subdirectories in the workspace with feature branches ready.
Run git commands inside each repo subdirectory.

## New deliverable repositories

Run `--new <git-url>` before cloning or committing in a repository created during the issue. Overdeck clones the project-level source repo, creates the issue feature worktree, and registers it so review, inspection, and merge include it.

If the repo name inferred from the URL is not suitable, pass the workspace directory name before `--new`:

```bash
pan workspace add-repo int-123 service --new git@github.com:acme/new-service.git
```

## Notes

- An unknown repo name without `--new` fails instead of silently reporting success
- Meta repos (symlinked) are readonly — do NOT commit changes to them
- Use `--dry-run` first to see what would be added without making changes
