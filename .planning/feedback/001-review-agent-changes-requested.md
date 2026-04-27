---
specialist: review-agent
issueId: PAN-867
outcome: changes-requested
timestamp: 2026-04-27T05:08:52Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-867 round 2 addresses the two previous High items (noAgentOrStopped gap and dead code in the danger-zone block) and introduces a surface registry to anchor the action-parity smoke test. Security review is clean. However, REQ-9 is still incomplete — the shared registry covers only `KanbanBoard`, `ActionsSection`, and `AgentInfoSection` while the acceptance criteria explicitly name seven surface families: KanbanBoard, InspectorPanel (with AgentInfoSection, ReviewPipelineSection, ContainerSection, ActionsSection, BadgeBar), StatusFlowControl, and WorkspacePane. The smoke test validates only the three registered surfaces, so actions in the other four named surfaces are invisible to parity checking and the test can still pass while those actions have no CD home. One blocker remains.

## Blockers (MUST fix before merge)

### 1. Smoke test does not enumerate all required source surfaces — `src/dashboard/frontend/src/lib/commandDeckSurfaceRegistry.ts:3`, `src/dashboard/frontend/src/lib/__tests__/commandDeckActions.test.ts:346` — `!`
**Raised by**: requirements
**Why it blocks**: The acceptance criterion explicitly lists seven surface families to cover. The registry only includes KanbanBoard, ActionsSection, and AgentInfoSection — ReviewPipelineSection, ContainerSection, BadgeBar (modals), StatusFlowControl, and WorkspacePane are absent. The smoke test derives its action list only from the registry, so those four surface families are invisible to parity checking.

<fix instruction — what to change, concrete and scoped>

Add the four missing surface families to `commandDeckSurfaceRegistry.ts` and ensure they are imported in the corresponding source files. The exact implementation path is the work agent's choice — options include extending the registry with additional surface entries, using a glob-based enumeration, or splitting the registry by surface family. The smoke test must cover all seven surface families and fail CI if any action in those surfaces is not represented in the Command Deck action map. Key surfaces to instrument:
- `InspectorPanel.tsx` → `ReviewPipelineSection.tsx` and `ContainerSection.tsx` (inspector sub-surfaces)
- `BadgeBar` (modal/dialog actions)
- `StatusFlowControl.tsx`
- `WorkspacePane.tsx`

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/IssueComposer.tsx:75` — `?` — Unconditional second query invalidation after spawn. `onSuccess` invalidates `['agents']` immediately then schedules a second invalidation 2s later — one fetch is guaranteed redundant. Low frequency path. (performance)
- `src/dashboard/frontend/src/lib/commandDeckSurfaceRegistry.ts` — `?` — Registry can silently go stale if surface actions are added without updating it. No completeness validation in the other direction (surface → registry). Current design is pragmatic for the PR scope; a future grep-based cross-reference could help. (correctness)
- `src/dashboard/frontend/src/lib/__tests__/commandDeckActions.test.ts:57` — `?` — `readFileSync` path resolution depends on `process.cwd()` being workspace root. Vitest convention but worth noting defensively. (correctness)

## Cross-cutting groups

**Surface registry completeness** (all stem from REQ-9 — registry only covers 3 of 7 required surfaces):
- [blocker-1] REQ-9: Smoke test must cover all 7 named surface families (KanbanBoard, ActionsSection, AgentInfoSection, ReviewPipelineSection, ContainerSection, BadgeBar modals, StatusFlowControl, WorkspacePane)

## What's good
- Prior High items (noAgentOrStopped gap, dead code) correctly resolved — both confirmed fixed by correctness reviewer
- Surface registry is a solid architectural foundation; extending it is incremental, not rework
- All composer modes (spawn/send, spawn-work/send, disabled-with-hint) remain correctly implemented
- Security review clean — no new vulnerabilities in the expanded file set
- Test coverage expanded: failedAgentNoWorkspace state, canceled state, syncMain with git metadata, surface-registry parity assertion

## Review stats
- Blockers: 1   High: 0   Medium: 0   Nits: 3
- By reviewer: correctness=0, security=0, performance=0, requirements=1
- Files touched: 16   Files with findings: 3

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-867 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

