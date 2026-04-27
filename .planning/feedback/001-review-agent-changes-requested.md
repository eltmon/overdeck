---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T12:19:15Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-865 implements the Zone C-1 tab strip skeleton and Overview tab (billboard + tile grid) for the Command Deck. All 9 requirements are implemented and verified; security review found no vulnerabilities. However, three high-priority findings require fixes before merge: (1) ZoneA's tab-switch action buttons are dead code — clicking them does nothing, (2) the Spawn Work button lacks click protection and can spawn duplicate agents, and (3) the session-tree merge logic eagerly clones every sessions array, defeating its own shallow-identity rerender optimization. Two medium-priority suggestions are deferred as nits.

## Blockers (MUST fix before merge)

_ none _

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. ZoneA tab-switch buttons are dead code — silently no-op — `IssueWorkbench.tsx:70-74` — `~`
**Raised by**: correctness
**Why it blocks**: Users see interactive buttons that produce no response when clicked — a broken UI interaction that cannot wait for a follow-up bead.

<fix instruction>
The `handleSwitchTab` callback discards its tab argument and does nothing. Lift tab state to IssueWorkbench and pass `activeTab`/`onTabChange` down to both ZoneA and ZoneCOverview:

```typescript
const [activeTab, setActiveTab] = useState<OverviewTab>('overview');

// In ZoneA props:
<ZoneA ... onSwitchTab={setActiveTab} />

// In ZoneCOverview props:
<ZoneCOverview
  issueId={issueId}
  issue={issue}
  agent={agent}
  activeTab={activeTab}
  onTabChange={setActiveTab}
/>
```

ZoneCOverview currently manages tab state internally. Accept the prop and remove the internal `useState` for `activeTab` while keeping URL sync behavior.
</fix instruction>

### 2. Spawn Work button has no click protection or error feedback — `OverviewTab.tsx:446-451` — `~`
**Raised by**: correctness
**Why it blocks**: Rapid clicks can create duplicate agents; user gets no feedback on success or failure.

<fix instruction>
Add a pending state guard, matching the pattern already used in this file for `isRecoverPending` (lines 213, 660):

```typescript
const [isSpawnPending, setIsSpawnPending] = useState(false);
// ...
onClick={async () => {
  if (isSpawnPending) return;
  setIsSpawnPending(true);
  try {
    await fetch(`/api/agents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issueId }) });
  } catch { /* non-fatal */ }
  finally { setIsSpawnPending(false); }
}}
disabled={isSpawnPending}
```
</fix instruction>

### 3. Session-tree merge clones every sessions array — defeats shallow-identity optimization — `index.tsx:268` — `~`
**Raised by**: performance
**Why it blocks**: Because `[...]` always creates a fresh array, `treeSessions === feature.sessions` is never true for sessions-bearing features. Every matching feature is recreated on every session-tree fetch, causing unnecessarily broad React rerenders.

<fix instruction>
Remove the eager clone on line 25 — keep the original reference so the identity check succeeds:

```typescript
// Before (line 25):
featureSessions.set(feature.issueId.toLowerCase(), [...feature.sessions]);

// After:
featureSessions.set(feature.issueId.toLowerCase(), feature.sessions);
```
</fix instruction>

## Nits (advisory — safe to defer)

- `OverviewTab.tsx:509-558` — `?` — Services tile edge case: when `services` is a non-empty array where all URLs are `undefined`, the user sees an empty tile with no links and no "No services configured" message. Consider a consistent empty-state branch.
- `OverviewTab.tsx:897-898` — `?` — Test status display uses `||` to check both `testStatus` and `verificationStatus` — if one passes and one fails, display shows "Tests passed" which may be misleading. Confirm whether "any pass = pass" is the intended semantic.
- `queries.ts:103` — `?` — Overview tab mounts 6+ independently polled queries; if users commonly keep several issue workbenches open, a consolidated summary endpoint could reduce fan-out. (performance, not blocking)
- `OverviewTab.tsx:446-451` — `?` — Additionally consider adding a visible loading state (spinner or label change) while the spawn is in-flight so the user knows their click registered.

## Cross-cutting groups

**Command Deck tab wiring** (related findings that share a root cause — fix together):
- [high-1] ZoneA tab-switch buttons dead code — same root cause as the missing `activeTab`/`onTabChange` prop threading to ZoneCOverview

## What's good

- Security review found zero vulnerabilities — no injection, XSS, access-control regressions, or unsafe file/shell paths introduced.
- All 9 stated requirements for PAN-865 are implemented and verified, including Playwright visual snapshot.
- Good null-safety patterns throughout (optional chaining, nullish coalescing) and proper TypeScript typing.
- Server route changes stay within existing surfaces; no scope creep.

## Review stats

- Blockers: 0   High: 3   Medium: 0   Nits: 4
- By reviewer: correctness=4, security=0, performance=2, requirements=0
- Files touched: 17   Files with findings: 3
  - `IssueWorkbench.tsx` — 1 high (tab-switch no-op)
  - `OverviewTab.tsx` — 1 high (spawn no guard) + 2 nits (services edge, testStatus OR)
  - `index.tsx` — 1 high (session-tree clone)

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

