# PAN-79: Per-project Specialist Agents with Ephemeral Lifecycle and Persistent Logs

## Status: Planning Complete

## Problem Statement

Currently there is a single shared set of specialist agents (review-agent, test-agent, merge-agent) that handle work across all projects. This causes multiple issues:

1. **Queueing conflicts** - Multiple projects compete for the same specialist
2. **Context pollution** - Specialists accumulate context from unrelated projects
3. **Scaling bottleneck** - Only one review/test/merge at a time across ALL projects
4. **Wasted resources** - Specialists stay running even when idle
5. **Lost history** - Crash or restart loses all context
6. **No auditability** - Can't see what a specialist did on a specific run

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Project identification | Project key from `projects.yaml` | Already exists, each project has unique key (e.g., "myn", "panopticon") |
| Specialist lifecycle | Ephemeral with 60s grace period | Spawn → work → terminate. Grace period allows for batched follow-up work |
| Grace period UX | Dashboard countdown with pause/stop/exit buttons | User control over termination timing |
| Context seeding | AI-generated digest of last 5 runs | Same model as specialist (configurable). Higher quality than raw logs |
| Context depth | Default 5 runs, configurable per-project | In `projects.yaml` via `specialists.context_runs` |
| Fallback behavior | Always per-project, auto-create | No global fallback. Auto-create project specialist dirs on first use |
| Log streaming | Real-time while running, static for historical | Like watching a terminal, full history after |
| Digest model | Same as specialist (configurable) | Quality matters more than cost for context seeding |
| Dashboard log viewer | Full implementation | Real-time streaming + historical browsing |
| Log retention | Configurable per-project | Default: keep last 30 days or 50 runs, whichever is more |
| Project-specific prompts | Supported | Override specialist prompts in `projects.yaml` |

## Architecture

### Current Structure (Global Specialists)

```
~/.panopticon/specialists/
├── registry.json              # Metadata for ALL specialists
├── review-agent.session       # Single global session ID
├── test-agent.session
├── merge-agent.session
├── review-agent/history.jsonl # Single global history
├── test-agent/history.jsonl
└── merge-agent/history.jsonl
```

### New Structure (Per-Project Specialists)

```
~/.panopticon/specialists/
├── myn/                                   # Project key from projects.yaml
│   ├── config.json                        # Project-specific specialist config
│   ├── review-agent/
│   │   ├── runs/                          # Persistent run logs
│   │   │   ├── 2026-02-05T14-30-00-PAN-79.log
│   │   │   ├── 2026-02-04T10-15-00-MIN-55.log
│   │   │   └── ...
│   │   └── context/                       # AI-generated digests
│   │       └── latest-digest.md           # Summary of recent runs
│   ├── test-agent/
│   │   ├── runs/
│   │   └── context/
│   └── merge-agent/
│       ├── runs/
│       └── context/
├── panopticon/
│   └── (same structure as above)
└── registry.json                          # Global metadata + per-project entries
```

### Ephemeral Lifecycle Flow

```
1. Work queued for specialist (e.g., review requested)
        │
        v
2. Orchestrator spawns specialist
   - Create tmux session: specialist-{project}-{type}
   - Seed with AI-generated context digest from recent runs
   - Send task prompt
        │
        v
3. Specialist does work
   - Output streams to log file in real-time
   - Dashboard can tail the log
        │
        v
4. Specialist signals completion
   - Calls report-status endpoint
   - Dashboard shows "Finishing in 60s..." countdown
        │
        v
5. Grace period (60 seconds)
   - User can: Pause countdown, Stop countdown, Exit immediately
   - If new work arrives: reset countdown, process new work
        │
        v
6. Termination
   - Kill tmux session
   - Finalize log file
   - Generate digest for next run (async)
```

### Log File Format

Each run produces a structured log file:

