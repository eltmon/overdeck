---
specialist: review-agent
issueId: PAN-862
outcome: changes-requested
timestamp: 2026-04-27T15:43:32Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-862 adds a resource-discovery service, a `GET /api/issues/resource-allocated` endpoint, and a Command Deck icon strip showing resource allocation state per issue row. The feature is substantially implemented (6 of 7 requirements met), but there is 1 **Blocker** (a guaranteed React crash in the ResourceStrip component) and 1 **High** issue (inconsistent session-selection logic that will misbehave for suspended sessions). Both must be fixed before merge. Additionally, the benchmark evidence for the < 1s discovery performance criterion is borderline (1261ms measured vs 1000ms target), which is surfaced as a High issue to resolve.

## Blockers (MUST fix before merge)

### 1. Rules of Hooks violation — guaranteed React crash — `FeatureItem.tsx:124` — `!`
**Raised by**: correctness
**Why it blocks**: `ResourceStrip` calls `useState` twice (lines 119–120), then returns early at line 124 when `resources.length === 0` before calling `useEffect` (line 126) and `useMemo` (line 151). When a feature transitions from 0 → N resources (e.g., workspace created between 30-second refetches), React detects a hook-count mismatch and throws an invariant violation. No error boundary exists in the Command Deck component tree, so the crash unmounts the entire panel.

Fix: Move all hook calls above the early return, or restructure to always call the same hooks. The fix pattern is:

```tsx
function ResourceStrip({ feature, onCleanupOrphanedResources }) {
  const resources = RESOURCE_ICON_ORDER.filter(...);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [detailIdentifiers, setDetailIdentifiers] = useState(null);
  const details = feature.resourceDetails;

  // ALL hooks above the early return
  useEffect(() => {
    if (resources.length === 0) return;
    if (!popoverOpen) return;
    // ... rest of effect
  }, [popoverOpen, details, feature.issueId, detailIdentifiers, resources.length]);

  const resourceRows = useMemo(() => {
    if (resources.length === 0) return [];
    // ... row building logic
  }, [details, detailIdentifiers, resources.length]);

  if (resources.length === 0) return null;  // ← AFTER all hooks

  return (...);
}
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Inconsistent `pickBestSession` — `index.tsx:85` vs `FeatureItem.tsx:436` — `~`
**Raised by**: correctness
**Why it matters**: Two independent copies exist. `index.tsx` uses `{ active: 0, idle: 1, ended: 2 }` — missing `suspended`. `FeatureItem.tsx` uses `{ active: 0, idle: 1, suspended: 2, ended: 3 }`. When a session has `presence: 'suspended'`, the sidebar's `handleSelectFeature` and `FeatureItem`'s `handleRowClick` will select different sessions.

Fix: Remove the duplicate in `index.tsx` and import from `FeatureItem.tsx`:
```typescript
// index.tsx
import { pickBestSession } from './ProjectTree/FeatureItem';
```
Or extract to a shared utility.

### 2. Benchmark borderline — `resource-discovery.bench.ts` — `~`
**Raised by**: requirements
**Why it matters**: The acceptance criterion requires "< 1s for current workload (28 worktrees, 124 branches)". The PR added a benchmark asserting 1000ms, but the review command measured 1261ms — 26% over the target. The benchmark guard exists and is wired into CI, but the ceiling is not consistently met.

Fix: Investigate why the measurement environment is slow (cold filesystem cache, other I/O contention) and either tune the benchmark ceiling to a realistic threshold for that environment, or optimize the discovery code to be more consistent. Provide a passing measurement from the target workload before merging.

## Nits (advisory — safe to defer)

- `resource-discovery.ts:529` — `?` — `Date.parse` result not validated. `NaN` can propagate into the issue map. Low risk since downstream guards exist. (correctness)
- `FeatureItem.tsx:118` — `?` — `ResourceStrip` not guarded against `undefined` `resourceSources`. Defensive improvement; low risk with existing optional chaining. (correctness)
- `issues.ts:3077` — `~` (best practice) — Infrastructure identifiers (workspace paths, tmux session names, container names) exposed to frontend via `GET /api/issues/:id/resource-details`. The endpoint is opt-in/hover-triggered, not a passive leak, but the richer host-level recon surface is worth noting. Consider redact to basename-only or opaque IDs in a follow-up. (security)

## Cross-cutting groups

**ResourceStrip component** (same component, same session, fix together):
- [blocker] Rules of Hooks violation — early return before useEffect/useMemo
- [high] Inconsistent `pickBestSession` — separate copy in `index.tsx` vs `FeatureItem.tsx:436`
- [nit] `Date.parse` not validated at line 529 (same file)
- [nit] `resourceSources` not guarded at line 118 (same file)

## What's good
- 6 of 7 requirements fully implemented; REQ-5 (hover popover) is complete and well-tested.
- N+1 prevention is solid — `Promise.all` for batch loading, single discovery pass per refresh, shared cache consumed by both routes.
- Benchmark guard added and wired into CI — the infrastructure is there, just needs to pass reliably.
- Security: no credentials or PII in the new endpoint, and the hover-triggered fetch pattern limits exposure.

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 2
- By reviewer: correctness=4, security=1, performance=0, requirements=1
- Files touched: 22   Files with findings: 6

## Appendix: individual reviews
See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-862 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

