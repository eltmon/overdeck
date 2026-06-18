# Progressive Polyrepo Workspaces

## Problem

Overdeck's polyrepo workspace system creates git worktrees for **every repo listed in the config** on workspace creation. This works for projects with 4-6 repos (like a typical frontend/backend/infra split), but breaks down for large-scale integration projects with 30+ repositories.

Issues with the current all-or-nothing approach:
- **Most issues touch 1-3 repos.** Creating 30+ worktrees wastes time and disk for the 90% case.
- **Agents don't know which repos they need upfront.** The planning phase determines scope — the agent reads the issue, explores architecture docs, then decides which repos to modify.
- **No way to add repos mid-work.** Once a workspace is created, its repo set is fixed. If an agent discovers it needs an additional repo, there's no mechanism to pull it in.
- **Meta repos (shared skills/docs) shouldn't have feature branches.** A shared documentation/skills repo should always reflect `main`, not get a feature branch created in it.

## Decision

Add **progressive worktree creation** to Overdeck's polyrepo system. Workspaces start with only essential repos (meta/docs), and agents pull in additional repos on demand during work.

This is opt-in via a `progressive: true` flag. Existing polyrepo projects (which have 4-6 repos) continue to work exactly as before — all repos checked out on workspace creation.

---

## Architecture

### New Config Fields

#### `WorkspaceConfig` additions (`src/lib/workspace-config.ts`):

```typescript
export interface WorkspaceConfig {
  // ... existing fields ...
  progressive?: boolean;           // When true, only always_include repos are created on workspace init
  always_include?: string[];       // Repo names from repos[] to always include (typically meta repos)
  groups_file?: string;            // Path (relative to project root) to repo-groups.yaml
  pr_target?: string;              // Default PR target branch for all repos (e.g., 'qa')
}
```

#### `RepoConfig` additions (`src/lib/workspace-config.ts`):

```typescript
export interface RepoConfig {
  // ... existing fields ...
  pr_target?: string;              // Per-repo PR target branch override (e.g., 'qa')
  readonly?: boolean;              // If true, agent should not commit to this repo
  link_type?: 'worktree' | 'symlink';  // How to include in workspace (default: 'worktree')
}
```

#### Repo Groups File (in meta repo, not in projects.yaml):

```yaml
# repo-groups.yaml — lives in the meta repo, version-controlled by the team
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

### Example Configuration

```yaml
# ~/.overdeck/projects.yaml
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
    progressive: true                    # NEW: only create always_include repos initially
    always_include: [meta]               # NEW: these repos are always in the workspace
    groups_file: team-meta/overdeck/repo-groups.yaml  # NEW: where groups are defined
    pr_target: qa                        # NEW: default PR target for all repos
    repos:
      - name: meta
        path: team-meta
        link_type: symlink               # NEW: symlink, not worktree (always main, no feature branch)
        readonly: true                   # NEW: agent reads but never commits
      - name: api-service
        path: HS/api-service
        default_branch: master
      - name: int-provider-a
        path: HS/int-provider-a
        default_branch: master
      - name: int-provider-b
        path: HS/int-provider-b
        default_branch: main
      # ... 28 more repos
  specialists:
    merge: false                         # No merge automation — humans review and merge PRs
```

### Workspace Creation Flow (Progressive Mode)

**Current behavior (progressive: false, unchanged):**
1. `pan workspace create INT-123`
2. Create `workspaces/feature-int-123/`
3. Create worktrees for ALL repos in `repos[]`
4. Copy skills from agent template
5. Done

**New behavior (progressive: true):**
1. `pan workspace create INT-123`
2. Create `workspaces/feature-int-123/`
3. For each repo in `always_include`:
   - If `link_type: symlink` → create symlink to repo directory (no feature branch)
   - If `link_type: worktree` (default) → create worktree as usual
4. Copy skills from agent template (uses `always_include` meta repo's `.agent-template/`)
5. Done — workspace has only meta repo(s), agent starts planning

### Adding Repos Mid-Work

**New CLI command:**
```bash
pan workspace add-repo <workspace-id> <repo-name> [repo-name...] [--group <group-name>]
```

**Examples:**
```bash
# Add specific repos
pan workspace add-repo int-123 int-provider-a int-canonical-to-hs

