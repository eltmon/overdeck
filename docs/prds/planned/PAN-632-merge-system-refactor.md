# PRD: Merge System Architectural Refactor (PAN-632)

## Problem Statement

The merge pipeline has systemic issues discovered during Operation Fix-All. See git history for the original problem list. This PRD describes the current design after multiple iterations.

## Design: Work Agent Rebase + Server Merge + SQLite Queue

### Architecture

```
Human clicks MERGE
→ SQLite queue check (persistent, survives restart)
→ Message WORK AGENT: "rebase onto main and push"
→ Wait for work agent to push (detect new HEAD on remote)
→ If conflicts → work agent resolves them (it knows the codebase)
→ Verification gate (typecheck/lint/test) — server runs in-process
→ Report commit statuses on post-rebase HEAD
→ gh pr merge --squash — server runs directly (one command, no specialist)
→ Mark completed in DB queue, dequeue next
→ Post-merge lifecycle
```

### Why the WORK AGENT rebases (not in-process, not merge specialist)

1. The work agent knows the codebase — it can resolve conflicts intelligently
2. Rebasing in the agent's workspace updates its context
3. The agent can verify its own work after rebase
4. The "stuck" health badge clears because the agent is actively working
5. If conflicts arise, the agent handles them immediately — no round-trip

### Why no merge agent specialist for monorepo

After the work agent rebases and pushes, and verification passes, the actual merge is `gh pr merge --squash` — a single command with no AI reasoning. The server runs this directly.

The merge agent specialist is retained ONLY for the polyrepo path (`spawnMergeAgentForBranches`) where multiple repos need coordinated merging.

### SQLite Queue (implemented)

Persistent merge queue backed by SQLite (`merge_queue` table). Serializes merges per-project. Survives server restarts.

- `enqueueMerge(projectKey, issueId)` — returns position
- `getCurrentMerge(projectKey)` — what's currently merging
- `dequeueMerge(projectKey)` — next in line
- `resetProcessingToQueued()` — startup recovery

### Event-Driven Specialist Completion (implemented)

For remaining specialist use cases (polyrepo merge, sync-main conflict resolution):
- `waitForSpecialistCompletion(issueId, timeoutMs)` — Promise-based
- `reportSpecialistCompletion(issueId, result)` — called by /api/specialists/done

Replaces polling loops.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/database/merge-queue-db.ts` | SQLite queue operations |
| `src/lib/database/schema.ts` | merge_queue table (v14 migration) |
| `src/lib/cloister/merge-rebase.ts` | In-process rebase (fallback if work agent unavailable) |
| `src/lib/cloister/specialist-completion.ts` | Event-driven specialist completion |
| `src/dashboard/server/routes/workspaces.ts` | triggerMerge() — orchestrates the flow |
| `src/dashboard/server/routes/specialists.ts` | _serverManagedMerges (single source of truth) |

## Acceptance Criteria

1. MERGE click → work agent receives rebase message and actively works
2. Queue serializes multiple merges per-project via SQLite
3. Server restart → queue resumes from DB
4. Rebase conflicts → work agent resolves (no wasted specialist)
5. After rebase: verification → commit statuses → gh pr merge (server-side)
6. Health badge clears during merge (agent is working)
7. Polyrepo path still uses merge agent specialist via event-driven completion
