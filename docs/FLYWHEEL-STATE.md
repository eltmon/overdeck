# Flywheel State — Run 2026-05-09

## Active Pipeline

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|---|---|---|---|---|---|
| PAN-1024 | In Progress | — | — | — | Lazy-load per-turn diff summaries |
| PAN-1027 | In Progress | merge-status drift: deacon sets mergeStatus=merged without postMergeLifecycle | — | — | Bug filed |
| PAN-1029 | In Review | Harness picker UI missing (backend shipped, no dashboard surface) | — | — | PAN-636 backend shipped |
| PAN-1030 | In Review | INPUT indicator missing from kanban/command deck | — | — | |
| PAN-1031 | In Progress | Missing Tests cycle counter + Sync action in InspectorPanel | — | — | PAN-954 follow-on |
| PAN-1034 | Done (merged) | N/A | — | — | Fixed: coordinator API routing + atomic reviewedAtCommit |
| PAN-1035-PAN-1043 | Various | Many issues with no workspace activity | — | — | Stale workspaces |
| PAN-1044 | In Progress | Command Deck: Project Overview Panel with pipeline swimlanes | — | — | |
| PAN-1048 | Planning | Unify agent type system | — | — | Architecture |
| PAN-1052 | Todo | Activity feed feature | — | — | |

## Cycling Alerts

None.

## Infrastructure Gaps

| Gap | Severity | Notes |
|---|---|---|
| Test-agent MiniMax auth failure | High | `spawnEphemeralSpecialist` for test-agent fails with auth error; needs API key fix or model override |
| Specialist paste verification failure causing coordinator hangs | High | PAN-1034 review coordinator hangs indefinitely when specialist output paste verification fails; coordinator has no timeout guard for individual specialists |
| Merge status drift (PAN-1027) | Medium | deacon auto-detect paths set mergeStatus=merged without calling postMergeLifecycle |

## Pattern Ledger

| Failure Signature | Root Cause | Fix Applied |
|---|---|---|
| Coordinator hangs after "Paste verification failed" | `sendKeysAsync` verification fails for long output; coordinator has no per-specialist timeout; waits forever for output file | Not fixed — needs coordinator timeout per specialist |
| `reviewedAtCommit` null despite review passing | API route set reviewStatus='passed' in one call, then reviewedAtCommit in a second call — test-agent dispatch fires before snapshot is set | Fixed: snapshot atomically in same setReviewStatus call |
| Test-agent not dispatching after review passes | `pan review run` CLI exits before async IIFE in setReviewStatus runs | Fixed: coordinator calls dashboard API instead of direct setReviewStatus |
| Specialists not spawning (PAN-1034 root cause) | `createSessionAsync` creates empty tmux sessions without running launcher | Fixed (prior session): use execAsync tmux new-session pattern |

## Skill Gaps

| Desired Capability | Priority |
|---|---|
| Per-specialist timeout in coordinator with graceful abort | High |
| Dashboard surface for harness picker (PAN-1030/PAN-636) | High |
| Auto-cleanup of workspaces with no agent activity > 1 week | Medium |
