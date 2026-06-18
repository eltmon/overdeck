# Project Setup Wizard, Templates, and Setup Agent

## Problem

Onboarding a new project into Overdeck requires manually editing `~/.overdeck/projects.yaml` with detailed YAML configuration — workspace type, repo paths, branch names, tracker settings, quality gates, DNS, Docker, and more. This is:

1. **Error-prone**: YAML indentation, field names, and path references are easy to get wrong. A typo in a repo path silently breaks workspace creation.
2. **Undiscoverable**: Users must read documentation to learn what fields exist. There's no guidance on which fields are relevant for their project type.
3. **Repetitive**: Many projects follow common patterns (Node.js Lambda microservices, React+Spring Boot fullstack, monorepo with workspaces). These patterns have known-good defaults that shouldn't need manual specification.
4. **No onboarding kit**: When a team adopts Overdeck, there's no mechanism to help team members set up their machines — clone the right repos, install prerequisites, configure API keys.

The current `pan project add` command (in `src/cli/commands/project.ts`) does basic detection (monorepo vs polyrepo, Linear team prefix) and writes a minimal `projects.yaml` entry, but doesn't configure workspaces, services, quality gates, or any of the advanced features that make Overdeck useful.

## Decision

Build a **Project Setup Wizard** (`pan setup`) that interactively guides users through complete project configuration, with AI assistance from a **Setup Agent** for codebase-aware decisions.

Introduce **project templates** as reusable starting points for common project archetypes, and make **meta repos** a first-class concept with built-in support for team onboarding kits.

---

## Architecture

### Overview

The setup wizard has three layers:

1. **Interactive CLI Wizard** — guided prompts that walk users through project config
2. **Project Templates** — pre-built config archetypes with sensible defaults
3. **Setup Agent** — AI agent that explores the codebase to detect conventions, generate CLAUDE.md, and populate meta repos

### 1. Interactive CLI Wizard (`pan setup`)

**New CLI command: `pan setup`**

Replaces the minimal `pan project add` with a comprehensive setup flow. The wizard asks questions, detects project structure, applies templates, and optionally spawns a Setup Agent for AI-assisted configuration.

**Flow:**

```
$ pan setup

Welcome to Overdeck Project Setup!

Step 1: Project Location
  Where is your project? [/home/user/Projects/MyProject]: _
  Scanning directory structure...

Step 2: Project Type Detection
  Found: 31 git repositories in subdirectories
  Detected: Polyrepo (multiple independent git repos)
  
  Is this correct? [Y/n]: _

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

Step 4: Repository Configuration
  Scanning 31 repos for branch information...
  
  Default branch detected:
    - 17 repos use 'master'
    - 14 repos use 'main'
  
  PR target branch:
    What branch should PRs target? [main]: qa
  
  Would you like to organize repos into groups? [Y/n]: _
  
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

Step 6: Meta Repo
  Progressive polyrepo projects use a meta repo for shared skills,
  architecture docs, and team conventions.
  
  Create a new meta repo? [Y/n]: _
  Meta repo name [team-meta]: _
  
  Would you like the Setup Agent to analyze your codebase and
  generate initial docs? [Y/n]: _
  
  [Spawning Setup Agent...]

Step 7: Review & Save
  Here's your configuration:
  [YAML preview]
  
  Save to ~/.overdeck/projects.yaml? [Y/n]: _
  
  Done! Next steps:
  - Run 'pan workspace create F29698' to test workspace creation
  - Review generated docs in team-meta/
  - Share team-meta/ with your team for onboarding
```

**Implementation: `src/cli/commands/setup.ts`**

The wizard is a new CLI command module. Key functions:

```typescript
interface SetupState {
  projectPath: string;
  projectName: string;
  projectType: 'simple-app' | 'monorepo' | 'polyrepo' | 'progressive-polyrepo';
  template?: string;
  repos: DetectedRepo[];
  tracker: TrackerType;
  trackerConfig: Record<string, any>;
  metaRepo?: MetaRepoConfig;
  workspace: Partial<WorkspaceConfig>;
  qualityGates: Record<string, QualityGateConfig>;
}

interface DetectedRepo {
  name: string;
  path: string;                    // relative to project root
  defaultBranch: string;           // detected from git
  hasQaBranch: boolean;            // detected from git
  hasTests: boolean;               // detected from package.json/pom.xml/etc
  hasLint: boolean;                // detected from config files
  hasCi: boolean;                  // detected from .github/workflows, etc
  language: string;                // detected from files
  packageManager?: string;         // npm/pnpm/bun/maven/gradle
}

interface MetaRepoConfig {
  name: string;
  createNew: boolean;              // true = create repo, false = use existing
  path: string;
  generateDocs: boolean;           // true = spawn Setup Agent
}
```

