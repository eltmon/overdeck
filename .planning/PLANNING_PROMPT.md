# Planning Session: PAN-166

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - PRD file at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-166
- **Title:** Rally tracker: WSAPI query parse error on IssueDataService poll
- **URL:** https://github.com/eltmon/panopticon-cli/issues/166

## Description
## Bug Report

**Version:** panopticon-cli v0.4.9  
**Tracker:** Rally (WSAPI)

## Description

When the Rally tracker is configured as the primary tracker, the `IssueDataService` background poller fails repeatedly with a WSAPI query parse error:

```
[IssueDataService] Rally poll error: Rally API query failed: Could not parse: Error parsing expression -- expected ")" but saw "AND" instead.
```

This error repeats on every poll cycle, resulting in no issues being displayed in the dashboard.

## Configuration

```toml
[trackers]
primary = "rally"

  [trackers.rally]
  type = "rally"
  api_key_env = "RALLY_API_KEY"
  server = "https://rally1.rallydev.com"
```

- API key is valid and loaded (confirmed via `api/settings` endpoint showing `tracker_keys.rally`)
- No `workspace` or `project` specified in config (may be contributing to malformed query)
- Two projects registered in `projects.yaml` (HSv3, HS POS Integrations)

## Root Cause (Suspected)

The Rally WSAPI query filter is being constructed with incorrect parenthesization. Rally's WSAPI requires nested parentheses for compound AND/OR expressions, e.g.:

```
((State = "In-Progress") AND (Project.Name = "Foo"))
```

The query builder appears to be generating a flat expression that the WSAPI parser rejects.

## Steps to Reproduce

1. `pan install` (v0.4.9)
2. Configure Rally as primary tracker in `config.toml`
3. Set `RALLY_API_KEY` in `~/.panopticon.env`
4. `pan up`
5. Observe repeated error in server logs
6. `curl http://localhost:3011/api/issues` returns `[]`

## Expected Behavior

Issues from the configured Rally workspace/project should be fetched and displayed in the dashboard.

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

When creating beads tasks, include difficulty labels:
```bash
bd create "PAN-XX: Task name" --type task -l "PAN-XX,linear,difficulty:medium" -d "Description"
```

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to PRD at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the PRD file BEFORE creating beads tasks.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