# Add a named group
pan workspace add-repo int-123 --group simphony

# Add all repos
pan workspace add-repo int-123 --group all
```

**Implementation (`src/cli/commands/workspace.ts`):**

```typescript
async function addRepoCommand(workspaceId: string, repoNames: string[], options: { group?: string }): Promise<void> {
  // 1. Find the workspace
  const workspacePath = resolveWorkspacePath(workspaceId);
  const projectConfig = findProjectByWorkspace(workspacePath);
  const wsConfig = projectConfig.workspace;

  // 2. Resolve repo names (expand groups if --group specified)
  let targetRepos: string[] = repoNames;
  if (options.group) {
    const groupsFile = join(projectConfig.path, wsConfig.groups_file);
    const groups = loadRepoGroups(groupsFile);
    if (options.group === 'all' || groups[options.group] === '*') {
      targetRepos = wsConfig.repos.map(r => r.name);
    } else {
      targetRepos = groups[options.group] || [];
    }
  }

  // 3. Filter out repos already in the workspace
  const existingRepos = readdirSync(workspacePath).filter(f =>
    statSync(join(workspacePath, f)).isDirectory() && f !== '.planning' && f !== '.claude'
  );
  const newRepos = targetRepos.filter(name => !existingRepos.includes(name));

  // 4. Create worktrees for each new repo
  for (const repoName of newRepos) {
    const repoConfig = wsConfig.repos.find(r => r.name === repoName);
    if (!repoConfig) { console.error(`Unknown repo: ${repoName}`); continue; }

    const repoPath = join(projectConfig.path, repoConfig.path);
    const targetPath = join(workspacePath, repoConfig.name);
    const featureName = basename(workspacePath).replace('feature-', '');
    const branchPrefix = repoConfig.branch_prefix || 'feature/';
    const branchName = `${branchPrefix}${featureName}`;
    const defaultBranch = repoConfig.default_branch || wsConfig.default_branch || 'main';

    if (repoConfig.link_type === 'symlink') {
      symlinkSync(repoPath, targetPath);
    } else {
      await createWorktree(repoPath, targetPath, branchName, defaultBranch);
    }
    console.log(`Added ${repoName} to workspace`);
  }
}
```

### Agent Skill: `/workspace-add-repo`

A Claude Code skill that agents invoke during work. Lives in the Overdeck global skills cache (synced via `pan sync`), not in individual meta repos.

**Skill structure:**
```
~/.overdeck/skills/workspace-add-repo/
├── skill.md
```

**`skill.md` content:**
```markdown
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
```

## How to decide which repos you need

1. Read `repo-map.md` in the meta repo for architecture and repo descriptions
2. Read `repo-groups.yaml` for available groups
3. Add only the repos you need — you can always add more later

## After adding repos

The new repos appear as subdirectories in the workspace with feature branches ready.
Run git commands inside each repo subdirectory.
```

### Symlink Behavior for Meta Repos

When `link_type: symlink` is set on a repo:

- `ln -s <project-root>/<repo.path> <workspace>/<repo.name>` — no git worktree, no feature branch
- The symlink always reflects the latest state of the actual repo directory
- Agent can read files from it but the `readonly: true` flag tells the agent (via CLAUDE.md injection) not to commit changes there
- The workspace `.claude/CLAUDE.md` should include a note like:
  ```
  ## Readonly Repos
  The following repos are symlinked for reference only — do NOT commit changes to them:
  - meta/ — shared skills and architecture docs
  ```

### Impact on Existing Workspace Code

**`createWorkspace()` in `src/lib/workspace-manager.ts`:**

The polyrepo branch (lines 527-547) changes from:
```typescript
// CURRENT: create worktree for every repo
for (const repo of workspaceConfig.repos) { ... }
```
To:
```typescript
// NEW: respect progressive mode
const reposToCreate = workspaceConfig.progressive
  ? workspaceConfig.repos.filter(r =>
      workspaceConfig.always_include?.includes(r.name))
  : workspaceConfig.repos;

for (const repo of reposToCreate) {
  if (repo.link_type === 'symlink') {
    const repoPath = join(projectConfig.path, repo.path);
    const targetPath = join(workspacePath, repo.name);
    symlinkSync(repoPath, targetPath);
  } else {
    // existing worktree creation logic
    const repoPath = join(projectConfig.path, repo.path);
    const targetPath = join(workspacePath, repo.name);
    const branchName = `${branchPrefix}${featureName}`;
    await createWorktree(repoPath, targetPath, branchName, defaultBranch);
  }
}
```

