---
name: pan-plan
audience: operator
description: "pan plan <id> — create an execution plan (vBRIEF) for an issue before starting"
triggers:
  - plan issue
  - create plan
  - planning session
  - pan plan
  - ai planning
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - AskUserQuestion
---

# Panopticon Planning Workflow

## Overview

This skill guides you through Panopticon's interactive planning feature, where an AI agent explores the codebase, asks discovery questions, and creates a comprehensive execution plan before any code is written.

## When to Use

- User wants to plan before implementing
- Issue is complex or poorly defined
- User needs to understand codebase first
- Multiple implementation approaches possible
- User wants AI to research and recommend approach
- User asks "how should I implement this?"

## What is AI Planning?

Panopticon's planning workflow:

1. **AI explores codebase** - Searches for relevant files, patterns, dependencies
2. **AI asks discovery questions** - Clarifies requirements, gathers context
3. **AI researches approaches** - Investigates how similar features work
4. **AI creates plan** - Documents step-by-step implementation strategy
5. **User reviews and approves** - Plan becomes guide for implementation agent

**Benefits:**
- No code changes during planning (read-only)
- AI learns codebase architecture before implementing
- User can course-correct early
- Plan serves as reference during implementation
- Better architectural decisions

## Basic Usage

```bash
# Start planning session for an issue
pan plan PAN-3

# Plan with specific focus
pan plan PAN-3 --focus security

# Plan with time limit
pan plan PAN-3 --timeout 10m
```

## Planning Workflow

### Step 1: Start Planning Session

```bash
pan plan PAN-3
```

**What happens:**
1. Creates planning workspace (read-only clone)
2. Loads issue details from tracker
3. Spawns AI planning agent in tmux session
4. Opens interactive terminal in dashboard

### Step 2: AI Discovery Phase

The planning agent will:
- Search codebase for relevant files
- Identify existing patterns and conventions
- Look for similar features already implemented
- Analyze dependencies and architecture
- Review test coverage and documentation

**Example discovery actions:**
```bash
# Agent searches for authentication code
Grep pattern="login\|authenticate" output_mode="files_with_matches"

# Agent examines existing patterns
Read file_path="src/auth/LoginService.ts"

# Agent checks test structure
Glob pattern="**/*test.ts"
```

### Step 3: Interactive Questions

The agent will ask clarifying questions via the dashboard:

**Example questions:**
- "Should we use JWT or session-based authentication?"
- "Where should the new API endpoint be located?"
- "Should this be a new service or extend existing UserService?"
- "What database tables need to be created or modified?"

**How to answer:**
- Questions appear in dashboard chat interface
- Click on answer options or type custom response
- Agent uses answers to refine the plan

### Step 4: Plan Creation

Agent writes comprehensive plan to `PLANNING.md`:

**Plan structure:**
```markdown
# PAN-3: Add User Authentication

## Summary
Brief overview of what will be implemented

## Architecture Decisions
- Use JWT tokens (user preferred over sessions)
- Extend existing AuthService
- Add auth middleware to Express app
- Store tokens in Redis with 24h TTL

## Implementation Steps
1. Create JWT token generation in AuthService
2. Add login endpoint POST /api/auth/login
3. Add middleware to verify tokens
4. Update User model with password hashing
5. Add refresh token logic
6. Write integration tests

## Files to Create
- src/auth/JwtService.ts
- src/auth/authMiddleware.ts
- tests/auth/jwt.test.ts

## Files to Modify
- src/auth/AuthService.ts (add JWT methods)
- src/api/routes.ts (add auth routes)
- src/models/User.ts (add password field)

## Dependencies to Add
- jsonwebtoken@9.0.0
- bcrypt@5.1.0
- @types/jsonwebtoken
- @types/bcrypt

## Testing Strategy
- Unit tests for JWT generation/verification
- Integration tests for login flow
- Security tests for token validation
- E2E tests for protected routes

## Security Considerations
- Hash passwords with bcrypt (salt rounds: 10)
- Sign JWTs with strong secret (env var)
- Short-lived access tokens (15min)
- Long-lived refresh tokens (7 days)
- Rate limiting on login endpoint

## Edge Cases
- Expired tokens
- Invalid tokens
- Missing auth header
- Password reset flow (future work)

## Success Criteria
- [ ] User can login with email/password
- [ ] JWT token returned on successful login
- [ ] Protected routes require valid token
- [ ] Invalid tokens return 401
- [ ] All tests pass
```

