---
specialist: review-agent
issueId: PAN-854
outcome: changes-requested
timestamp: 2026-04-27T22:48:22Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-854 implements 6/6 acceptance criteria for the Command Deck project tree visual polish: HTML comment stripping, untitled placeholders, elastic/fixed column widths, empty-project removal, Title Case filter pills, and duplicate ID prevention. All requirements are met (requirements reviewer: PASS). However, a CSS specificity bug in `.featureResourcePopover *` makes the Cleanup button in the orphaned-resource popover completely non-clickable in a real browser — synthetic-event tests pass but a real browser applies `pointer-events: none` and the button is unreachable. Two additional HIGH findings (popover mouseleave interaction, duplicated filter logic) share the same root-cause file and should be fixed together. Three reviewers completed; all 4 reviewer outputs are coherent.

## Blockers (MUST fix before merge)

### 1. Cleanup button non-clickable due to CSS specificity conflict — `src/dashboard/frontend/src/components/CommandDeck/styles/command-deck.module.css:362-373` — `~`
**Raised by**: correctness
**Why it blocks**: The `.featureResourcePopover *` rule (specificity 0,1,1) applies `pointer-events: none` to all descendants; the `.featureResourceCleanupButton` rule (specificity 0,1,0) tries to restore `pointer-events: auto` but loses the specificity battle. The button is visible but completely non-interactive in a real browser. The existing test passes because `fireEvent.click` dispatches synthetic events that bypass CSS `pointer-events`.

Increase button specificity to win the specificity war:
```css
/* Override wildcard rule so the button is clickable */
.featureResourcePopover .featureResourceCleanupButton {
  pointer-events: auto;
}
/* Also update the hover rule for consistency */
.featureResourcePopover .featureResourceCleanupButton:hover {
  background: var(--color-destructive);
}
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Resource popover closes immediately on mouse-leave — `src/dashboard/frontend/src/components/CommandDeck/styles/command-deck.module.css:339-364` + `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:203-241` — `~`
**Raised by**: correctness
**Why it matters**: The popover has `pointer-events: none` and is absolutely positioned above the strip. When the mouse moves from the strip icons toward the popover content, it exits the strip's DOM bounds, `onMouseLeave` fires, and the popover closes before the user can read branch names or click Cleanup. Related root cause as blocker-1 — same `.featureResourcePopover` class, fixable in the same file.

Fix: Give the popover `pointer-events: auto` and only suppress events on non-interactive children, or add an invisible hover bridge between the strip and popover that keeps the mouse within the strip's bounds.

### 2. Duplicated session filter logic in two locations — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:738-747` + `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx:166-174` — `≉`
**Raised by**: correctness
**Why it matters**: The "alive"/"failed" filter predicate is duplicated verbatim in `CommandDeck` and `ProjectNode`. If one copy is updated without the other, project-level and feature-level filters disagree. `sessionMatchesFilter` already exists in `FeatureItem.tsx:506` — extract the predicate there and import from both locations.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:132` — `?` — Resource popover exposes internal workspace paths and runtime identifiers in the hover popover. Low-risk widening of operational metadata visibility. Safe to defer; the backing endpoint is pre-existing and unchanged in this PR. (security)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:266` — `?` — `session_added` invalidates the whole bulk session-tree query instead of patching in-place. Acceptable for current scale; worth revisiting if the number of projects/features grows substantially. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:293-296` — `?` — `isErrorSession` does not guard against undefined `session.status` with defensive `(session.status || '')` unlike the nearby `sessionMatchesFilter`. Suggest applying the same defensive pattern for consistency. (correctness — suggestion)

## Cross-cutting groups

**`.featureResourcePopover` CSS cluster** (same class, same file, same fix space):
- [blocker-1] Cleanup button non-clickable — specificity conflict with wildcard
- [high-1] Popover closes immediately on mouse approach — pointer-events + onMouseLeave interaction

**Session filter deduplication** (shared predicate):
- [high-2] Duplicated filter logic in CommandDeck/index.tsx and ProjectNode.tsx

## What's good
- All 6 stated acceptance criteria from issue #854 are implemented and verified.
- Session tree loading moved to batched `fetchAllSessionTrees()` replacing per-project waterfalls.
- `sanitizeDisplayTitle()` correctly strips `<!-- panopticon:* -->` markers server-side.
- `(untitled)` placeholder with `featureLabelUntitled` styling correctly prevents ID duplication.
- Column grid layout (`minmax(0, 1fr)` / `max-content`) correctly separates elastic label from fixed status/duration.
- Filter pills render in Title Case (`All`, `Alive`, `Failed`).
- Tests in `FeatureItem.test.tsx` and `ProjectNode.test.tsx` cover missing-title and filter behaviors.

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 3
- By reviewer: correctness=1 blocker + 2 high + 2 suggestions, security=1 best-practice nit, performance=1 optimization nit, requirements=PASS (6/6)
- Files touched: 12   Files with findings: 6 (command-deck.module.css, FeatureItem.tsx, ProjectNode.tsx, CommandDeck/index.tsx, projects.ts)

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-854 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

