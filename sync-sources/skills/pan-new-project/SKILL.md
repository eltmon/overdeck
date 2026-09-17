---
name: pan-new-project
description: >
  Complete setup for registering a new project with Overdeck. Handles
  project registration, issue prefix, workspace config, trust setup,
  xBRIEF task support init, tracker config, and validates against working projects.
  Three entry points: CLI (pan project clone/add/new), dashboard (/projects/new),
  and workspace-page chips for quick registration.
triggers:
  - new project
  - add new project
  - register new project
  - setup new project
  - onboard project
  - pan new project
  - create a project
  - clone a repository
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

**Triggers:** `/pan-new-project`, or start from dashboard at `/projects/new`

Sets up a new project for Overdeck management. This is the ONLY correct
way to add a new project. Registration itself is no longer the risky part —
since PAN-3836 `pan project clone` and `pan project add` detect the remote,
tracker, default branch and prefix and create the main workspace. What still
needs this skill is everything registration cannot know: tests, quality gates,
tracker integration, and any deliberate override of a detected value.

Users can register projects three ways:
1. **CLI:** `pan project clone <url>` or `pan project add <path>` (both take
   `--dry-run`); `pan project finish-setup <key>` repairs one that stopped
   partway
2. **Dashboard:** Navigate to `/projects/new` (via sidebar `+`, workspace-page chips, or HomePage button)
3. **Workspace page:** Click "clone repo", "add existing", or "new project" chips

---

## DASHBOARD FLOW

The dashboard at `/projects/new` (PAN-3836) offers three tabs for project registration, each with inline resolve-before-create preview:

**Clone Repository**
- Paste a git URL (GitHub, GitLab, Bitbucket, or any git remote)
- Dashboard resolves: detects remote provider, fetches default branch, proposes issue_prefix based on repo name
- Shows findings inline (validation errors, warnings)
- Confirm to clone into Overdeck and register

**Add Existing**
- Select a local directory containing a git repository
- Dashboard detects remote, default branch, proposes issue_prefix
- Confirm to register without cloning

**New Project**
- Specify a project name and parent directory
- Dashboard initializes a new git repository there
- Confirm to init and register

All three modes:
- Return 202 {jobId} for long-running clones, supporting polling via GET /api/projects/create-jobs/:jobId
- Display `findings` inline (e.g. "remote unreachable", "already registered")
- Auto-create the main workspace on success
- Integrate with the same `resolveProjectCreateIntent` / `performProjectCreate` core as CLI

For details, see [docs/WORKSPACES-AND-PROJECTS.md](docs/WORKSPACES-AND-PROJECTS.md) "Creating a project".

---

## WHY THIS SKILL EXISTS

Since PAN-3836, `pan project clone <url>` and `pan project add <path>` do the
structural work themselves: they detect the remote, tracker, repo slug and
default branch, propose an `issue_prefix`, pre-trust the directory, add the
workspaces directory to `.git/info/exclude`, and create the main workspace.

What registration still cannot know is what the operator wants. These remain
manual, and skipping them causes real failures:

| Missing config | Symptom |
|----------------|---------|
| Test config | Specialist test agents can't run tests |
| Quality gates | Verification cannot tell a green branch from a red one |
| `GITHUB_REPOS` entry | Issues don't appear on the dashboard kanban board |
| Deliberate overrides (prefix, tracker, default branch) | Detection's proposal ships instead of the operator's choice |

---

## EXECUTION STEPS

### Step 1: Gather Project Information

Ask the user for (or auto-detect from the filesystem):

| Field | Required | Example | Notes |
|-------|----------|---------|-------|
| Path | Yes | `~/Projects/myapp` | Must exist, must have `.git/` |
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

### Step 2: Register the Project

For a repository that is not on this machine yet:

```bash
pan project clone <url> [--parent <dir>] [--name <name>] [--issue-prefix <PREFIX>]
```

For a directory that already exists:

```bash
pan project add <path> [--name <name>]
```

Both resolve through the same core, so they behave identically: they detect the
`origin` remote, set `tracker` and `github_repo`/`gitlab_repo`, carry the
repository's `default_branch`, propose an `issue_prefix`, pre-trust the
directory in `~/.claude.json`, add the workspaces directory to
`.git/info/exclude`, and create the main workspace row.

Add `--dry-run` to either to print the resolved intent as JSON and write
nothing — useful for confirming the destination and detected identity first:

```bash
pan project clone acme/widget --dry-run | jq '{key, path, repoSlug, defaultBranch}'
```

Credentials are never echoed: the dry-run document redacts any userinfo in the
URL. Clones run non-interactively (`GIT_TERMINAL_PROMPT=0`,
`ssh -o BatchMode=yes`), so a private repository needs credentials already
available on **this server** — an SSH key loaded in its agent, or a configured
credential helper. A missing one fails fast with a typed message instead of
hanging on a prompt nobody can see.

