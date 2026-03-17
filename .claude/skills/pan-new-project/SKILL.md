---
name: pan-new-project
description: >
  Complete setup for registering a new project with Panopticon. Handles
  project registration, issue prefix, workspace config, trust setup,
  and validates against working project configurations.
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
version: "1.0.0"
author: "Ed Becker"
license: "MIT"
---

# New Project Setup

**Trigger:** `/pan-new-project`

Sets up a new project for Panopticon management. Ensures all required
configuration is in place so workspaces, planning agents, and work agents
function correctly from the start.

---

## WHY THIS SKILL EXISTS

Running `pan project add /path --name foo` only creates a minimal entry in
`projects.yaml`. Without the full configuration, critical features break:

- **No `linear_team`** → `resolveProjectFromIssue()` can't map issue prefixes
  to the project → planning agents start in `$HOME` instead of the project root
- **No trust entry** → Claude Code shows "Quick safety check" trust dialog,
  blocking autonomous agents
- **No workspace config** → `pan workspace create` may fail or use wrong defaults
- **No test config** → specialist test agents can't run tests

---

## EXECUTION STEPS

### Step 1: Gather Project Information

Ask the user for (or detect from the filesystem):

| Field | Required | Example | Notes |
|-------|----------|---------|-------|
| Path | Yes | `/home/eltmon/Projects/myapp` | Must exist, must have `.git/` |
| Name | Yes | `myapp` | Short lowercase identifier |
| Issue prefix | Yes | `APP` | Maps `APP-123` → this project. Goes in `linear_team` field |
| Tracker | Yes | `github` or `linear` or `gitlab` | Where issues live |
| Repo | Yes | `owner/repo` | `github_repo` or `gitlab_repo` |
| Workspace type | Yes | `standalone`, `monorepo`, or `polyrepo` | How git worktrees work |
| Language/stack | Auto-detect | Go, TypeScript, Java, Python | Determines test commands |

**Auto-detection hints:**
- `go.mod` → Go project, `make test` or `go test ./...`
- `package.json` → Node/TypeScript, `npm test` or `pnpm test`
- `pom.xml` / `mvnw` → Java/Maven, `./mvnw test`
- `Cargo.toml` → Rust, `cargo test`
- `pyproject.toml` / `setup.py` → Python, `pytest`

### Step 2: Register Project

```bash
pan project add <path> --name <name>
```

### Step 3: Configure projects.yaml

Edit `~/.panopticon/projects.yaml` to add the FULL configuration.

**Minimum viable config** (compare against working projects):

```yaml
  <project-key>:
    name: <name>
    path: <absolute-path>
    linear_team: <PREFIX>          # CRITICAL: issue prefix for routing
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
    linear_team: <PREFIX>
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

### Step 4: Pre-trust Directory

The project directory AND any workspace directories must be pre-trusted in
Claude Code's `~/.claude.json` to avoid the trust dialog blocking agents.

```bash
# This is done automatically by `pan project add` (after our fix),
# but verify it's there:
node -e "
const data = JSON.parse(require('fs').readFileSync(
  require('path').join(require('os').homedir(), '.claude.json'), 'utf8'));
const p = '<project-path>';
console.log(p, '→', data.projects?.[p]?.hasTrustDialogAccepted ? 'TRUSTED' : 'NOT TRUSTED');
"
```

If not trusted, add it:
```bash
node -e "
const fs = require('fs'), path = require('path'), os = require('os');
const f = path.join(os.homedir(), '.claude.json');
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
if (!d.projects) d.projects = {};
d.projects['<project-path>'] = {
  allowedTools: [], mcpContextUris: [], mcpServers: {},
  enabledMcpjsonServers: [], disabledMcpjsonServers: [],
  hasTrustDialogAccepted: true, projectOnboardingSeenCount: 0,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
};
fs.writeFileSync(f, JSON.stringify(d, null, 2), 'utf8');
console.log('Trusted:', '<project-path>');
"
```

### Step 5: Create CLAUDE.md (if missing)

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

### Step 6: Create workspaces/ Directory

```bash
mkdir -p <project-path>/workspaces
echo "workspaces/" >> <project-path>/.gitignore  # if not already there
```

### Step 7: Validate Configuration

Run these checks:

```bash
# 1. Project is registered
pan project list | grep <name>

# 2. Issue prefix resolves correctly
# (Try creating a workspace — dry run)
pan workspace create <PREFIX>-999 --dry-run 2>&1 || true

# 3. Trust is set
node -e "const d=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude.json','utf8')); console.log(d.projects?.['<path>']?.hasTrustDialogAccepted ? 'OK' : 'MISSING')"

# 4. Git is clean
cd <path> && git status --short
```

### Step 8: Summary

Print a summary of what was configured:

```
## New Project Setup Complete: <NAME>

Path:           <path>
Issue prefix:   <PREFIX> (e.g., <PREFIX>-1, <PREFIX>-42)
Tracker:        GitHub (<owner/repo>)
Workspace type: <type>
Tests:          <command>
Trusted:        Yes

Next steps:
  1. Create issues on <tracker>
  2. Run: pan opus-plan <PREFIX>-<N>  (plan with Opus)
  3. Run: pan work issue <PREFIX>-<N> (spawn implementation agent)
```

---

## REFERENCE: Working Project Configs

For comparison, here are the key fields from existing working projects:

### panopticon-cli (monorepo, GitHub)
- `linear_team: PAN`
- `github_repo: eltmon/panopticon-cli`
- `workspace.type: monorepo`
- Has: dns, docker, agent, services, env, tests

### mind-your-now (polyrepo, GitLab)
- `linear_team: MIN`
- `gitlab_repo: eltmon/mind-your-now`
- `workspace.type: polyrepo` with 6 sub-repos
- Has: dns, docker, database, agent, services, tunnel, hume, env, tests

### myn-cli (standalone, GitHub)
- `linear_team: CLI`
- `github_repo: mindyournow/myn-cli`
- `workspace.type: standalone`
- Has: tests

---

## COMMON MISTAKES

1. **Missing `linear_team`** — The #1 cause of "planning agent starts in $HOME."
   Despite the name, this field is the issue PREFIX for ALL trackers, not just Linear.
2. **Not pre-trusting the directory** — Agent gets stuck on Claude Code trust dialog.
3. **Wrong `workspace.type`** — `standalone` = single repo, `monorepo` = one repo with
   worktrees, `polyrepo` = multiple repos under one parent dir.
4. **Missing `workspaces/` directory** — Git worktree creation fails.
5. **Missing `.gitignore` entry** — `workspaces/` gets committed accidentally.
