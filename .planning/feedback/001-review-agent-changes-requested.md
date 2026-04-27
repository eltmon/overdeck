---
specialist: review-agent
issueId: PAN-455
outcome: changes-requested
timestamp: 2026-04-27T09:50:43Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-455 implements a system health monitoring subsystem (backend service, API endpoint, frontend pill component, and pre-spawn guardrails) targeting the dashboard header health indicator requirement. The implementation covers 8 of 17 stated requirements, but 6 requirements are missing entirely (including kill buttons, config.yaml support, cache TTL, domain events, Panopticon contribution metric, and Playwright verification), and 3 are only partially implemented. This is a partial delivery — the feature cannot be merged as-is.

## Blockers (MUST fix before merge)

### 1. Kill buttons missing for specialist and container rows — `src/dashboard/frontend/src/components/SystemHealthPill.tsx:27-31` — `!`
**Raised by**: requirements
**Why it blocks**: Users cannot clean up leaked specialists or Docker containers from the indicator itself, which was a core incident-response goal stated in the issue AC.

Each breakdown row must have a kill/cleanup action. Currently, kill buttons are disabled for `consumer.type === 'container'` and for specialist IDs (which don't start with `agent-`). The fix must enable kill actions for all supported consumer types — specialist sessions and containers included.

### 2. Toast click does not pre-select leaked specialists — `src/dashboard/frontend/src/components/SystemHealthPill.tsx:59-62` — `!`
**Raised by**: requirements
**Why it blocks**: The critical toast opens the panel but leaves the user to manually scan the list for leaked specialists. The issue AC requires the toast click to open the expanded breakdown with leaked specialists pre-selected.

Current code only calls `setOpen(true)` with no selection or filtering state.

### 3. Threshold configuration ignores config.yaml and uses wrong env var names — `src/dashboard/server/services/system-health-service.ts:143-153`, `src/dashboard/server/routes/agents.ts:227` — `!`
**Raised by**: requirements
**Why it blocks**: The issue AC promises configurable thresholds via `~/.panopticon/config.yaml` with env var overrides. None of the changed files read `config.yaml` for a `resources:` block, and the env vars used (`PAN_HEALTH_*`) don't match the requested names (`PAN_MEMORY_WARN_GB`, `PAN_MEMORY_BLOCK_GB`, `PAN_AGENT_WARN_COUNT`, `PAN_AGENT_BLOCK_COUNT`).

The implementation must support both config surfaces with env vars winning, matching the documented contract.

### 4. Cache TTL is 10s, not the requested 15–30s, and no domain event on severity transitions — `src/dashboard/server/services/system-health-service.ts:13` — `!`
**Raised by**: requirements
**Why it blocks**: The issue AC specifies 15–30s server-side cache and a domain event on severity transitions. Currently `CACHE_TTL_MS = 10_000` (10s) and no event is emitted anywhere in the health pipeline.

The cache window must be moved into the 15–30s range, and a severity-transition domain event must be appended when the health severity changes.

### 5. No Panopticon contribution metric in health summary — `src/dashboard/server/services/system-health-service.ts:84-103`, `src/dashboard/frontend/src/components/SystemHealthPill.tsx:124-156` — `!`
**Raised by**: requirements
**Why it blocks**: The issue scope requires showing how much of total resource pressure comes from Panopticon-managed processes. Currently only system totals and per-consumer rows are shown — no aggregate Panopticon memory/CPU percentage or absolute figure.

The snapshot summary and UI must expose an aggregate Panopticon-managed contribution metric so users can answer "how much of this pressure is Panopticon vs. everything else?" at a glance.

### 6. No Playwright verification artifact for required UI flows — not in a specific file — `!`
**Raised by**: requirements
**Why it blocks**: The issue AC explicitly requires "Visual verified with Playwright across header presence, expanded panel, kill action, threshold crossings." The current test coverage is limited to Vitest unit tests for `SystemHealthPill` and integration tests for guardrail logic — no Playwright-level behavioral verification exists for the required UI flows.

A Playwright test artifact covering the four specified flows (header presence, expanded panel, kill action, threshold crossings) must be added.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Per-agent tmux polling makes `/api/system/health` scale linearly with agent count — `src/dashboard/server/services/system-health-service.ts:328` — `~`
**Raised by**: performance
The health endpoint performs O(A × P) work on every refresh: one tmux subprocess call per active agent plus a full process-table descendant scan per agent. On hosts with many workspaces, this creates measurable CPU and I/O overhead.

Batch the pane-PID lookup into a single `tmux list-panes -a` call, build the parent→children adjacency map once from `ps`, and walk the process tree once per root without rescanning.

### 2. Work-agent warn threshold hardcoded as block-1 instead of separate config — `src/dashboard/server/routes/agents.ts:227-229` — `~`
**Raised by**: correctness, requirements
The implementation uses `hardWorkAgentLimit - 1` for the warn threshold instead of a distinct `PAN_AGENT_WARN_COUNT` value. The issue AC calls for separate warn/block counts. While this is related to the blocker on config.yaml support, it independently needs a distinct warn threshold constant with its own env var.

### 3. Memory threshold uses `<=` inclusive boundary instead of `<` — `src/dashboard/server/routes/agents.ts:230`, `src/dashboard/server/services/system-health-service.ts:291` — `~`
**Raised by**: correctness
If available memory exactly equals the critical threshold, the block triggers immediately rather than only when memory drops below the threshold. Document that thresholds are inclusive boundaries, or clarify the intended semantics.

### 4. `PAN_HEALTH_MAX_WORK_AGENTS` NaN fallback silently disables the guardrail — `src/dashboard/server/routes/agents.ts:227` — `~`
**Raised by**: correctness
If the env var is set to an empty string or non-numeric value, `Number('')` returns `0` and `Number('abc')` returns `NaN`. The guardrail check `workAgentCount >= NaN` evaluates to `false`, disabling the limit silently. Add explicit `Number.isFinite` validation.

### 5. Module-level mutable state accumulates across server lifetime — `src/dashboard/server/services/system-health-service.ts:111-115` — `~`
**Raised by**: correctness
`previousCpuSample` accumulates across the server's lifetime with no reset mechanism. After very long idle periods, CPU delta calculations may produce stale readings. Consider resetting `previousCpuSample` when the gap between calls exceeds the TTL.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/SystemHealthPill.tsx:54` — `?` — Toast only fires for `→ critical` transitions, not `→ warning`. User won't be notified until state reaches critical. Consider also firing for `normal → warning` with a longer duration threshold.
- `src/dashboard/frontend/src/hooks/useSystemHealth.ts:5-6` — `?` — Error message discards HTTP status code and response body. Helpful 500-body text is lost. Use `throw new Error(\`Failed to fetch system health (\${res.status}): \${body}\`)` with `.catch(() => '')` fallback.
- `src/dashboard/frontend/src/components/SystemHealthPill.tsx:66-69` — `?` — `leakedFirstConsumers` depends on `[data]` but only uses `data.topConsumers`. Use `[data?.topConsumers]` to avoid unnecessary recomputation when other `data` fields change.
- `src/dashboard/server/services/system-health-service.ts:207-226` — `?` — `ps comm=` truncates command names to 15 chars on Linux. Consider using `args=` for better agent process identification in the process table output.
- `src/dashboard/frontend/src/components/SystemHealthPill.test.tsx:98-121` — `?` — No test for `normal → warning` transition (no toast expected). Adding it documents the intended behavior and catches regressions if warning-level toasts are later added.

## Cross-cutting groups

**Incomplete health indicator feature (root cause: partial implementation against the full AC)**:
- [blocker-1] Kill buttons missing for specialist and container rows
- [blocker-2] Toast click doesn't pre-select leaked specialists
- [blocker-3] No config.yaml support, wrong env var names
- [blocker-4] Cache TTL 10s not 15-30s, no domain event on transition
- [blocker-5] No Panopticon contribution metric
- [blocker-6] No Playwright verification artifact
- [high-2] Work-agent warn threshold hardcoded as block-1

**Performance scaling (root cause: per-agent tmux polling in hot path)**:
- [high-1] Per-agent tmux polling O(A×P) on every health poll

## What's good
- Async-only server implementation using `execAsync` and `readFile` with no `execSync`/sync-FS introduced in health service
- Leaked specialist detection logic correctly compares active specialists against running work agents by uppercased issue IDs
- Pre-spawn guardrail tests in `agents-guardrails.test.ts` cover critical RAM, high work-agent count, and leaked-specialist escalation paths
- System health pill correctly uses Zustand store and memoization, avoiding unnecessary re-renders
- No security vulnerabilities found across 16 reviewed files
- Green/yellow/red severity states correctly map to visual styling, and critical toast fires one-time per crossing (not repeatedly)

## Review stats
- Blockers: 6   High: 5   Medium: 0   Nits: 5
- By reviewer: correctness=4, security=0, performance=1, requirements=6
- Files touched: 17   Files with findings: 11

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-455 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

