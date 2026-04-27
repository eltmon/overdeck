---
specialist: review-agent
issueId: PAN-895
outcome: changes-requested
timestamp: 2026-04-27T23:49:10Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-895 unifies cost display across Zone A and the Overview tab by extracting cost resolution into a shared `issue-cost-resolver.ts` service wired into both the activity and costs endpoints. All 3 stated requirements are fully implemented and verified. However, 2 Tier-1 static correctness issues remain: a dead code branch in `formatCost` (`IssueHeader.tsx:161-165`) that returns identical output for all `cost >= 0.01` values, and a nullish-coalescing precedence gap in the Overview cost fallback chain (`OverviewTab.tsx:226-229`) that causes the endpoint's explicit "no cost data" signal (`resolvedTotalCost: null`) to be overridden by stale activity data. Additionally, a shared constant (`LIVE_AGENT_STATUSES`) hardcodes live-agent status strings that could silently desync from `AgentSnapshot` as new statuses are introduced.

## Blockers (MUST fix before merge)

### 1. Dead `formatCost` branch — `IssueHeader.tsx:161-165` — `~`
**Raised by**: correctness

**Why it blocks**: The second and third branches of `formatCost` return the identical string (`$X.XX`), making the `< 1` branch dead code that suggests incorrect intent. Combined with the cost fallback precedence gap below, two separate correctness issues affect the same displayed value.

```typescript
function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  if (cost < 1) return `$${cost.toFixed(2)}`;  // dead — same output as return below
  return `$${cost.toFixed(2)}`;
}
```

**Fix** — collapse the dead branch:
```typescript
function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01';
  return `$${cost.toFixed(2)}`;
}
```

### 2. Cost fallback precedence gap — `OverviewTab.tsx:226-229` — `~`
**Raised by**: correctness

**Why it blocks**: When the costs endpoint responds with `resolvedTotalCost: null` (explicit "no data" signal), the `??` operator treats it identically to "not yet loaded" (`undefined`) and falls through to the activity endpoint. If activity holds a stale non-null value, the Overview tab shows the stale number instead of respecting the authoritative costs endpoint signal.

```typescript
const totalCost = costs.data?.resolvedTotalCost
  ?? (costs.isError ? activity.data?.resolvedTotalCost : undefined)  // null fires ?? — falls through
  ?? (!activity.isLoading ? activity.data?.resolvedTotalCost : undefined)
  ?? null;
```

**Fix** — distinguish `null` (explicit signal) from `undefined` (not yet loaded):
```typescript
const totalCost = costs.data?.resolvedTotalCost !== undefined
  ? costs.data.resolvedTotalCost
  : !activity.isLoading
    ? activity.data?.resolvedTotalCost ?? null
    : null;
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `LIVE_AGENT_STATUSES` drifts from `AgentSnapshot` — `issue-cost-resolver.ts:15` — `?`
**Raised by**: correctness (suggestion)

**Why it matters**: A hardcoded `Set(['starting', 'running'])` duplicates status string literals from `AgentSnapshot`. If a new live status (e.g., `'healthy'`, `'resuming'`) is added to `AgentSnapshot` without updating this set, live cost undercounting silently starts.

**Fix** — derive from `AgentStatus` type or import from shared constants:
```typescript
import { AgentStatus, LIVE_AGENT_STATUSES } from '../../../../contracts';
// or inline:
const LIVE_AGENT_STATUSES = new Set<AgentStatus>(['starting', 'running']);
```

### 2. `totalCost ?? 0` discards `null` signal — `command-deck.ts:562` — `?`
**Raised by**: correctness (suggestion)

**Why it matters**: The `totalCost` field coerces `null` (no cost data) to `0`, making it indistinguishable from "cost is genuinely zero" for any consumer that reads `totalCost` instead of the separately-returned `resolvedTotalCost`.

**Fix** — either remove the `?? 0` fallback, or document that `totalCost` is a convenience field where `0` means "no data or zero" and consumers should read `resolvedTotalCost` for the authoritative value.

## Nits (advisory — safe to defer)

- `IssueHeader.tsx:170` — `?` — Full planning payload polled for header chrome. The overview tab was already optimized to `usePlanningSummaryQuery`; the remaining header poll is an overfetch opportunity. Not a regression — defer or track separately. (performance)
- `OverviewTab.tsx:202-209` — `?` — `formatRuntime` shows "0m" for agents running < 60 seconds. Consider showing seconds during the first minute. (performance)

## Cross-cutting groups

**Cost display wiring** (all findings related to how cost values flow from resolver → endpoints → frontend):
- [blocker-1] dead `formatCost` branch
- [blocker-2] cost fallback precedence gap
- [high-1] `LIVE_AGENT_STATUSES` drift risk
- [high-2] `totalCost ?? 0` discards null signal
- [nit-1] `formatRuntime` "0m" display

Fix together to ensure consistent cost display behavior across Zone A and Overview.

## What's good
- All 3 stated acceptance criteria are implemented and verified by the requirements reviewer.
- No security issues found — command execution uses `execFileAsync` with no shell interpolation, no XSS sinks introduced.
- New `issue-cost-resolver.ts` service properly normalizes zero/non-positive costs to `null` rather than `0`.
- TTL-cached cost scan and summary-mode queries represent genuine performance improvements.
- Test coverage added for unified-cost fallback behavior (`ZoneCOverview.test.tsx`).

## Review stats
- Blockers: 2   High: 2   Medium: 0   Nits: 2
- By reviewer: correctness=2, security=0, performance=0, requirements=0
- Files touched: 11   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-895 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

