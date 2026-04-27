---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T11:34:13Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-865 implements the Zone C overview tab skeleton: a 10-tab strip with Overview as default, a billboard + tile grid + summaries + trend strip in the Overview tab, URL-backed tab state, sticky positioning, keyboard navigation, and full issue-selected vs agent-selected wiring. The PR delivers 8 of 9 stated requirements; all review disciplines are otherwise clean. Three findings reach blocker threshold: a WAI-ARIA keyboard navigation violation (Tab key traps focus inside the tab strip), a TypeScript type safety gap in `projects.ts` (`roundMetadata` on `ActivitySection` interface), and the AGENT tile omitting the explicitly-scoped "runtime" field. The work agent must address all three before merge.

## Blockers (MUST fix before merge)

### 1. Tab key traps keyboard focus inside tab strip — `ZoneCOverview.tsx:172-176` — `~`
**Raised by**: correctness
**Why it blocks**: Keyboard-only and screen-reader users cannot Tab past the tab strip to reach the overview content, reviewer grid, or action buttons — the tab panel is unreachable via keyboard. This is a WAI-ARIA tabs pattern violation.

<fix instruction>
Remove the `Tab`/`Shift-Tab` key handler at lines 172-176. Rely on `ArrowLeft`/`ArrowRight` (already correctly implemented at lines 160-169) for tab cycling. Standard `Tab` behavior will then move focus into the tab panel content. The WAI-ARIA tabs pattern requires `ArrowLeft`/`ArrowRight` to cycle tabs and `Tab` to move focus from the active tab to the tab panel — not to cycle tabs.
</fix>

### 2. `ActivitySection` interface missing `roundMetadata` field — `projects.ts:69-82` — `~`
**Raised by**: correctness
**Why it blocks**: `mapSectionToSessionNode()` at line 111 accesses `section.roundMetadata` but the local `ActivitySection` interface does not declare it, creating a TypeScript type safety gap. If the source data ever removes `roundMetadata`, the compiler will not catch the regression.

<fix instruction>
Add `roundMetadata?: ReviewerRoundMetadata` to the local `ActivitySection` interface in `projects.ts`. Import `ReviewerRoundMetadata` from `./reviewer-tree.js` or `./command-deck.js`. The field is already present in the identical interface in `command-deck.ts:255`.
</fix>

### 3. AGENT tile does not show runtime — `OverviewTab.tsx:424-473` — `~`
**Raised by**: requirements
**Why it blocks**: The issue explicitly scopes the AGENT tile to "model, runtime, session id". Runtime is surfaced in the billboard at lines 389-395 but not inside the AGENT tile itself. Per the "No Partial Implementations" policy, a feature is complete only when all stated scope items are delivered.

<fix instruction>
Add runtime display to the AGENT tile using the existing `formatRuntime(agent.startedAt)` helper. The helper already exists and is used in the billboard — reuse it inside the AGENT tile section (around line 424-473) so the tile matches its explicit scope: "model, runtime, session id".
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `OverviewTab.tsx:521` — `?` — Defense-in-depth URL scheme validation for rendered links. Consider normalizing or allowlisting schemes (http/https/vscode) before rendering navigable `href` values as a defense-in-depth measure. (security)
- `src/dashboard/frontend/tests/pan-865-command-deck-overview.spec.ts:76-83` — `?` — E2E test reviewer data uses generic `role: 'review'` instead of specific reviewer roles (`correctness`, `security`, `performance`, `requirements`, `synthesis`). The reviewer grid always shows "no rounds yet" placeholders; consider using realistic role data so the snapshot captures round cards. (correctness)
- `OverviewTab.tsx:257-262` — `?` — Verbose per-field `as` casts in `isReviewPipelineStuck` call. Consider casting once at the object level: `isReviewPipelineStuck(reviewStatus.data as PipelineStateLike)`. (correctness)
- `IssueWorkbench.tsx:70-74` — `?` — `handleSwitchTab` is a documented no-op with a TODO comment. Zone A tab-switch buttons are visual only and don't actually switch Zone C's tab. Track for follow-up if intentional. (correctness)

## Cross-cutting groups

_none_

## What's good

- All 8 of 9 explicitly-scoped requirements are fully implemented and verified, including the sticky tab strip, URL sync, keyboard navigation (arrow/Home/End), billboard + tile grid + summaries + trend strip, issue vs agent mode wiring, and Playwright visual verification.
- Security and performance reviews found zero issues — no injection vectors, no hot-path regressions, no N+1 patterns, bounded caches on expensive lookups.
- Backend routes (`command-deck.ts`, `projects.ts`) correctly reuse existing endpoints with TTL-cached lookups rather than introducing new unbounded operations.

## Review stats
- Blockers: 3   High: 0   Medium: 0   Nits: 4
- By reviewer: correctness=5, security=1, performance=0, requirements=1
- Files touched: 14   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

