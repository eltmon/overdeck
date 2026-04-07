<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-475

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
  - Implementation plan at `docs/prds/active/{issue-id}/STATE.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-475
- **Title:** Enforce PR-based workflow — require reviews before merge
- **URL:** https://github.com/eltmon/panopticon-cli/issues/475

## Description
## Context

We discovered that our workflow doesn't require PRs for merges. Work branches complete and signal 'ready to merge' without ever opening a PR for review. This allowed incomplete and broken work to reach main unchecked.

PAN-470 is a good example: 9 of 13 route files were wrapped with `httpHandler`, leaving 4 major files still in the old pattern. Without a PR, this wasn't caught until manual review.

Today's session added more examples: hotfixes committed directly to main got wiped by the merge agent's `git restore .` because they were never in a PR branch. This happened twice in one session.

## Must-Haves (all required)

### 1. Merge agent uses `gh pr create` + GitHub merge API
Instead of local `git merge feature/pan-XXX`, the merge agent:
- Opens a PR via `gh pr create`
- Waits for CI checks to pass
- Merges via `gh pr merge --squash` (or --merge)
- No more local working-tree manipulation on main

### 2. Branch protection rules on main
Enable via GitHub API / gh CLI (NOT during this implementation — see ordering below):
- Require PR before merge
- Require at least 1 approving review (review-agent counts)
- Require status checks to pass (typecheck, lint, test)
- Block direct pushes to main

> ⚠️ **Branch protection is a SEPARATE issue (PAN-505) to run immediately after this merges.** Do not enable it during this implementation or the agent will lock itself out of pushing its own feature branch.

### 3. `pan work done` creates a PR instead of just signaling completion
The completion flow becomes: commit → push feature branch → `gh pr create` with description linking the issue → set reviewStatus to 'reviewing'.

### 4. Automation to flag incomplete work in PRs
Review-agent checks for consistency issues (e.g. missing httpHandler adoption across route files) and comments on the PR. This gives a paper trail of what was reviewed.

### 5. Document in CONTRIBUTING.md
> ✅ **CONTRIBUTING.md is being created separately** before this agent starts, so it can be treated as the authoritative reference. The agent should not create it from scratch — it will already exist.

## Implementation Notes

### Bootstrap exception
PAN-475 itself will be merged via the old direct-merge path (the merge agent doesn't use PRs yet). This is the one-time bootstrap. After PAN-475 merges, PAN-505 (branch protection) runs and locks the gate.

### Ordering constraint
```
PAN-475 merges (via old path)
    ↓
PAN-505: enable branch protection
    ↓
All future merges go through PR workflow
```

The implementation agent must NOT enable branch protection as part of PAN-475. That is PAN-505's job.

### Key files
| File | Change |
|------|--------|
| `src/lib/cloister/merge-agent.ts` | Replace git merge with gh pr create + gh pr merge |
| `src/lib/cloister/prompts/work-agent.md` | Update completion instructions to push + create PR |
| `src/dashboard/server/routes/workspaces.ts` | `triggerMerge()` calls new PR-based flow |
| `CONTRIBUTING.md` | Already exists — reference it, don't rewrite it |
| `.github/workflows/ci.yml` | Add CI workflow for typecheck + lint + test |

### CI workflow needed
Branch protection requires status checks. A GitHub Actions workflow must be added that runs on every PR:
```yaml
- npm run typecheck
- npm run lint  
- npm test
```

## Why This Matters
- Catches incomplete refactors before they reach main
- Creates an audit trail (PR comments explain why changes were made)
- Prevents the 'hotfix got wiped' class of bugs entirely
- Makes the merge agent safer (no local git restore on main)

## Issue Comments

**IMPORTANT: Read these comments carefully — they contain context, decisions, and references to previous work.**

### eltmon (2026-04-06):
## PR-Based Workflow Specifics

After reviewing the specialist workflow documentation and code, here are the specific details on how PRs will be used:

### 1. **When PRs Are Created**

**Timing:** After the work agent completes implementation (beads all closed, tests pass locally)
- **Creator:** Work agent (autonomous) via `gh pr create`
- **Trigger:** Called when agent signals completion via `pan work done`
- **Current code location:** `src/dashboard/server/routes/workspaces.ts` in `ensurePRExists()` function

**Current behavior:**
- Checks if PR already exists for the branch before creating
- Automatically uses `feature/<issue-id>` as branch name
- Current PR title/body too minimal: just issue ID and generic message

### 2. **PR-Agent Integration Points**

#### Work Agent → Review Agent Pipeline
```
Work Agent completes implementation
  ↓
Creates PR via gh pr create (if not exists)
  ↓
Submits to review-agent via POST /api/specialists/queue
  ↓
Review Agent wakes up (FPP principle)
  ↓
Reads PR via gh pr view & gh pr diff
  ↓
Reviews code for security, performance, correctness (via Convoy system)
  ↓
