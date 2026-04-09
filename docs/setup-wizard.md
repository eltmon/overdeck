# Project Setup Wizard

**Interactive CLI wizard for setting up new Panopticon projects with AI-assisted configuration.**

---

## Overview

The Setup Wizard (`pan setup`) guides users through complete project configuration, replacing manual YAML editing with an interactive flow that:

- Detects project structure automatically
- Recommends templates based on your codebase
- Asks targeted questions with sensible defaults
- Optionally spawns a Setup Agent for AI-assisted configuration
- Generates a complete `projects.yaml` entry

---

## Running the Wizard

```bash
pan setup
```

The wizard runs interactively in your terminal, asking questions and detecting your project structure as it goes.

---

## Wizard Flow

### Step 1: Project Location

```
Welcome to Panopticon Project Setup!

Step 1: Project Location
  Where is your project? [/home/user/Projects/MyProject]: _
  Scanning directory structure...
```

Panopticon scans the directory for git repositories and determines the project type.

### Step 2: Project Type Detection

```
Step 2: Project Type Detection
  Found: 31 git repositories in subdirectories
  Detected: Polyrepo (multiple independent git repos)

  Is this correct? [Y/n]: _
```

If the detection is wrong (e.g., it found repos that aren't part of your project), you can correct it.

### Step 3: Template Selection

```
Step 3: Template Selection
  Based on your project structure, recommended template:
  → progressive-polyrepo (30+ repos, team meta repo, progressive workspaces)

  Available templates:
    1. simple-app        — Single repo, standard branching
    2. monorepo          — One repo, multiple packages/services
    3. polyrepo          — 2-10 repos, all checked out per workspace
    4. progressive-polyrepo — 10+ repos, on-demand checkout
    5. custom            — Start from scratch

  Select template [4]: _
```

Templates provide sensible defaults for common project archetypes.

### Step 4: Repository Configuration

```
Step 4: Repository Configuration
  Scanning 31 repos for branch information...

  Default branch detected:
    - 17 repos use 'master'
    - 14 repos use 'main'

  PR target branch:
    What branch should PRs target? [main]: qa

  Would you like to organize repos into groups? [Y/n]: _
```

### Step 5: Issue Tracker

```
Step 5: Issue Tracker
  Which issue tracker does this project use?
    1. Linear
    2. GitHub Issues
    3. Rally
    4. GitLab Issues
    5. None / Manual

  Select [3]: _

  Rally artifact types to track [F,US,DE,TA]: _
  Rally project name: _
```

### Step 6: Meta Repo

```
Step 6: Meta Repo
  Progressive polyrepo projects use a meta repo for shared skills,
  architecture docs, and team conventions.

  Create a new meta repo? [Y/n]: _
  Meta repo name [team-meta]: _

  Would you like the Setup Agent to analyze your codebase and
  generate initial docs? [Y/n]: _

  [Spawning Setup Agent...]
```

### Step 7: Review & Save

```
Step 7: Review & Save
  Here's your configuration:
  [YAML preview]

  Save to ~/.panopticon/projects.yaml? [Y/n]: _

  Done! Next steps:
  - Run 'pan workspace create F29698' to test workspace creation
  - Review generated docs in team-meta/
  - Share team-meta/ with your team for onboarding
```

---

## Templates

Templates are pre-built configurations for common project archetypes.

### Available Templates

| Template | Use Case |
|----------|----------|
| `simple-app` | Single repo, standard branching |
| `monorepo` | One repo, multiple packages/services |
| `polyrepo` | 2-10 repos, all checked out per workspace |
| `progressive-polyrepo` | 10+ repos, on-demand checkout |

### Template Structure

```
templates/project-types/
├── simple-app/
│   ├── template.yaml          # Template metadata + defaults
│   └── agent-template/        # .claude/ skeleton
├── monorepo/
│   ├── template.yaml
│   └── agent-template/
├── polyrepo/
│   ├── template.yaml
│   └── agent-template/
└── progressive-polyrepo/
    ├── template.yaml
    ├── agent-template/
    │   └── .claude/
    └── meta-repo-scaffold/    # Skeleton for the meta repo
```

### Template Customization

Templates include prompts that ask for project-specific values:

```yaml
# Example template.yaml
name: progressive-polyrepo
description: Large-scale polyrepo with 10+ repos

defaults:
  workspace:
    type: polyrepo
    progressive: true

prompts:
  - key: pr_target
    question: "What branch should PRs target?"
    default: main
  - key: create_meta
    question: "Create a meta repo for shared skills and docs?"
    default: true
```

---

## Setup Agent

The Setup Agent is an AI agent that explores your codebase to generate configuration files.

### What It Does

1. **Explores the codebase** — Reads READMEs, package.json files, CI configs
2. **Detects conventions** — Branch naming, PR conventions, code style
3. **Generates CLAUDE.md** — Project-specific conventions for AI agents
4. **Generates repo-map.md** — Maps each repo's purpose and relationships
5. **Generates repo-groups.yaml** — Logical groupings based on naming patterns
6. **Generates onboarding checklist** — Prerequisites and setup steps

### When to Use It

Use the Setup Agent when:
- You have a large codebase (10+ repos)
- You want AI assistance documenting your architecture
- You're setting up a new team and want automated onboarding docs

### Setup Agent Output

The agent writes to your meta repo:
- `.agent-template/.claude/CLAUDE.md` — Project conventions
- `docs/repo-map.md` — Repository map
- `panopticon/repo-groups.yaml` — Repo groupings
- `docs/onboarding/checklist.md` — Onboarding steps

---

## Creating Custom Templates

1. Create a directory in `templates/project-types/your-template/`
2. Add `template.yaml` with metadata and defaults
3. Add `agent-template/` with `.claude/` skeleton
4. The wizard will automatically detect your template

### Example template.yaml

```yaml
name: your-template
description: Your project type description

recommended_when:
  min_repos: 5
  has_ci: true

defaults:
  workspace:
    type: polyrepo
    progressive: true
  specialists:
    merge: false

prompts:
  - key: ci_branch
    question: "What branch does CI run against?"
    default: main
```

---

## Meta Repo Creation

The wizard can create a meta repo scaffold for progressive polyrepo projects:

```
templates/project-types/progressive-polyrepo/meta-repo-scaffold/
├── .agent-template/
│   └── .claude/
│       ├── CLAUDE.md
│       └── skills/
├── panopticon/
│   └── repo-groups.yaml
├── docs/
│   ├── repo-map.md
│   ├── architecture.md
│   └── onboarding/
│       ├── checklist.md
│       ├── machine-setup.sh
│       └── README.md
└── README.md
```

---

## Team Onboarding Kit

The meta repo supports team onboarding:

1. Clone the meta repo
2. Run `machine-setup.sh` (installs prerequisites, clones repos)
3. Run `pan setup` (detects existing repos, applies team's template)
4. Ready to work

---

## See Also

- [Progressive Polyrepo](./progressive-polyrepo.md) — Detailed progressive workspace guide
- [Meta Repos](./meta-repos.md) — Meta repo pattern and structure
- [Issue Trackers](./issue-trackers.md) — Tracker configuration including Rally
