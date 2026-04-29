# PAN-923: Command Deck v0.8 Completion

**Status:** In Progress (fast-track on main)
**Planned by:** Claude Opus 4.6
**Date:** 2026-04-29

---

## Discovery Summary

PAN-923 consolidates remaining PAN-830 phases (3-6), PAN-831 (rebrand refinish), and PAN-548 (draft persistence) into one sprint on `main`.

### Already Completed (skip in vBRIEF)
- **Tree state filter** (item 2): `[All] [Alive] [Failed]` toggle exists at `CommandDeck/index.tsx:698-711`
- **PR/Diff tab** (item 6): `PrDiffTab.tsx` fully implemented (475 lines), backend at `/api/issues/:id/pr/details`
- **Discussions tab** (item 7): `DiscussionsTab.tsx` fully implemented (327 lines), backend at `/api/issues/:id/discussions`
- **Directory rename** (item 8a): `MissionControl/` → `CommandDeck/` already done
- **Old CSS delete** (item 8b): `mission-control.module.css` already deleted
- **DeferredTab** is dead code — no imports reference it

### Key Touch Points

| Component | File | What Changes |
|-----------|------|-------------|
| PresenceDot → StatusDot | `ProjectTree/SessionNode.tsx:21-52` | Replace inline SVG spinner + CSS classes with `<StatusDot>` |
| Collapse logic | `ProjectTree/FeatureItem.tsx:479-484` | `defaultExpandedFromState()` becomes state-aware |
| ZoneBActionStrip | `CommandDeck/ZoneBActionStrip.tsx:291-369` | Add overflow items from PRD spec |
| getZoneBActions | `lib/commandDeckActions.ts:298-311` | Add overflow action keys |
| mc- tokens (249 usages) | Many `.tsx` files | Replace `var(--mc-X, var(--Y))` → `var(--Y)` |
| mc- definitions | `styles/command-deck.module.css:4-35` | Remove alias layer after migration |
| text-white | `BulkActionBar.tsx` | Replace with semantic foreground token |
| DialogProvider | `components/DialogProvider.tsx` | Backdrop blur, panel styling, animation |
| Draft persistence | `CommandDeck/IssueComposer.tsx:56` | `useState('')` → Zustand-backed state |
| Liveness motions | Various CommandDeck components | Verify animations fire on real events |

### mc- Token Mapping (from command-deck.module.css)

| mc- token | Canonical replacement |
|-----------|---------------------|
| `--mc-text-muted` (101 uses) | `--muted-foreground` |
| `--mc-border` (53 uses) | `--border` |
| `--mc-success` (25 uses) | `--success` |
| `--mc-error` (21 uses) | `--destructive` |
| `--mc-warning` (20 uses) | `--warning` |
| `--mc-primary` (11 uses) | `--primary` |
| `--mc-accent` (11 uses) | `--primary` |
| `--mc-surface-2` (5 uses) | `color-mix(in srgb, var(--foreground) 3%, transparent)` |
| `--mc-surface` (3 uses) | `--background` |
| `--mc-text-secondary` (2 uses) | `--muted-foreground` |
| `--mc-text-primary` (2 uses) | `--foreground` |
| `--mc-primary-foreground` (2 uses) | `--primary-foreground` |
| `--mc-bg-secondary` (2 uses) | `--muted` |

Pattern: most inline styles use `var(--mc-X, var(--canonical))` with fallbacks. Replace entire expression with just `var(--canonical)`.

## Key Architectural Decisions

### D1: StatusDot mapping for SessionNode
**Decision:** Map session `presence` field to StatusDot `status` prop: `active→active`, `idle→idle`, `suspended→waiting`, `ended→ended`. No `thinking` state at session level (that's a status sub-state).
**Rationale:** StatusDot already handles these states with correct animations. The PresenceDot inline SVG duplicates this without animation consistency.

### D2: Done-issue collapse default
**Decision:** Pass feature state to `defaultExpandedFromState()`. In-flight states (stateLabel contains "progress", "review", "testing") → expanded=true with auto-select of best alive session. Done/closed → collapsed.
**Rationale:** Users want to see active work at a glance but not be overwhelmed by completed issues.

### D3: mc- token elimination approach
**Decision:** Batch find-replace across all `.tsx` files. Replace `var(--mc-X, var(--Y))` patterns with `var(--Y)`. For bare `var(--mc-X)` without fallback, replace with canonical equivalent from mapping table. Then remove definitions from `command-deck.module.css`.
**Rationale:** The mc- layer is 1:1 with canonical tokens — it adds indirection without value.

### D4: Draft persistence via Zustand
**Decision:** Add a `draftTexts: Record<string, string>` map to the existing dashboard Zustand store, keyed by issueId. Cleared on page refresh (not persisted to localStorage). Wire into IssueComposer via store selector.
**Rationale:** Simplest approach that survives navigation within the SPA but doesn't persist stale drafts across sessions.

### D5: Zone B overflow additions
**Decision:** Add to getZoneBActions overflow: `viewState`, `viewVbrief`, `copySessionId`, `copyTmuxCommand`. Add corresponding ActionKey entries and ZoneBActionStrip overflow items.
**Rationale:** PRD specifies these actions. They're utility/debug actions that belong in overflow, not primary.

## Remaining Work
See plan.vbrief.json for the complete bead breakdown.