**Repo detection (`detectRepos()`):**

```typescript
async function detectRepos(projectPath: string): Promise<DetectedRepo[]> {
  const repos: DetectedRepo[] = [];
  
  // Scan subdirectories (up to 2 levels deep) for .git directories
  for (const entry of scanDirectories(projectPath, 2)) {
    if (!existsSync(join(entry, '.git'))) continue;
    
    const name = basename(entry);
    const relPath = relative(projectPath, entry);
    
    // Detect default branch
    const { stdout: head } = await execAsync(
      'git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo "refs/remotes/origin/main"',
      { cwd: entry }
    );
    const defaultBranch = head.trim().replace('refs/remotes/origin/', '');
    
    // Check for qa branch
    const { stdout: branches } = await execAsync('git branch -r --list', { cwd: entry });
    const hasQaBranch = branches.includes('origin/qa');
    
    // Detect language and tooling
    const hasPackageJson = existsSync(join(entry, 'package.json'));
    const hasPomXml = existsSync(join(entry, 'pom.xml'));
    const hasGoMod = existsSync(join(entry, 'go.mod'));
    
    // Detect tests
    const hasTests = hasPackageJson
      ? JSON.parse(readFileSync(join(entry, 'package.json'), 'utf-8')).scripts?.test != null
      : existsSync(join(entry, 'src/test'));
    
    // Detect CI
    const hasCi = existsSync(join(entry, '.github/workflows'))
      || existsSync(join(entry, '.gitlab-ci.yml'))
      || existsSync(join(entry, 'azure-pipelines.yml'));
    
    repos.push({ name, path: relPath, defaultBranch, hasQaBranch, hasTests, hasLint: false, hasCi, language: '...', packageManager: '...' });
  }
  
  return repos;
}
```

### 2. Project Templates

Templates are pre-built configurations for common project archetypes. They live in Overdeck's source at `templates/project-types/` and are bundled with the CLI.

**Template structure:**

```
templates/project-types/
├── simple-app/
│   ├── template.yaml          # Template metadata + defaults
│   └── agent-template/        # .claude/ skeleton
│       └── .claude/
│           ├── CLAUDE.md
│           └── skills/
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
    │       ├── CLAUDE.md
    │       └── skills/
    │           └── workspace-add-repo/
    └── meta-repo-scaffold/    # Skeleton for the meta repo
        ├── .agent-template/
        │   └── .claude/
        │       ├── CLAUDE.md   # Placeholder with sections to fill
        │       └── skills/
        ├── overdeck/
        │   └── repo-groups.yaml  # Placeholder
        ├── docs/
        │   ├── repo-map.md       # Placeholder
        │   ├── architecture.md   # Placeholder
        │   └── onboarding/
        │       ├── checklist.md      # Prerequisites checklist
        │       ├── machine-setup.sh  # Automated setup script
        │       └── README.md
        └── README.md
```

**`template.yaml` format:**

```yaml
name: progressive-polyrepo
description: Large-scale polyrepo with 10+ repos and progressive workspace creation
recommended_when:
  min_repos: 10
  has_meta_repo: true
  
defaults:
  workspace:
    type: polyrepo
    progressive: true
    workspaces_dir: workspaces
  specialists:
    merge: false
    
prompts:
  # Questions the wizard asks when this template is selected
  - key: pr_target
    question: "What branch should PRs target?"
    default: main
    type: string
  - key: create_meta
    question: "Create a meta repo for shared skills and docs?"
    default: true
    type: boolean
  - key: meta_name
    question: "Meta repo name?"
    default: "team-meta"
    type: string
    condition: create_meta == true
  - key: shadow_mode
    question: "Use shadow tracking (local state, don't modify issue tracker)?"
    default: false
    type: boolean
```

**Template application:**

When a user selects a template, the wizard:
1. Loads `template.yaml` defaults
2. Asks template-specific prompts
3. Merges answers into the config
4. If template has `meta-repo-scaffold/`, offers to create the meta repo from it
5. Applies `agent-template/` as the project's agent template

### 3. Setup Agent

A new agent type, like planning agents, specifically for project setup. Spawned optionally by the wizard to do AI-assisted codebase analysis.

**Agent type identifier:** `setup-agent`

**What the Setup Agent does:**

