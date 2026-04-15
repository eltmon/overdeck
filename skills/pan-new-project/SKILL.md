---
name: pan-new-project
audience: operator
description: >
  Complete setup for registering a new project with Panopticon. Handles
  project registration, issue prefix, workspace config, trust setup,
  beads init, tracker config, and validates against working projects.
triggers:
  - new project
  - add new project
  - register new project
  - setup new project
  - onboard project
  - pan new project
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
version: "2.0.0"
author: "Ed Becker"
license: "MIT"
---

# New Project Setup

**Trigger:** `/pan-new-project`

Sets up a new project for Panopticon management. This is the ONLY correct
way to add a new project. Do NOT just run `pan project add` alone — it
creates a skeleton entry that breaks planning agents, workspace creation,
issue routing, and beads.

---

## WHY THIS SKILL EXISTS

Running `pan project add /path --name foo` alone causes these failures:

| Missing config | Symptom |
|----------------|---------|
| `issue_prefix` (issue prefix) | Planning agents start in `$HOME`, not the project root |
| Trust entry in `~/.claude.json` | Claude Code shows trust dialog, blocking autonomous agents |
| `GITHUB_REPOS` entry | Issues don't appear on the dashboard kanban board |
| `beads.role` in git config | Every `bd` command prints "beads.role not configured" warnings |
| `workspaces/` directory | Git worktree creation fails |
| `.gitignore` entry | `workspaces/` gets committed accidentally |
| Test config | Specialist test agents can't run tests |

---

## EXECUTION STEPS

### Step 1: Gather Project Information

Ask the user for (or auto-detect from the filesystem):

| Field | Required | Example | Notes |
|-------|----------|---------|-------|
| Path | Yes | `/home/eltmon/Projects/myapp` | Must exist, must have `.git/` |
| Name | Yes | `myapp` | Short lowercase key for projects.yaml |
| Issue prefix | Yes | `APP` | Maps `APP-123` → this project. Goes in `issue_prefix` field |
| Tracker | Yes | `github` / `linear` / `gitlab` | Where issues live |
| Repo slug | Yes | `owner/repo` | `github_repo` or `gitlab_repo` |
| Workspace type | Yes | `standalone` / `monorepo` / `polyrepo` | How git worktrees work |

**Auto-detection:**
- `go.mod` → Go, test: `make test` or `go test ./...`
- `package.json` → Node/TS, test: `npm test` or `pnpm test`
- `pom.xml` / `mvnw` → Java/Maven, test: `./mvnw test`
- `Cargo.toml` → Rust, test: `cargo test`
- `pyproject.toml` → Python, test: `pytest`

### Step 2: Register Project

```bash
pan project add <path> --name <name>
```

This creates a minimal entry AND pre-trusts the directory in `~/.claude.json`
(the `projectAddCommand` calls `preTrustDirectory` automatically).

### Step 3: Configure projects.yaml

Edit `~/.panopticon/projects.yaml` to add the FULL configuration.

**Minimum viable config:**

```yaml
  <project-key>:
    name: <name>
    path: <absolute-path>
    issue_prefix: <PREFIX>          # CRITICAL: issue prefix for routing
    github_repo: <owner/repo>     # or gitlab_repo
    workspace:
      type: <standalone|monorepo|polyrepo>
      workspaces_dir: workspaces
      default_branch: main
    tests:
      unit:
        type: <go|vitest|maven|pytest|cargo>
        path: .
        command: <test command>
```

**Full config** (for projects with services, Docker, DNS):

```yaml
  <project-key>:
    name: <name>
    path: <absolute-path>
    issue_prefix: <PREFIX>
    github_repo: <owner/repo>
    workspace:
      type: <type>
      workspaces_dir: workspaces
      default_branch: main
      dns:
        domain: <name>.localhost
        entries:
          - "{{FEATURE_FOLDER}}.{{DOMAIN}}"
        sync_method: hosts_file
      docker:
        traefik: templates/traefik
        compose_template: infra/.devcontainer-template
      agent:
        template_dir: infra/.agent-template
        copy_dirs:
          - .claude/commands
          - .claude/skills
      services:
        - name: <service>
          path: .
          start_command: <cmd>
          health_url: <url>
          port: <port>
      env:
        secrets_file: ~/.myapp/.env
    tests:
      unit:
        type: <type>
        path: .
        command: <cmd>
```

### Step 4: Add to Dashboard Tracker Config

For **GitHub** projects, add to `GITHUB_REPOS` in `~/.panopticon.env`:

```bash
# Format: owner/repo:PREFIX (comma-separated)
# Example: current value might be:
#   GITHUB_REPOS=eltmon/panopticon-cli:PAN
# Append the new project:
#   GITHUB_REPOS=eltmon/panopticon-cli:PAN,owner/newrepo:APP
```