**`removeWorkspace()` in `src/lib/workspace-manager.ts`:**

Must handle symlinks during cleanup — `unlinkSync()` for symlinks vs `git worktree remove` for worktrees. Check with `lstatSync().isSymbolicLink()`.

### Impact on Agent Prompts

**`buildPolyrepoContext()` in `src/lib/cloister/work-agent-prompt.ts`:**

For progressive workspaces, the agent prompt should include:
- Which repos are currently in the workspace
- How to add more repos (`/workspace-add-repo` skill reference)
- Which repos are readonly (symlinked meta repos)
- Where to find `repo-map.md` and `repo-groups.yaml` for architecture context
- The `pr_target` branch for each repo (if different from `default_branch`)

### PR Target Branch Injection

The `pr_target` field needs to surface in the agent's context so it creates PRs against the right branch. Two mechanisms:

1. **CLAUDE.md injection**: When building the workspace CLAUDE.md, include per-repo PR target info:
   ```
   ## PR Conventions
   All PRs in this project target the `qa` branch, NOT main/master.
   ```

2. **Polyrepo context in agent prompt**: The existing `buildPolyrepoContext()` function already lists repos with their branches. Add `pr_target` to this listing.

---

## Testing

### Unit Tests (`tests/lib/workspace-manager.test.ts`)

1. **Progressive workspace creation**:
   - With `progressive: true`, only `always_include` repos get worktrees/symlinks
   - With `progressive: false` (default), all repos get worktrees (backward compat)
   - `always_include` repos with `link_type: symlink` get symlinked, not worktree'd

2. **`workspace add-repo`**:
   - Adding a single repo creates a worktree in the existing workspace
   - Adding a group resolves to correct repo names
   - Adding `--group all` includes every repo
   - Repos already in workspace are skipped (idempotent)
   - Unknown repo names produce clear error messages

3. **Symlink handling**:
   - Symlinks point to correct directory
   - `removeWorkspace()` handles symlinks without crashing
   - Readonly repos are reflected in generated CLAUDE.md

4. **Repo groups loading**:
   - Parses `repo-groups.yaml` correctly
   - `"*"` group includes all repos from config
   - Missing groups file produces clear error
   - Invalid group names produce clear error

### Integration Tests

1. **End-to-end workspace lifecycle**:
   - Create progressive workspace → only meta repo exists
   - Add repos → worktrees created with correct branches
   - Agent prompt includes add-repo instructions
   - Remove workspace → symlinks and worktrees both cleaned up

2. **Backward compatibility**:
   - Existing polyrepo config (no `progressive` field) works identically to before
   - MYN-style 6-repo polyrepo is unaffected

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/workspace-config.ts` | Add `progressive`, `always_include`, `groups_file`, `pr_target`, `readonly`, `link_type` to interfaces |
| `src/lib/workspace-manager.ts` | Progressive filtering in `createWorkspace()`, symlink support, `addRepoToWorkspace()` function, symlink cleanup in `removeWorkspace()` |
| `src/cli/commands/workspace.ts` | New `add-repo` subcommand |
| `src/lib/cloister/work-agent-prompt.ts` | Include add-repo instructions, readonly notices, pr_target in polyrepo context |
| `skills/workspace-add-repo/skill.md` | New skill for agents |
| `configuration/polyrepo.mdx` | Document progressive mode, groups, pr_target, always_include |
| `tests/lib/workspace-manager.test.ts` | Tests for all new behavior |

## Files NOT to Modify

- `src/lib/skills-merge.ts` — skills merge already works; it copies from wherever `.agent-template/` is, which will be in the meta repo
- `src/lib/planning/spawn-planning-session.ts` — planning already works with polyrepo workspaces
- `src/lib/cloister/merge-agent.ts` — merge automation is disabled for these projects (`specialists.merge: false`)