### Step 5: Review Plan

```bash
# View the plan
cat ~/panopticon/planning/PAN-3/PLANNING.md

# Or view in dashboard
# Click on "View Plan" in the planning session panel
```

**Review checklist:**
- Are architectural decisions sound?
- Are all requirements covered?
- Are edge cases identified?
- Is testing strategy comprehensive?
- Are dependencies appropriate?
- Is implementation order logical?

### Step 6: Approve or Revise

**Option A: Approve plan**
```bash
# Accept the plan and create workspace
pan start PAN-3 --with-plan

# This will:
# 1. Create implementation workspace
# 2. Copy PLANNING.md to workspace
# 3. Spawn implementation agent with plan context
```

**Option B: Revise plan**
```bash
# Send feedback to planning agent
pan tell PAN-3-planning "Consider using refresh tokens"

# Agent will update plan based on feedback
# Review updated plan and approve when ready
```

**Option C: Reject and plan manually**
```bash
# Exit planning session
pan kill PAN-3-planning

# Create plan manually
mkdir -p ~/panopticon/planning/PAN-3/
vim ~/panopticon/planning/PAN-3/PLANNING.md

# Then create workspace with manual plan
pan start PAN-3
```

## Advanced Planning

### Planning with Context

```bash
# Plan with reference to related issues
pan plan PAN-3 --context "PAN-1,PAN-2"

# Plan with specific files to focus on
pan plan PAN-3 --files "src/auth/**"

# Plan with architectural constraints
pan plan PAN-3 --constraints "Must use existing AuthService"
```

### Planning Focus Areas

```bash
# Focus on security
pan plan PAN-3 --focus security

# Focus on performance
pan plan PAN-3 --focus performance

# Focus on testing
pan plan PAN-3 --focus testing

# Focus on architecture
pan plan PAN-3 --focus architecture
```

### Iterative Planning

```bash
# Create high-level plan first
pan plan PAN-3 --depth overview

# Review and then create detailed plan
pan plan PAN-3 --depth detailed
```

## Dashboard Planning Interface

The dashboard provides rich planning UI:

**Features:**
- **Live terminal**: See agent's exploration in real-time
- **Question prompts**: Answer questions with buttons/forms
- **Plan preview**: Rendered markdown view of plan
- **File explorer**: Browse files agent is examining
- **Diff viewer**: See proposed changes (if any)
- **Approval workflow**: Approve/reject/request-changes

**Access:** http://localhost:3001/planning/PAN-3

## Planning Best Practices

### 1. Start with Planning for Complex Issues

✅ **Good candidates for planning:**
- New features with unclear requirements
- Refactoring large subsystems
- Security-sensitive changes
- Performance optimization (need profiling first)
- Integration with new external APIs

❌ **Skip planning for:**
- Simple bug fixes
- Typo corrections
- Documentation updates
- Trivial changes

### 2. Guide the Planning Agent

**Provide context:**
```bash
# When starting planning session, add context
pan tell PAN-3-planning "This is for the mobile app, not web"
pan tell PAN-3-planning "User prefers GraphQL over REST"
```

**Answer questions thoughtfully:**
- Don't just pick first option
- Consider long-term implications
- Ask agent to research if unsure

### 3. Review Plans Critically

**Check for:**
- Missing error handling
- Unaddressed edge cases
- Overly complex solutions
- Missing tests
- Security vulnerabilities
- Performance implications

### 4. Iterate if Needed

