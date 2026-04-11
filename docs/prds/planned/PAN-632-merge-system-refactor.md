# PRD: Complete Merge Pipeline — End-to-End Workflow (PAN-632)

## Problem Statement

The merge pipeline has gaps at every stage. PRs aren't created by the work agent. The final review after rebase doesn't exist. The polyrepo merge path isn't tested. The workflow is incomplete.

## Complete Pipeline

Every step is required. No optional steps.

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 1: WORK COMPLETION                                     │
├─────────────────────────────────────────────────────────────┤
│ 1. Work agent finishes implementation                        │
│ 2. Work agent runs: pan work done                            │
│ 3. pan work done:                                            │
│    a. Commits any uncommitted changes                        │
│    b. Pushes feature branch                                  │
│    c. Creates PR via gh pr create (links issue)              │
│    d. Sets reviewStatus to pending                           │
│                                                              │
│ STATUS: Step 3c NOT IMPLEMENTED — PR created lazily at merge │
├─────────────────────────────────────────────────────────────┤
│ PHASE 2: INITIAL REVIEW + TEST                               │
├─────────────────────────────────────────────────────────────┤
│ 4. Verification gate: typecheck, lint, test                  │
│ 5. Review specialist reviews the PR                          │
│    - Full strict review                                      │
│    - ANY finding = CHANGES_REQUESTED (no passing with notes) │
│    - If blocked → feedback to work agent → agent fixes       │
│ 6. Test specialist runs tests                                │
│ 7. readyForMerge = true                                      │
│                                                              │
│ STATUS: IMPLEMENTED — working                                │
├─────────────────────────────────────────────────────────────┤
│ PHASE 3: MERGE (human-triggered)                             │
├─────────────────────────────────────────────────────────────┤
│ 8. Human clicks MERGE                                        │
│ 9. SQLite merge queue: serialize per-project                 │
│ 10. Work agent rebases onto main:                            │
│     - Server messages work agent with rebase instructions    │
│     - Agent rebases, resolves conflicts, pushes              │
│     - Server polls for new HEAD on remote                    │
│     - If agent stopped: fall back to in-process rebase       │
│     - If conflicts unresolvable: fail, notify human          │
│ 11. Final review specialist (lightweight):                   │
│     - Was the rebase clean?                                  │
│     - Any obvious issues from conflict resolution?           │
│     - NOT a full code review — that already passed           │
│ 12. Final test: verification gate (typecheck/lint/test)      │
│ 13. Report commit statuses on post-rebase HEAD               │
│ 14. Merge:                                                   │
│     a. MONOREPO: gh pr merge --squash (server runs directly) │
│     b. POLYREPO: Merge specialist coordinates cross-repo     │
│        merge via event-driven completion                     │
│ 15. Dequeue next merge from SQLite queue                     │
│ 16. Post-merge lifecycle:                                    │
│     - Apply 'merged' label, remove workflow labels           │
│     - Close issue on tracker                                 │
│     - Kill work agent tmux session                           │
│     - Compact beads                                          │
│     - Stop Docker containers                                 │
│                                                              │
│ STATUS:                                                      │
│   Step 9: IMPLEMENTED (SQLite queue)                         │
│   Step 10: IMPLEMENTED (work agent rebase + in-process       │
│            fallback)                                         │
│   Step 11: NOT IMPLEMENTED (final review specialist)         │
│   Step 12: IMPLEMENTED (verification gate)                   │
│   Step 13: IMPLEMENTED (commit status reporting)             │
│   Step 14a: IMPLEMENTED (gh pr merge --squash)               │
│   Step 14b: EXISTS but NOT TESTED with MYN polyrepo          │
│   Step 15: IMPLEMENTED (SQLite dequeue)                      │
│   Step 16: IMPLEMENTED (postMergeLifecycle)                  │
└─────────────────────────────────────────────────────────────┘
```

## What Needs to Be Built

### 1. PR Creation in `pan work done` (Step 3c)

**Currently:** `pan work done` pushes the branch and sets review status. PRs are lazily created by `ensurePRExists()` at review-request or merge time.

**Required:** `pan work done` (or the request-review flow) must create the PR immediately after pushing. The PR is the artifact that review specialist reviews, test specialist tests against, and the merge flow merges.

**Files:**
- `src/cli/commands/work/done.ts` — add PR creation after push
- `src/dashboard/server/routes/workspaces.ts` — `ensurePRExists()` already exists, reuse it

### 2. Final Review Specialist (Step 11)

**Currently:** After rebase, the server runs verification (typecheck/lint/test) but no review.

**Required:** A lightweight review specialist that checks:
- Was the rebase clean? (no unresolved conflict markers)
- Do the changes still match the original review's approval?
- Any obvious issues introduced by conflict resolution?
- NOT a full code review — focus on rebase correctness only

**Files:**
- `src/lib/cloister/prompts/final-review-agent.md` — NEW lightweight review prompt
- `src/dashboard/server/routes/workspaces.ts` — dispatch final-review after rebase, before verification
- `src/lib/cloister/specialists.ts` — register final-review-agent as a specialist type

### 3. Polyrepo Merge Testing (Step 14b)

**Currently:** `spawnMergeAgentForBranches()` exists for polyrepo merge but hasn't been tested with MYN (multi-repo setup).

**Required:** Test the polyrepo merge path with Mind Your Now:
- Frontend repo (mind-your-now)
- Backend repo (mind-your-now-backend)
- Merge specialist coordinates both repos
- Event-driven completion (specialist-completion.ts) replaces polling

**Files:**
- `src/lib/cloister/merge-agent.ts` — `spawnMergeAgentForBranches()` needs polling replaced with `waitForSpecialistCompletion()`
- MYN workspace configuration in `projects.yaml`

## Implementation Order

1. **PR creation in `pan work done`** — most impactful, unblocks branch protection (PAN-505)
2. **Final review specialist** — completes the merge pipeline
3. **Polyrepo merge testing** — validates MYN path

## Already Implemented (PAN-632)

These components are done and working:

- **SQLite merge queue** (`src/lib/database/merge-queue-db.ts`) — persistent, survives restart
- **Work agent rebase** — server messages agent, polls for push, falls back to in-process
- **In-process rebase fallback** (`src/lib/cloister/merge-rebase.ts`) — when agent stopped
- **Event-driven specialist completion** (`src/lib/cloister/specialist-completion.ts`)
- **`_serverManagedMerges` fix** — single source of truth from specialists.ts
- **Post-rebase verification gate** — typecheck/lint/test after rebase
- **Post-rebase commit status reporting** — on new HEAD SHA
- **Merge queue API** (`GET /api/merge-queue`) — returns persistent queue state
- **Startup recovery** — `resetProcessingToQueued()` on server start
- **readyForMerge cleared on all failure paths**
- **Merge-ready reminder** (not "stuck") — 1 hour threshold, courtesy notification

## Acceptance Criteria

1. `pan work done` creates a PR and links it to the issue
2. Review specialist reviews the PR (not just the branch)
3. MERGE click → work agent rebases → final review → verification → merge
4. Final review specialist catches rebase-introduced issues
5. Polyrepo merge works with MYN (frontend + backend)
6. Queue serializes multiple merges per-project via SQLite
7. Server restart → queue resumes from DB
8. Branch protection (PAN-505) can be enabled after this ships