Read current value, append new repo, write back. The dashboard polls this
to fetch issues from GitHub.

For **Linear** projects, issues are fetched automatically by team — no
extra config needed beyond `issue_prefix` in projects.yaml.

For **GitLab** projects, TBD — not yet supported in dashboard polling.

### Step 5: Initialize Beads

```bash
cd <project-path>
git config beads.role agent
```

This prevents the `"beads.role not configured"` warning on every `bd` command.
New worktrees inherit this automatically since Panopticon now sets it during
workspace creation (`workspace-manager.ts` and `worktree.ts`).

### Step 6: Create workspaces/ Directory

```bash
mkdir -p <project-path>/workspaces
```

Check `.gitignore` — add `workspaces/` if not already there:
```bash
grep -q '^workspaces/' <project-path>/.gitignore 2>/dev/null || \
  echo 'workspaces/' >> <project-path>/.gitignore
```

### Step 7: Create CLAUDE.md (if missing)

Check if the project has a `CLAUDE.md`. If not, create a minimal one:

```markdown
# <Project Name>

## Project Overview
<Brief description>

## Stack
<Language, framework, key dependencies>

## Development
<How to build, run, test>

## Testing
<Test commands, coverage requirements>
```

### Step 8: Validate Configuration

Run ALL of these checks and report pass/fail:

```bash
# 1. Project registered
pan project list | grep <name>

# 2. Issue prefix resolves (won't crash)
# Check projects.yaml has issue_prefix: <PREFIX>

# 3. Trust is set in ~/.claude.json
node -e "
const d=JSON.parse(require('fs').readFileSync(
  require('os').homedir()+'/.claude.json','utf8'));
console.log(d.projects?.['<path>']?.hasTrustDialogAccepted
  ? 'PASS: trusted' : 'FAIL: not trusted');
"

# 4. Dashboard can see issues (GitHub only)
grep 'GITHUB_REPOS' ~/.panopticon.env | grep -q '<PREFIX>' && \
  echo "PASS: in GITHUB_REPOS" || echo "FAIL: not in GITHUB_REPOS"

# 5. Beads configured
cd <path> && git config beads.role && echo "PASS" || echo "FAIL: beads.role not set"

# 6. workspaces/ exists
test -d <path>/workspaces && echo "PASS" || echo "FAIL: no workspaces/"

# 7. workspaces/ in .gitignore
grep -q 'workspaces' <path>/.gitignore 2>/dev/null && \
  echo "PASS" || echo "FAIL: workspaces/ not in .gitignore"

# 8. CLAUDE.md exists
test -f <path>/CLAUDE.md && echo "PASS" || echo "WARN: no CLAUDE.md"

# 9. Git clean
cd <path> && git status --short | head -5
```

### Step 9: Summary

```
## New Project Setup Complete: <NAME>

Path:           <path>
Issue prefix:   <PREFIX> (e.g., <PREFIX>-1, <PREFIX>-42)
Tracker:        GitHub (<owner/repo>)
Workspace type: <type>
Tests:          <command>
Trusted:        Yes
Beads:          Configured
Dashboard:      Issues visible

Validation: 8/8 checks passed

Next steps:
  1. Create issues on <tracker>
  2. Run: pan plan <PREFIX>-<N>  (plan with Opus)
  3. Run: pan start <PREFIX>-<N> (spawn implementation agent)
```

---

## REFERENCE: Working Project Configs

### panopticon-cli (monorepo, GitHub)
- `issue_prefix: PAN`, `github_repo: eltmon/panopticon-cli`
- `workspace.type: monorepo`
- Has: dns, docker, agent, services, env, tests

### mind-your-now (polyrepo, Linear/GitLab)
- `issue_prefix: MIN`, `gitlab_repo: eltmon/mind-your-now`
- `workspace.type: polyrepo` with 6 sub-repos
- Has: dns, docker, database, agent, services, tunnel, hume, env, tests

### myn-cli (standalone, GitHub)
- `issue_prefix: CLI`, `github_repo: mindyournow/myn-cli`
- `workspace.type: standalone`
- Has: tests

---

## COMMON MISTAKES

1. **Missing `issue_prefix`** — The #1 cause of "planning agent starts in $HOME."
   Despite the name, this field is the issue PREFIX for ALL trackers, not just Linear.
2. **Not in `GITHUB_REPOS`** — Issues don't appear on dashboard kanban board.
3. **No `beads.role`** — Every `bd` command prints warning noise in agent output.
4. **Not pre-trusting the directory** — Agent gets stuck on trust dialog.
5. **Wrong `workspace.type`** — `standalone` = single repo, `monorepo` = one repo with
   worktrees, `polyrepo` = multiple repos under one parent dir.
6. **Missing `workspaces/` directory** — Git worktree creation fails.
7. **Missing `.gitignore` entry** — `workspaces/` gets committed accidentally.