Don't settle for first plan:
```bash
# Request refinement
pan tell PAN-3-planning "Simplify the auth middleware approach"

# Ask for alternatives
pan tell PAN-3-planning "What if we used OAuth instead?"
```

## Troubleshooting

### Planning session won't start

**Problem:** `pan plan` fails or hangs

**Solutions:**
```bash
# Check tmux is available
which tmux

# Check planning directory exists
mkdir -p ~/.panopticon/planning/

# Check issue exists in tracker
pan issues | grep PAN-3

# Try with verbose output
pan plan PAN-3 --verbose
```

### Agent isn't asking questions

**Problem:** Planning agent creates plan without any questions

**Solutions:**
- This is normal for simple, well-defined issues
- Agent only asks when clarification needed
- You can proactively send context:
  ```bash
  pan tell PAN-3-planning "Please ask questions about approach"
  ```

### Plan is too high-level

**Problem:** Plan lacks implementation details

**Solutions:**
```bash
# Request more detail
pan tell PAN-3-planning "Please add more specific implementation steps"

# Specify depth
pan plan PAN-3 --depth detailed
```

### Plan is too detailed

**Problem:** Plan is overwhelming with minutiae

**Solutions:**
```bash
# Request overview
pan tell PAN-3-planning "Focus on high-level architecture, less detail"

# Or start with overview depth
pan plan PAN-3 --depth overview
```

### Can't view plan in dashboard

**Problem:** Dashboard doesn't show plan

**Solutions:**
```bash
# Verify plan file exists
ls ~/panopticon/planning/PAN-3/PLANNING.md

# Restart dashboard
pan down && pan up

# View plan manually
cat ~/panopticon/planning/PAN-3/PLANNING.md
```

## Planning Workflow Variations

### Sequential Planning

For epics with multiple sub-issues:

```bash
# Plan parent issue
pan plan EPIC-1

# Plan child issues with context from parent
pan plan PAN-3 --context EPIC-1
pan plan PAN-4 --context EPIC-1
```

### Collaborative Planning

Multiple team members reviewing plan:

```bash
# Planning agent creates plan
pan plan PAN-3

# Team reviews in dashboard
# Click "Request Changes" in UI

# Agent revises based on team feedback
# Team approves when ready
```

### Research-Heavy Planning

For unfamiliar domains:

```bash
# Start planning with research focus
pan plan PAN-3 --research

# Agent will:
# - Search for documentation
# - Look for examples in codebase
# - Suggest learning resources
# - Propose proof-of-concept approach
```

## Plan Quality Indicators

### High-Quality Plan

- ✅ Clear summary and scope
- ✅ Specific architectural decisions with rationale
- ✅ Ordered implementation steps
- ✅ All files to create/modify identified
- ✅ Dependencies listed with versions
- ✅ Comprehensive testing strategy
- ✅ Security considerations addressed
- ✅ Edge cases documented
- ✅ Success criteria defined

### Needs Improvement

- ❌ Vague or generic steps
- ❌ No architectural decisions
- ❌ Missing test strategy
- ❌ No edge cases considered
- ❌ Unclear success criteria

## After Planning

Once plan is approved:

```bash
# Create workspace with plan
pan start PAN-3 --with-plan

# Implementation agent will have:
# - Full plan as context
# - Files identified in plan
# - Architecture decisions documented
# - Test requirements clear
```

Implementation agent can reference plan:
```bash
# Agent reads plan
Read file_path="PLANNING.md"

# Agent follows implementation steps
# Agent verifies against success criteria
```

## Related Skills

- `/pan-issue` - Create workspace and spawn agent
- `/pan-help` - Command reference
- `/pan-status` - Monitor planning session
- `/feature-work` - Implementation workflow (post-planning)
- `/onboard-codebase` - Codebase exploration (similar to planning discovery)

## More Information

- Planning sessions are read-only (no code changes)
- Plans saved in `~/.panopticon/planning/<issue-id>/PLANNING.md`
- Dashboard planning UI: http://localhost:3001/planning/<issue-id>
- Run `pan plan --help` for more options