1. **Explores the codebase**: Reads READMEs, package.json files, CI configs, Terraform files across all repos
2. **Detects conventions**: Branch naming patterns, PR conventions, code style, test frameworks
3. **Generates CLAUDE.md**: Writes a project-specific CLAUDE.md with only non-obvious conventions (per user feedback: don't tell LLMs how to run `npm dev`, only document what's unusual)
4. **Generates repo-map.md**: Maps each repo's purpose, dependencies, and relationships
5. **Generates repo-groups.yaml**: Suggests logical groupings based on naming patterns and dependencies
6. **Generates onboarding checklist**: Lists prerequisites (CLI tools, API keys, access requirements)
7. **Reports findings**: Presents a summary for the user to review and approve

**Spawning (`src/lib/setup/spawn-setup-session.ts`):**

Modeled after `src/lib/planning/spawn-planning-session.ts`:

```typescript
export interface SpawnSetupOptions {
  projectPath: string;
  projectName: string;
  repos: DetectedRepo[];
  metaRepoPath: string;
  trackerType: TrackerType;
  sessionName: string;
  onProgress?: (event: SetupProgress) => void;
}

export async function spawnSetupSession(opts: SpawnSetupOptions): Promise<SpawnSetupResult> {
  // 1. Create setup workspace (temporary tmux session)
  // 2. Write SETUP_PROMPT.md with detected repos, conventions, goals
  // 3. Spawn Claude Code with setup-agent prompt
  // 4. Agent explores codebase, generates meta repo contents
  // 5. Agent signals completion, wizard presents results for review
}
```

**Setup Agent prompt structure:**

```markdown
# Setup Agent — Project Configuration Assistant

You are a Setup Agent for Overdeck, an AI-powered development orchestration tool.
Your job is to analyze a codebase and generate configuration files that help other
AI agents work effectively in this project.

## Project Context
- Name: {{PROJECT_NAME}}
- Path: {{PROJECT_PATH}}
- Type: progressive-polyrepo
- Repos: {{REPO_COUNT}} repositories
- Tracker: {{TRACKER_TYPE}}

## Detected Repositories
{{REPO_TABLE}}

## Your Tasks

### 1. Generate CLAUDE.md
Write a CLAUDE.md for the meta repo's .agent-template/.claude/CLAUDE.md.

IMPORTANT: Only document what's unusual or non-obvious. Modern LLMs know how to
run npm install, git commit, etc. Focus on:
- Conventions that deviate from defaults (e.g., PRs target 'qa' not 'main')
- Per-repo quirks (e.g., each Lambda has its own package.json, no root-level one)
- Things that break if done wrong (e.g., never run terraform apply)
- Architecture patterns specific to this project

### 2. Generate repo-map.md
Document what each repo does, its dependencies, and common change patterns.

### 3. Generate repo-groups.yaml
Group repos by functional area based on naming patterns and shared dependencies.

### 4. Generate onboarding checklist
List everything a new team member needs:
- CLI tools (git, gh, specific CLIs)
- API keys and access (how to get them, not the keys themselves)
- Repos to clone
- Local setup steps

## Output
Write all files to: {{META_REPO_PATH}}/
```

**Setup Agent session lifecycle:**

