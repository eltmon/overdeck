---
name: pan-convoy-synthesis
description: Synthesize results from parallel agent work in a convoy
triggers:
  - convoy synthesis
  - synthesize convoy
  - merge convoy results
  - convoy complete
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - Task
---

# Convoy Synthesis

Synthesize and integrate work from multiple agents that ran in parallel as a convoy.

## When to Use

Use this skill when:
- A convoy has completed and you need to merge all agent work
- Multiple agents worked on related issues and their changes need integration
- You need to create a comprehensive PR from parallel work
- Resolving conflicts between parallel agent changes

## Synthesis Process

### Step 1: Gather Convoy Results

```bash
# Get convoy status and results
pan convoy status <convoy-id>

# List all agents in the convoy
pan convoy status <convoy-id> | grep -A 50 "Agents"
```

### Step 2: Collect Workspace Changes

For each completed agent in the convoy:

```bash
# Check each workspace for changes
cd ~/.panopticon/workspaces/<issue-id>
git status
git log --oneline -10
git diff main...HEAD
```

### Step 3: Identify Integration Points

Look for:
- **Conflicting changes** - Same files modified by multiple agents
- **Dependent changes** - Changes that build on each other
- **Complementary changes** - Independent changes that combine well

### Step 4: Merge Strategy

#### Option A: Sequential Merge (Recommended for conflicts)

```bash
# Start from main
git checkout main
git pull origin main

# Create integration branch
git checkout -b convoy/<convoy-id>

# Merge each agent's work in order
git merge --no-ff feature/<issue-1>
git merge --no-ff feature/<issue-2>
# Resolve conflicts as needed
git merge --no-ff feature/<issue-3>
```

#### Option B: Squash Merge (Clean history)

```bash
# Create integration branch
git checkout -b convoy/<convoy-id>

# Cherry-pick or squash from each workspace
git merge --squash feature/<issue-1>
git commit -m "feat: integrate <issue-1> changes"

git merge --squash feature/<issue-2>
git commit -m "feat: integrate <issue-2> changes"
```

#### Option C: Octopus Merge (No conflicts)

```bash
# If there are no conflicts, merge all at once
git checkout main
git merge feature/<issue-1> feature/<issue-2> feature/<issue-3>
```

### Step 5: Verify Integration

```bash
# Run tests
npm test

# Run build
npm run build

# Check for type errors
npm run typecheck

# Run linter
npm run lint
```

### Step 6: Create Synthesis Summary

Generate a summary of all integrated work:

```markdown
# Convoy Synthesis: <convoy-name>

## Integrated Issues
- <issue-1>: <title>
- <issue-2>: <title>
- <issue-3>: <title>

## Changes Summary
### <issue-1>
- Brief summary of changes
- Files modified: X

### <issue-2>
- Brief summary of changes
- Files modified: Y

### <issue-3>
- Brief summary of changes
- Files modified: Z

## Conflicts Resolved
- `src/file.ts`: Chose <issue-1>'s approach because...

## Integration Notes
- Any special considerations
- Dependencies between changes
- Known issues or follow-ups needed

## Testing
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] No regressions identified
```

### Step 7: Create Pull Request

```bash
# Push integration branch
git push origin convoy/<convoy-id>

# Create PR with synthesis summary
gh pr create \
  --title "Convoy: <convoy-name>" \
  --body "$(cat synthesis-summary.md)" \
  --base main \
  --head convoy/<convoy-id>
```

## Conflict Resolution Guidelines

### Code Conflicts

When two agents modified the same code:

1. **Understand both changes** - Read both versions carefully
2. **Check dependencies** - Does one change depend on the other?
3. **Prefer composition** - Can both changes coexist?
4. **Test thoroughly** - Run tests after each resolution

### Import Conflicts

```typescript
// Agent 1 added:
import { FeatureA } from './features';

// Agent 2 added:
import { FeatureB } from './features';

// Resolution: Combine imports
import { FeatureA, FeatureB } from './features';
```

### Schema/Type Conflicts

```typescript
// Agent 1 added field:
interface User {
  id: string;
  newField1: string;
}

// Agent 2 added field:
interface User {
  id: string;
  newField2: number;
}

// Resolution: Merge all fields
interface User {
  id: string;
  newField1: string;
  newField2: number;
}
```

## Automated Synthesis

Use the convoy synthesis prompt generator:

```bash
# Generate synthesis prompt
pan convoy synthesize <convoy-id>
```

This outputs a detailed prompt you can use to guide the synthesis process.

## Best Practices

1. **Review before merging** - Don't blindly merge; understand each change
2. **Test incrementally** - Run tests after merging each agent's work
3. **Document decisions** - Record why you chose specific conflict resolutions
4. **Keep the PR focused** - If convoy scope is too large, consider splitting
5. **Tag individual PRs** - Reference original issues in commit messages

## Related Commands

```bash
# Convoy management
pan convoy list
pan convoy status <id>
pan convoy synthesize <id>

# Workspace management
pan workspace list
pan workspace remove <issue-id>
```