Submits GitHub review via gh pr review --request-changes OR --approve
  ↓
Sends feedback to work agent if changes needed
```

#### Review Agent Specifics
- **PR URL** is passed to review-agent as part of `ReviewContext`
- **Files changed** extracted via `getFilesChangedFromPR()` (currently exists in code)
- **Review result** posted as GitHub PR review comment
- **Acceptance Criteria** from vBRIEF plan sent to review-agent for verification
- **PRD compliance** mandatory check (AC must be met, not just architecturally present)

### 3. **Merge Agent Handles PR to Main**

**After review passes:**
- Merge-agent wakes up when review-agent approves
- Resolves conflicts between feature branch and main
- Validates conflict resolution with:
  - Conflict marker scan (git diff --check)
  - Full production build
  - Full test suite
  - Pre-merge acceptance criteria validation
- Pe [truncated]

---

### eltmon (2026-04-06):
## PR-Based Workflow Implementation Plan

Based on review of Panopticon's specialist pipeline and current code:

### Current State
1. **PR Creation**: PRs are already auto-created via `ensurePRExists()` (src/dashboard/server/routes/workspaces.ts:355-378) when:
   - Work reaches `readyForMerge` state (review passed, tests passed)
   - Currently only triggered for remote workspaces
   - PR body is minimal: just the issue ID
   
2. **Specialist Pipeline**: Three-stage flow already exists:
   - **Review Agent** (spawnReviewAgent): Reviews branch, passes/fails review status
   - **Test Agent** (spawnTestAgent): Runs tests, passes/fails test status  
   - **Merge Agent** (mergeBranch): Merges to main only after both stages pass

3. **Review Status Tracking**: Stored in ~/.panopticon/review-status.json with fields:
   - reviewStatus: pending | reviewing | passed | failed
   - testStatus: pending | testing | passed | failed
   - readyForMerge: computed as (reviewStatus === 'passed' && testStatus === 'passed')

### What This Means for PRs

**Every merged branch will have**:
1. ✅ A GitHub PR auto-created before review starts
2. ✅ Review-agent reviews the diff and approves/requests-changes via `gh pr review`
3. ✅ Test-agent runs tests (configured per-project in projects.yaml)
4. ✅ Merge happens only after both agents pass (human clicks MERGE button)
5. ✅ PR is merged via `gh pr merge` with squash (line 3056 in workspaces.ts)

### Implementation Details

**When will PRs be created?**
- Currently: After work agent signals completion (`pan work done`)
  - Review agent is auto-woken
  - Once review passes, PR should be created before test agent runs
  - **ACTION**: Expand PR creation from remote-only to all workspaces (PAN-475 subtask)

**How will review happen?**
- Review agent already uses `gh pr review` commands (see review-agent.md prompts)
- Agent can approve, request-changes, or comment on PR
- **ACTION**: Ensure review comments are rich and reference specific lines (not jus [truncated]

---

### eltmon (2026-04-06):
## Concrete failure modes this would prevent

Two incidents from today's session illustrate why this is high priority:

**1. Merge agent wipes working-tree hotfixes (happened twice today)**
We fixed `store.ts` (Done column showing 0 issues) and deployed it. The fix was never committed to git — it lived only in the working tree. When the merge agent ran `git restore .` to clean up before merging PAN-489, it wiped the fix. Post-merge deploy rebuilt from the reverted source. Done column broke again silently.

With PAN-475: merge agent uses GitHub's merge API instead of local `git merge` — never touches the main working tree. Branch protection also blocks direct working-tree patches from ever being the 'real' fix.

**2. Direct main commits bypass review and testing**
Several fixes this session were committed directly to main (post-merge-deploy.sh, specialists.ts, verification-runner.ts, store.ts). No CI, no review, no record of what changed and why until we manually filed issues after the fact.

With PAN-475: branch protection rejects direct pushes to main. Every fix goes through a PR branch → CI → merge. The merge becomes the audit trail.

**Bottom line:** PAN-475 is the systemic fix for a whole class of 'hotfix got lost' and 'what changed main?' problems that will keep recurring until branch protection is in place.

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

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

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}/STATE.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: `vBRIEFInfo` and `plan`.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/0.0.0",
    "description": "Plan for PAN-475: <issue title>"
  },
  "plan": {
    "id": "pan-475",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/475", "label": "PAN-475", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-475"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

**CRITICAL vBRIEF rules:**
- The file MUST have `vBRIEFInfo` and `plan` as the ONLY top-level keys
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-475")
- `plan.uid` MUST be a freshly generated UUID v4
- Do NOT use `issue`, `issueId`, or `issue_id` — use `plan.id`
- `items[].status` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be `subItems` with `metadata.kind: "acceptance_criterion"`
- `metadata.difficulty` and `metadata.issueLabel` are Panopticon extensions to the vBRIEF spec
- Edge types: `blocks` (hard dependency), `informs` (soft), `invalidates`, `suggests`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
