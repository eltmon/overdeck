---
specialist: review-agent
issueId: PAN-455
outcome: commented
timestamp: 2026-04-27T11:05:45Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-455 implements system health monitoring: a dashboard health pill, leaked-specialist detection, and spawn guardrails. The core telemetry and aggregation logic is solid, but the PR has 6 blockers — 5 are missing requirements (wrong placement, no pulsing, missing overcommit display, missing poll interval) and 1 is a critical performance regression (sync filesystem calls on a polled request path that violates CLAUDE.md's no-blocking-calls rule). Additionally, spawn guardrails return warnings after the agent starts rather than requiring pre-spawn acknowledgement as the issue specifies.

## Blockers (MUST fix before merge)

### 1. Health pill renders in sidebar footer instead of header/top-nav — `Sidebar.tsx:219,298` — `!`
**Raised by**: requirements
**Why it blocks**: Requirement states "always-visible bar/pill in the top navigation area ... visible in dashboard header on every route." Sidebar footer is not the header; users lose the requested always-in-sight signal.

Fix: Move `SystemHealthPill` rendering to the header/top-nav surface (the shared shell above the sidebar) rather than the sidebar footer. The pill must be in the top-nav bar used across all dashboard tabs.

### 2. Critical state has no pulsing animation — `SystemHealthPill.tsx:18-22` — `!`
**Raised by**: requirements
**Why it blocks**: Requirement explicitly asks for "red-pulsing pill that catches peripheral vision." The current implementation only changes colors — no pulse class, animation, or motion.

Fix: Add a pulsing CSS animation (or conditional animation class) to the pill when `severity === 'critical'`. This is the most important alert state and must be visually prominent as specified.

### 3. Overcommit ratio absent from expanded breakdown — `SystemHealthPill.tsx:202-229` — `!`
**Raised by**: requirements
**Why it blocks**: Issue documents memory overcommit as a crash root cause and explicitly requires "System overcommit ratio if detectable." The `overcommitPercent` field exists in `types.ts:289` and `system-health-service.ts:466` but is never rendered.

Fix: Add `overcommitPercent` to the CPU/memory block in the expanded dropdown panel.

### 4. `PAN_HEALTH_POLL_SECONDS` env var not wired — `system-health-service.ts:16` — `!`
**Raised by**: requirements
**Why it blocks**: Issue scope explicitly names this configuration knob. The 15s cache TTL is hard-coded with no env override path.

Fix: Read `process.env['PAN_HEALTH_POLL_SECONDS']` (or a config-backed default) for the cache TTL instead of hard-coding `15_000`.

### 5. Spawn guardrails warn after start instead of requiring pre-spawn acknowledgement — `agents.ts:1658-1670` — `!`
**Raised by**: requirements
**Why it blocks**: Issue requirement: "force the user to acknowledge [warnings]." Currently, guardrail warnings are returned in the start response after the spawn succeeds, so the user is informed but not blocked or forced to acknowledge before the agent starts.

Fix: Evaluate guardrails before spawning. If warnings exist, return a preflight response that blocks the spawn and requires explicit user confirmation to proceed. The current flow cannot be changed to "acknowledge before" without a behavioral redesign of the start-agent response shape.

### 6. Blocking config I/O on polled request path — `system-health-service.ts:165` — `⊗`
**Raised by**: performance
**Why it blocks**: `getResourceConfig()` calls `loadConfig()` which uses synchronous filesystem calls (`existsSync`, `statSync`) in `config-yaml.ts`. This path now runs on every health poll (every 15s per connected client). CLAUDE.md: "NEVER use `execSync`, `readFileSync`, `writeFileSync`, `readdirSync`, or `statSync` in any code reachable from the dashboard server." This is a direct violation and blocks merge.

Fix: Cache resource thresholds in memory. Refresh the cache via an async invalidation path (file watcher or TTL-based background refresh) rather than re-reading sync filesystem calls on each request. The request path must never block the Node.js event loop.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. In-place `.sort()` mutates `agents` array — `system-health-service.ts:511-513` — `~`
**Raised by**: correctness
**Impact**: Maintenance trap — if either sort comparator changes independently, `agents` in the result object and `topConsumers` will have different orderings.

Fix: Replace the in-place sort with a spread copy:
```typescript
const sortedAgents = [...agents].sort((a, b) => b.memoryBytes - a.memoryBytes);
```

### 2. Per-agent tmux/runtime fan-out on every health refresh — `system-health-service.ts:364-377` — `~`
**Raised by**: performance
**Impact**: O(N) tmux/runtime calls per health refresh. With N active agents and multiple dashboard tabs, this adds up. The 15s server cache helps but the sidebar pill makes this always-on.

Fix: Keep agent/process metrics in a background sampler; serve cached snapshots to the UI. If per-agent detail is required, split the always-visible pill (aggregate only) from the detailed view (on-demand).

### 3. Leaked-specialist severity uses `<=` vs `<` for memory threshold — `agents.ts:2093` — `~`
**Raised by**: correctness
**Impact**: At exactly the critical threshold, leaked specialists escalate to `critical` while the memory-pressure warning itself would not fire. Semantically inconsistent (narrow edge case).

Fix: Change `<=` to `<` for consistency with the memory-pressure guardrail on line 2058.

## Nits (advisory — safe to defer)

- `system-health-service.ts:131-136` — `?` — Module-level mutable state for cache/CPU/event-store. Encapsulate in a class or factory for testability. Low priority. (correctness)
- `SystemHealthPill.tsx:33` — `?` — `useKillAgent` called with `undefined` for non-agent kill targets. Restructure to avoid unused hook overhead. (correctness)
- `SystemHealthPill.tsx:141` — `?` — Client re-sorts `topConsumers` that server already sorted. Server can emit leaked-first order directly. (performance)
- `CommandDeck/index.tsx:36-40` et al — `?` — `StartAgentResponse` interface duplicated across 5 frontend files. Extract to `types.ts`. (correctness)
- `agents-guardrails.test.ts` — `?` — Test file added in PR scope. Suggest ensuring test file follows same no-sync-calls rule in test context. (correctness)

## Cross-cutting groups

**Config loading as a shared problem:**
All blocking sync I/O originates from `loadConfig()` → `getConfigMtimes()`. The `getResourceConfig()` function in the health service calls this on every poll. Fixing the cache for the health service will also fix the root cause for any other caller. The module-level mutable state for caching (correctness nit) and the blocking I/O (performance blocker) share the same solution: an async-safe config cache with background invalidation.

**Spawn guardrail flow:**
REQ-13 (post-spawn vs pre-spawn) and the guardrail test coverage (REQ-10) are the same root cause. The start-agent endpoint currently evaluates guardrails and then spawns regardless. To satisfy the "force acknowledgement before spawn" requirement, the endpoint needs a preflight mode or two-phase start (evaluate → return warnings → require explicit confirm → spawn).

## What's good
- System health telemetry collection is thorough: `/proc/meminfo`, load/CPU via `/proc/stat`, swap, Docker containers, agent tmux pane values — all properly async.
- Leak detection logic correctly identifies specialists whose parent agent is gone by comparing dashboard snapshot against active work agents.
- Domain events on severity transitions (`system.health_severity_changed`) are properly wired with idempotency guards.
- Spawn guardrail coverage tests are comprehensive — low-RAM blocking, capacity limits, leaked-specialist escalation all have test cases.
- The frontend health pill popover is well-structured with kill affordances for agents, specialists, and containers.

## Review stats
- Blockers: 6   High: 3   Medium: 0   Nits: 5
- By reviewer: correctness=3, security=0, performance=2, requirements=6
- Files touched: 30   Files with findings: 13

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