```
# Review Agent Run - PAN-79
Project: panopticon
Started: 2026-02-05T14:30:00Z
Issue: PAN-79

## Context Seed
[AI-generated digest of recent runs was provided]

## Session Transcript
[Full Claude session output - what the agent saw, reasoned, did]

## Result
Status: passed
Notes: Code quality good, minor suggestion about error handling
Duration: 3m 42s
Finished: 2026-02-05T14:33:42Z
```

### Context Seeding

When a specialist starts, it receives an AI-generated digest:

```markdown
# Recent Review History for panopticon

## Summary
Over the last 5 reviews, common patterns include:
- TypeScript type strictness is enforced
- Tests are required for new features
- Error handling must be comprehensive

## Recent Runs

### PAN-77 (2026-02-04)
- Reviewed authentication refactor
- Noted: Good separation of concerns
- Suggested: Add rate limiting tests

### PAN-75 (2026-02-03)
- Reviewed API response formatting
- Blocked: Missing error types for new endpoints
- Resolution: Author added types, passed on re-review

[... more runs ...]
```

This digest is generated by the same model as the specialist (configurable) when the previous run completes, stored for instant access on next spawn.

## Configuration Schema

### projects.yaml additions

```yaml
projects:
  myn:
    name: "Mind Your Now"
    path: /home/user/projects/myn
    linear_team: MIN

    # NEW: Specialist configuration
    specialists:
      # Number of recent runs to include in context
      context_runs: 5

      # Model for generating context digests (null = same as specialist)
      digest_model: null

      # Log retention
      retention:
        max_days: 30
        max_runs: 50

      # Per-specialist prompt overrides
      prompts:
        review-agent: |
          You are reviewing code for the Mind Your Now project.
          Pay special attention to:
          - Database migration safety
          - API backward compatibility
          ...
```

### Registry schema update

```typescript
interface SpecialistRegistry {
  // Global defaults
  defaults: {
    contextRuns: number;     // Default: 5
    digestModel: string | null;
    retention: { maxDays: number; maxRuns: number };
  };

  // Per-project entries
  projects: {
    [projectKey: string]: {
      [specialistType: string]: {
        runCount: number;
        lastRunAt: string | null;
        lastRunStatus: 'passed' | 'failed' | 'blocked' | null;
        currentRun: string | null;  // Run ID if active
      };
    };
  };
}
```

## API Changes

### New Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /api/specialists/:project/:type/spawn` | Spawn ephemeral specialist for project |
| `GET /api/specialists/:project/:type/runs` | List run logs for project/specialist |
| `GET /api/specialists/:project/:type/runs/:runId` | Get specific run log |
| `GET /api/specialists/:project/:type/runs/:runId/stream` | SSE stream for active run |
| `POST /api/specialists/:project/:type/runs/:runId/terminate` | Force terminate active run |
| `POST /api/specialists/:project/:type/grace/pause` | Pause grace period countdown |
| `POST /api/specialists/:project/:type/grace/resume` | Resume countdown |
| `POST /api/specialists/:project/:type/grace/exit` | Exit immediately |
| `GET /api/specialists/:project/:type/context` | Get current context digest |
| `POST /api/specialists/:project/:type/context/regenerate` | Regenerate context digest |

### Modified Endpoints

| Endpoint | Changes |
|----------|---------|
| `GET /api/specialists` | Returns per-project structure, includes run counts |
| `POST /api/specialists/:name/wake` | DEPRECATED - use spawn endpoint |
| `POST /api/specialists/:name/queue` | Route to correct project based on issue prefix |

## Dashboard Changes

### Specialist View Updates

1. **Project selector** - Filter specialists by project
2. **Run history panel** - List recent runs with status badges
3. **Log viewer** - Full-page log viewer with:
   - Real-time streaming for active runs
   - Syntax highlighting
   - Search/filter
   - Download as file
4. **Grace period indicator** - Countdown timer with pause/stop/exit buttons
5. **Context preview** - Show current digest, regenerate button

### New Routes

