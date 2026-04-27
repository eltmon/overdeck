---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T09:51:46Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-865 adds a Zone C-1 overview surface to the Command Deck: tab strip with URL routing and keyboard navigation, an Overview tab with billboard + 9-tile grid, and Playwright visual coverage. All 4 reviewers completed. The PR is largely solid — security is clean, performance is fine, 8 of 9 requirements are met. However, 1 requirement is missing (the "Open VS Code" button calls the same endpoint as "Start Containers", not a real editor action), and 3 correctness bugs were found. The missing requirement is a Blocker by project policy: incomplete features cannot merge.

## Blockers (MUST fix before merge)

### 1. "Open VS Code" does nothing distinct from "Start Containers" — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:762-803` — `!`
**Raised by**: requirements (REQ-10 missing), correctness (warning 3)
**Why it blocks**: The issue scope explicitly requires "WORKSPACE — Start Containers / Stop / Open VS Code" as three distinct actions. The "Open VS Code" button POSTs to `/api/workspaces/${issueId}/containerize`, which is identical to what "Start Containers" does — there is no actual VS Code action wired. Code that doesn't do what was asked is a missing requirement and always blocks by policy.

<fix instruction>: Change the "Open VS Code" button to open the workspace path in VS Code. The simplest correct fix is to use a `<a href={"vscode://file/" + workspace.data?.path}>` link (which opens the local workspace in a running VS Code instance), or wire a dedicated backend endpoint if that protocol is not available. Remove the duplicate `fetch` call that hits `containerize`. If "Open VS Code" and "Start Containers" are genuinely meant to call the same backend action, rename "Open VS Code" to be accurate about what it actually does.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Services tile renders nothing when services is empty array but frontendUrl exists — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:517-560` — `~`
**Raised by**: correctness
<fix instruction>: Replace the `||` fallback with an explicit length check:
```jsx
{workspace.data?.services?.length ? (
  workspace.data.services.map((svc) => (...))
) : (
  <>
    {workspace.data?.frontendUrl && (<a>Frontend ↗</a>)}
    {workspace.data?.apiUrl && (<a>API ↗</a>)}
  </>
)}
```
The `||` fails because `[].map(...)` returns `[]` (truthy), short-circuiting the fallback — leaving the tile visually empty.

### 2. Links tile "GitHub Issue" label is wrong for Linear issues — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:814-850` — `~`
**Raised by**: correctness
<fix instruction>: The first link block unconditionally renders "GitHub Issue ↗" for any issue with a URL. For `source === 'linear'`, this produces a mislabeled link pointing to the Linear URL. Fix by checking the source:
```jsx
{issue?.url && (
  <a href={issue.url} target="_blank" rel="noopener noreferrer">
    {issue.source === 'linear' ? 'Linear' : 'GitHub Issue'} ↗
  </a>
)}
```
Then remove the separate `source === 'linear'` block below it — the first link already handles it.

## Nits (advisory — safe to defer)

- `ZoneCOverview.tsx:94` — `?` — `visibleTabs` alias is harmless but unused. `const visibleTabs = ALL_TABS;` adds a no-op alias with no filtering logic behind it yet. (performance)
- `ZoneCOverview.tsx:84-87` — `?` — `getInitialTab` is called once via useState initializer (correct React behavior), but the function reference changes every render. Non-issue, informational only — safe to ignore. (correctness)

## Cross-cutting groups

**Open VS Code wiring** (same root cause: button label doesn't match action):
- [blocker-1] "Open VS Code" and "Start Containers" call the same endpoint — missing REQ-10, must fix before merge
- [high-1] Services tile empty-array truthiness bug — same `OverviewTab.tsx` file, separate tile

## What's good
- All 8 implemented requirements fully covered with test evidence and Playwright visual snapshot
- Security review clean — no XSS, no unsafe HTML, no secrets, no new trust boundaries
- Performance review clean — no regressions, shared React Query caches reused correctly
- Keyboard navigation and URL routing both have unit test coverage and Playwright verification

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 2
- By reviewer: correctness=4 (1 blocker, 2 high, 1 nit), security=0, performance=1 (1 nit), requirements=1 (1 blocker missing)
- Files touched: 11   Files with findings: 3

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