If creation stops after registration (for example the main workspace could not
be created), the project is registered and the repository is on disk. Do **not**
clone again — repair it:

```bash
pan project finish-setup <key>
```

That command is idempotent: it never clones and never registers a second
project, so it is safe to re-run.

### Step 3: Add what registration cannot detect

Registration has already written `name`, `path`, `tracker`,
`github_repo`/`gitlab_repo`, `issue_prefix` and `workspace.default_branch`.
Read the entry first — `pan project show <key>` — and only add what is missing.

Tests and quality gates are **not** auto-discovered; they are the main reason to
edit `~/.overdeck/projects.yaml` by hand. Override a detected value only when
the operator wants something different from what the remote says.

```yaml
  <project-key>:
    # name / path / tracker / github_repo / issue_prefix / default_branch:
    # already written by registration — override only on purpose.
    workspace:
      type: <standalone|monorepo|polyrepo>
      workspaces_dir: workspaces
    tests:
      unit:
        type: <go|vitest|maven|pytest|cargo>
        path: .
        command: <test command>
    quality_gates:
      typecheck:
        command: <typecheck command>
        required: true
      lint:
        command: <lint command>
        required: true
      test:
        # Keep this change-scoped and fast; e2e/Playwright belongs in CI-only or @slow tiers.
        command: npx vitest run --changed {{CHANGED_BASE}}
        required: true
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
    quality_gates:
      typecheck:
        command: <cmd>
        required: true
      lint:
        command: <cmd>
        required: true
      test:
        command: npx vitest run --changed {{CHANGED_BASE}}
        required: true
```

### Step 4: Add to Dashboard Tracker Config

For **GitHub** projects, add to `GITHUB_REPOS` in `~/.overdeck.env`:

```bash
# Format: owner/repo:PREFIX (comma-separated)
# Example: current value might be:
#   GITHUB_REPOS=eltmon/overdeck:PAN
# Append the new project:
#   GITHUB_REPOS=eltmon/overdeck:PAN,owner/newrepo:APP
```

Read current value, append new repo, write back. The dashboard polls this
to fetch issues from GitHub.

For **Linear** projects, issues are fetched automatically by team — no
extra config needed beyond `issue_prefix` in projects.yaml.

For **GitLab** projects, TBD — not yet supported in dashboard polling.

### Step 5: Verify xBRIEF Task Support

No per-project task database initialization is required. xBRIEF plan items become the executable checklist after planning, and `pan task` reads and updates their state through the canonical state door.

```bash
pan task --help >/dev/null && echo "PASS: pan task available"
```

### Step 6 (optional): Workspaces directory and exclusion

Registration already adds the workspaces directory to
`<project-path>/.git/info/exclude`, which is local and untracked. That is
deliberate (D-8): Overdeck does not edit a repository's tracked `.gitignore`, so
a freshly cloned project never comes back dirty.

Only do something here if the operator wants the exclusion **shared with the
team**, in which case they add `workspaces/` to the tracked `.gitignore`
themselves and commit it. The directory itself is created on demand when the
first workspace is made.

### Step 7: Create the Overdeck project context (if missing)

Check `<project-path>/.overdeck/context/project.md`. If absent, create a minimal project layer there. Preserve native `CLAUDE.md` and `AGENTS.md` files.

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
grep 'GITHUB_REPOS' ~/.overdeck.env | grep -q '<PREFIX>' && \
  echo "PASS: in GITHUB_REPOS" || echo "FAIL: not in GITHUB_REPOS"

# 5. xBRIEF task command available
pan task --help >/dev/null && echo "PASS" || echo "FAIL: pan task unavailable"

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
xBRIEF task support:   Available through pan task
Dashboard:      Issues visible

Validation: 8/8 checks passed

Next steps:
  1. Create issues on <tracker>
  2. Run: pan plan <PREFIX>-<N>  (plan with Opus)
  3. Run: pan start <PREFIX>-<N> (spawn implementation agent)
```

---

## REFERENCE: Working Project Configs

### overdeck (monorepo, GitHub)
- `issue_prefix: PAN`, `github_repo: eltmon/overdeck`
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
4. **Not pre-trusting the directory** — Agent gets stuck on trust dialog.
5. **Wrong `workspace.type`** — `standalone` = single repo, `monorepo` = one repo with
   worktrees, `polyrepo` = multiple repos under one parent dir.
6. **Missing `workspaces/` directory** — Git worktree creation fails.
7. **Missing `.gitignore` entry** — `workspaces/` gets committed accidentally.
8. **Full-suite per-change gates** — `quality_gates.test` should use changed-file
   scoping such as `npx vitest run --changed {{CHANGED_BASE}}`. Put Playwright,
   e2e, and other heavy suites in CI-only or `@slow` tiers so unrelated red tests
   do not block every work agent.