- `/specialists/:project/:type` - Specialist detail page
- `/specialists/:project/:type/runs/:runId` - Log viewer page
- `/specialists/:project/:type/runs` - Run history list

## Files to Modify

### Core Library

| File | Changes |
|------|---------|
| `src/lib/cloister/specialists.ts` | Major refactor - per-project structure, ephemeral lifecycle |
| `src/lib/cloister/specialist-logs.ts` | NEW - Log file management, streaming, retention |
| `src/lib/cloister/specialist-context.ts` | NEW - Context digest generation and management |
| `src/lib/cloister/review-agent.ts` | Update to work with ephemeral lifecycle |
| `src/lib/cloister/test-agent.ts` | Update to work with ephemeral lifecycle |
| `src/lib/cloister/merge-agent.ts` | Update to work with ephemeral lifecycle |
| `src/lib/projects.ts` | Add specialist config types |

### API Server

| File | Changes |
|------|---------|
| `src/dashboard/server/index.ts` | Add new endpoints, SSE streaming, deprecate old wake |
| `src/dashboard/server/specialist-routes.ts` | NEW - Extract specialist endpoints to dedicated router |

### CLI

| File | Changes |
|------|---------|
| `src/cli/commands/specialists/index.ts` | Update for per-project commands |
| `src/cli/commands/specialists/logs.ts` | NEW - CLI log viewing commands |

### Frontend

| File | Changes |
|------|---------|
| `src/dashboard/frontend/src/components/SpecialistPanel.tsx` | Project selector, run history |
| `src/dashboard/frontend/src/components/SpecialistLogViewer.tsx` | NEW - Log streaming/viewing component |
| `src/dashboard/frontend/src/components/GraceCountdown.tsx` | NEW - Countdown timer with controls |
| `src/dashboard/frontend/src/pages/SpecialistDetail.tsx` | NEW - Specialist detail page |
| `src/dashboard/frontend/src/pages/SpecialistRunLog.tsx` | NEW - Log viewer page |

## Implementation Sequence

```
Phase 1: Core Infrastructure
┌─────────────────────────────────────────────────────────────┐
│ 1a. Refactor specialists.ts for per-project structure       │
│ 1b. Create specialist-logs.ts (file management, streaming)  │
│ 1c. Create specialist-context.ts (digest generation)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 2: Lifecycle Management
┌─────────────────────────────────────────────────────────────┐
│ 2a. Implement ephemeral spawn/terminate cycle               │
│ 2b. Add grace period with countdown                         │
│ 2c. Update individual agent files for new lifecycle         │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 3: API Layer
┌─────────────────────────────────────────────────────────────┐
│ 3a. Add new per-project API endpoints                       │
│ 3b. Implement SSE log streaming                             │
│ 3c. Deprecate old global endpoints (backward compat)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 4: Dashboard UI
┌─────────────────────────────────────────────────────────────┐
│ 4a. Project selector and run history panel                  │
│ 4b. Log viewer with real-time streaming                     │
│ 4c. Grace period countdown UI                               │
│ 4d. New specialist detail and log pages                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              v
Phase 5: Polish & Migration
┌─────────────────────────────────────────────────────────────┐
│ 5a. CLI commands for log viewing                            │
│ 5b. Log retention cleanup job                               │
│ 5c. Migration guide for existing users                      │
└─────────────────────────────────────────────────────────────┘
```

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No projects configured | Error: "No projects in projects.yaml. Run `pan projects add`" |
| Issue prefix not matching any project | Error: "No project found for team prefix X" |
| Active specialist when new work arrives | Queue work, will process during grace period or after current task |
| Multiple issues queued for same specialist | Process sequentially (FIFO), each gets own log file |
| Dashboard restart during active run | Reconnect to existing tmux, resume log streaming |
| System crash during run | Log file preserved, marked as incomplete, specialist auto-recovers on next spawn |
| Digest generation fails | Log warning, proceed without context (degrade gracefully) |
| Log file grows very large (stuck loop) | Cap at 10MB, truncate middle with "[... truncated ...]" |