- Spawns in a tmux session like planning agents
- Runs with `--dangerously-skip-permissions` (it's exploring, not modifying production code)
- Agent's CWD is the project root (so it can read all repos)
- Writes output to the meta repo directory
- On completion, the wizard presents generated files for review
- User can edit, approve, or re-run with different instructions

### Meta Repo as First-Class Concept

The setup wizard introduces meta repos as a documented, supported pattern:

**What a meta repo contains:**

```
team-meta/
├── .agent-template/              # Copied into every workspace
│   └── .claude/
│       ├── CLAUDE.md             # Project conventions for agents
│       ├── skills/               # Team-specific skills
│       ├── commands/             # Team-specific commands
│       └── agents/               # Custom agent definitions
├── overdeck/                   # Overdeck-specific config
│   ├── repo-groups.yaml          # Repo group definitions
│   └── templates/                # Project-specific templates (optional)
├── docs/                         # Architecture and reference docs
│   ├── repo-map.md               # What each repo does
│   ├── architecture.md           # System architecture overview
│   └── onboarding/               # Team onboarding materials
│       ├── checklist.md          # Prerequisites checklist
│       ├── machine-setup.sh      # Automated setup script
│       └── README.md             # Getting started guide
└── README.md
```

**Onboarding flow for new team members:**

1. Clone the meta repo
2. Run `machine-setup.sh` (installs prerequisites, clones repos)
3. Run `pan setup` (detects existing repos, applies team's template)
4. Ready to work

The `machine-setup.sh` script is generated by the Setup Agent based on detected prerequisites:

```bash
#!/bin/bash
# Auto-generated by Overdeck Setup Agent

echo "=== Team Onboarding Setup ==="

# Check prerequisites
command -v git >/dev/null || { echo "Install git first"; exit 1; }
command -v gh >/dev/null || { echo "Install GitHub CLI: https://cli.github.com/"; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 20+"; exit 1; }

# Authenticate GitHub CLI
gh auth status || gh auth login

# Clone repos
REPOS=(
  "hotschedules/int-micros-simphony"
  "hotschedules/int-toast"
  # ... all repos
)

for repo in "${REPOS[@]}"; do
  name=$(basename "$repo")
  if [ ! -d "HS/$name" ]; then
    gh repo clone "$repo" "HS/$name"
  fi
done

# Install Overdeck
npx overdeck@latest install

# Register project
pan setup  # Interactive wizard with team template pre-applied

echo "Done! Run 'pan status' to verify setup."
```

---

## Implementation Plan

### Phase 1: Setup Wizard Core
- `src/cli/commands/setup.ts` — interactive prompts, repo detection, config generation
- `src/lib/setup/detect.ts` — repo scanning, branch detection, language detection
- `src/lib/setup/templates.ts` — template loading and application
- `templates/project-types/` — four template archetypes

### Phase 2: Setup Agent
- `src/lib/setup/spawn-setup-session.ts` — agent spawning (modeled on planning agent)
- `src/lib/setup/setup-prompt.ts` — prompt builder with codebase context
- Setup agent skill in `skills/setup-agent/`

### Phase 3: Meta Repo Support
- Meta repo scaffold in `templates/project-types/progressive-polyrepo/meta-repo-scaffold/`
- `pan setup` meta repo creation flow
- Onboarding script generation

### Phase 4: Dashboard Integration
- Project management page in dashboard for viewing/editing project configs
- Setup wizard accessible from dashboard (not just CLI)
- Setup Agent visible in agent list with its own status

---

## Testing

### Unit Tests

1. **Repo detection** (`tests/lib/setup/detect.test.ts`):
   - Detects repos in nested directories
   - Correctly identifies default branch from git
   - Detects qa branch presence
   - Identifies language from file extensions
   - Handles repos without remotes gracefully

2. **Template loading** (`tests/lib/setup/templates.test.ts`):
   - Loads template.yaml with defaults
   - Merges user answers into config
   - Applies conditional prompts correctly
   - Template defaults are valid WorkspaceConfig

3. **Config generation** (`tests/lib/setup/config.test.ts`):
   - Generated YAML is valid and parseable
   - All detected repos appear in config
   - Branch names are correct per repo
   - Progressive mode set correctly for 10+ repos

### Integration Tests

1. **End-to-end wizard** (manual/Playwright):
   - Run `pan setup` on a test directory with known repos
   - Verify generated `projects.yaml` is correct
   - Verify workspace creation works with generated config

2. **Setup Agent**:
   - Agent generates valid CLAUDE.md
   - Agent generates valid repo-groups.yaml
   - Generated files are placed in correct meta repo locations

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/cli/commands/setup.ts` | Main wizard command |
| `src/lib/setup/detect.ts` | Repo scanning and convention detection |
| `src/lib/setup/templates.ts` | Template loading and application |
| `src/lib/setup/spawn-setup-session.ts` | Setup Agent spawning |
| `src/lib/setup/setup-prompt.ts` | Setup Agent prompt builder |
| `templates/project-types/simple-app/template.yaml` | Simple app template |
| `templates/project-types/monorepo/template.yaml` | Monorepo template |
| `templates/project-types/polyrepo/template.yaml` | Polyrepo template |
| `templates/project-types/progressive-polyrepo/template.yaml` | Progressive polyrepo template |
| `templates/project-types/progressive-polyrepo/meta-repo-scaffold/` | Meta repo skeleton |
| `skills/setup-agent/skill.md` | Setup Agent skill definition |
| `configuration/setup-wizard.mdx` | User documentation |
| `tests/lib/setup/detect.test.ts` | Detection tests |
| `tests/lib/setup/templates.test.ts` | Template tests |

## Files to Modify

| File | Changes |
|------|---------|
| `src/cli/commands/project.ts` | Deprecate `pan project add` in favor of `pan setup`, keep as alias |
| `src/lib/agents.ts` | Add `setup-agent` to recognized agent types |
| `src/cli/index.ts` | Register `setup` command |
| `configuration/projects.mdx` | Reference setup wizard for project configuration |
