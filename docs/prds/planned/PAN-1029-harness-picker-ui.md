# PAN-1029 — Harness Picker UI

**Issue:** https://github.com/eltmon/panopticon-cli/issues/1029
**Status:** Planned
**Date:** 2026-05-08

## Problem

PAN-636 shipped backend/CLI harness support but the dashboard received only a read-only badge. Five picker surfaces documented in HARNESSES.md were never implemented. This is an incomplete feature delivery filed as a bug.

## Goal

Add the missing picker surfaces. All must gate through canUseHarness(harness, model, authMode) in src/lib/harness-policy.ts — no duplicate ToS logic.

## Design Goals

- Single gate: canUseHarness() only. Blocked combos shown disabled+tooltip, not hidden.
- Reusable component: one HarnessPicker used by all surfaces.
- Non-disruptive defaults: claude-code everywhere, Pi is opt-in.
- API-first: harness param on spawn endpoints before UI surfaces.

## Phase 1 Scope

### Bead 1: HarnessPicker Component
File: src/dashboard/frontend/src/components/HarnessPicker.tsx (new)
Props: value (Harness), onChange (Harness=>void), model (string), authMode (AuthMode), disabled?, size?
- Renders claude-code and pi options
- Calls canUseHarness() for each; blocked option disabled with tooltip "Pi + Anthropic subscription is not permitted"
- Auto-reverts to claude-code via onChange when current selection becomes blocked
- Exports HarnessPickerInline variant for Settings rows

### Bead 2: API harness params
- POST /api/agents (routes/agents.ts): add optional harness: Harness (default claude-code), thread to launcher, persist to agent state, canUseHarness() validation → 400 if blocked
- POST /api/issues/:id/start-planning (routes/issues.ts): add optional harness: Harness (default claude-code), thread to spawn-planning-session

### Bead 3: PlanDialog picker
In PlanDialog.tsx: add harnessOverride state, render HarnessPicker below model dropdown, pass in startPlanningViaSSE() request body.

### Bead 4: Start-agent picker
In PlanDialog.tsx Start Agent tab: add harnessOverride state, render HarnessPicker, pass harness in startAgentMutation payload.

### Bead 5: ConversationPanel picker
In ConversationPanel.tsx: add HarnessPicker to panel header. Per-conversation local state.

### Bead 6: SettingsPage defaults
In Settings/SettingsPage.tsx: add HarnessPickerInline next to each specialist's model dropdown. Persist to settings.specialists.<role>.harness. Verify cloister/router.ts getSpecialistHarness() reads from this key.

## Out of Scope (Phase 2)
Model-list narrowing by harness — separate follow-up.

## Acceptance Criteria
- HarnessPicker exists; Pi+subscription disabled; auto-reverts
- POST /api/agents accepts harness, persists, rejects blocked with 400
- POST /api/issues/:id/start-planning accepts harness, threads to spawn
- PlanDialog shows picker; harness sent to endpoint
- Start-agent flow shows picker; harness sent to endpoint
- ConversationPanel shows per-conversation picker
- SettingsPage shows per-specialist picker; values persist
- canUseHarness() is the single gate
- Existing badge tests pass; new picker gating tests added

## Files Likely Touched
src/dashboard/frontend/src/components/HarnessPicker.tsx (new)
src/dashboard/frontend/src/components/PlanDialog.tsx
src/dashboard/frontend/src/components/ConversationPanel.tsx
src/dashboard/frontend/src/components/Settings/SettingsPage.tsx
src/dashboard/server/routes/issues.ts
src/dashboard/server/routes/agents.ts
packages/contracts/src/types.ts (possibly add AuthMode export)