## Out of Scope

- Cross-project specialist sharing (explicit non-goal)
- Remote/distributed specialist execution
- Specialist-to-specialist communication
- Version control for specialist prompts
- A/B testing different specialist configurations
- Historical analytics/dashboards for specialist performance

## Acceptance Criteria

- [ ] Specialists are created per-project under `~/.panopticon/specialists/{projectKey}/`
- [ ] Each specialist run produces a persistent log file in `runs/` directory
- [ ] Specialists fully terminate after completing their task (60s grace period)
- [ ] Grace period has visible countdown with pause/stop/exit controls
- [ ] Logs are viewable from dashboard UI with real-time streaming
- [ ] On startup, specialists are seeded with AI-generated context digest
- [ ] Context digest configurable (default: 5 runs, same model as specialist)
- [ ] Log retention is configurable per-project
- [ ] Project-specific prompt overrides are supported in projects.yaml
- [ ] Multiple projects can run reviews in parallel
- [ ] CLI commands available for log viewing (`pan specialists logs`)
- [ ] Old global specialist endpoints deprecated but functional

## Testing Notes

- Test parallel specialists: spawn review for myn AND panopticon simultaneously
- Test log streaming: verify real-time updates in dashboard
- Test grace period: pause/resume/exit buttons work correctly
- Test context seeding: verify digest appears in specialist prompt
- Test retention: old logs cleaned up according to config
- Test crash recovery: kill tmux mid-run, verify log preserved and recovery works
- Test project routing: issue prefix correctly routes to project specialist

## Beads Tasks

| Beads ID | Title | Difficulty | Blocked By |
|----------|-------|------------|------------|
| `panopticon-21iw` | Core infrastructure - per-project specialist structure | complex | - |
| `panopticon-2hpn` | Log file management and streaming | medium | - |
| `panopticon-d1zb` | Context digest generation | medium | - |
| `panopticon-ttwg` | Ephemeral lifecycle with grace period | complex | 21iw |
| `panopticon-n8zi` | Update individual agent files | medium | ttwg |
| `panopticon-9073` | New per-project API endpoints | medium | 21iw, 2hpn |
| `panopticon-gxjr` | SSE log streaming implementation | medium | 2hpn, 9073 |
| `panopticon-76oq` | Dashboard project selector and run history | medium | 9073 |
| `panopticon-d7rk` | Dashboard log viewer component | medium | gxjr |
| `panopticon-pz0i` | Dashboard grace period countdown | simple | 9073 |
| `panopticon-zs4z` | Dashboard specialist detail pages | medium | 76oq, d7rk |
| `panopticon-7iqa` | CLI log viewing commands | simple | 2hpn |
| `panopticon-9x4f` | Log retention cleanup job | simple | 2hpn |
| `panopticon-3pdb` | Project-specific specialist config | simple | 21iw |

**Ready to start (no blockers):**
- `panopticon-21iw` - Core infrastructure (complex)
- `panopticon-2hpn` - Log management (medium)
- `panopticon-d1zb` - Context digest (medium)

**Parallelization:**
- Phase 1: `21iw`, `2hpn`, `d1zb` can run in parallel
- Phase 2: After `21iw` → `ttwg`, `3pdb`; After `21iw` + `2hpn` → `9073`
- Phase 3: After `ttwg` → `n8zi`; After `9073` → `76oq`, `pz0i`; After `2hpn` + `9073` → `gxjr`
- Phase 4: After `gxjr` → `d7rk`; After `2hpn` → `7iqa`, `9x4f`
- Phase 5: After `76oq` + `d7rk` → `zs4z`

## References

- Issue: https://github.com/eltmon/overdeck/issues/79
- Current specialists.ts: `src/lib/cloister/specialists.ts`
- Projects config: `src/lib/projects.ts`
- PAN-80 (hook-based status): Related lifecycle patterns
