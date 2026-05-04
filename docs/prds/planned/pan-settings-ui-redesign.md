# Panopticon settings UI redesign

## Context

Panopticon’s settings page already exposes a lot of real power, but the presentation has become visually busy and structurally inconsistent. Compared with t3code’s settings UI, the current Panopticon page asks the user to parse too many bespoke section treatments, too many high-emphasis cards, and too many global actions competing for attention.

Today the page mixes:
- a sticky action bar
- a second page header
- a hero section
- provider cards
- tracker cards
- bespoke conversations/terminal cards
- dense model assignment tiles
- a separate desktop-only section

Each area works in isolation, but together the page feels louder and heavier than it should. The result is that a critical operator surface feels harder to scan, harder to trust at a glance, and less polished than the rest of the dashboard should be.

The goal of this work is to make Panopticon settings feel as neat, calm, and coherent as t3code’s settings page while preserving Panopticon’s much richer configuration surface.

## Problem statement

The current settings implementation in `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx` suffers from five core issues:

1. **Too many competing page-level frames**
   - The sticky save bar and the full page header both act like the primary header.
   - Global actions like “Optimal Defaults” and “MiniMax Defaults” compete with save/reset actions instead of living inside model-routing context.

2. **Weak information architecture**
   - Providers, model routing, tracker keys, conversations, terminal behavior, appearance, maintenance, and desktop settings all use different presentation patterns.
   - The page does not read like one coherent settings system.

3. **Visual noise**
   - There is too much simultaneous emphasis: large icons, colored panels, badges, hero treatments, score indicators, and card chrome.
   - The user has to visually decode the page before they can configure it.

4. **Dense but not calm model routing UX**
   - Model assignments are shown as many small tiles with scores, capability chips, and state colors.
   - This exposes useful information, but the interaction is too noisy for a default settings view.

5. **No shared settings primitives**
   - Unlike t3code, Panopticon does not yet consistently use a small set of reusable settings layout primitives such as section wrappers, row layouts, inline reset affordances, and summary-first detail expansion.

## Design target

**“Mission control discipline, t3code cleanliness.”**

The settings page should feel:
- calm
- compact
- readable
- trustworthy
- clearly organized
- powerful without looking chaotic

This is not a “make it simpler by removing capability” project. It is a “make the same power feel intentional and easy to operate” project.

## Explicit visual direction

The current settings page is not just structurally busy — it is visually over-signaled. Too many sections are shouting at once through tinted panels, high-contrast card borders, bright badges, large icons, and multiple accent colors competing in the same viewport.

This redesign must explicitly fix that.

Required visual direction:
- default surfaces are neutral, quiet, and border-led
- accent color is used sparingly for actions, selection, and true status
- status color appears only where it conveys meaning, not as general decoration
- the page should not read like a rainbow of feature panels
- the first screen of settings should feel calm and controlled, not loud or gamified
- dense operational information is acceptable, but it must be presented with restraint

T3code is the benchmark here not because it is simpler, but because it is much more disciplined about when to use emphasis.

## Goals

1. Create a settings layout system that is visually consistent across all sections.
2. Make the page feel calm and scan-friendly at first glance.
3. Reorganize the page into clear sections with strong information hierarchy.
4. Move from full-detail-by-default to summary-first, expand-for-details patterns where appropriate.
5. Preserve all existing configuration capability.
6. Improve accessibility and keyboard/focus consistency.
7. Make model routing and provider configuration feel like part of the same design system rather than separate mini-products.

## Non-goals

1. Do not remove existing settings capability.
2. Do not redesign unrelated dashboard surfaces outside Settings.
3. Do not change backend configuration semantics unless the UI cleanup requires a small additive API change.
4. Do not introduce feature flags or compatibility shims for old settings presentation.
5. Do not split this into multiple UI issues; this should be one coherent redesign.

## Reference benchmark

Use t3code’s settings implementation as the presentation benchmark, especially these patterns:
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/SettingsSidebarNav.tsx`
- `apps/web/src/routes/settings.tsx`

The key traits to borrow are:
- constrained content width
- strong section primitives
- summary-first rows
- subtle chrome
- low visual noise
- simple, explicit navigation
- restrained use of color and emphasis

This is a benchmark for cleanliness and interaction style, not a literal copy of t3code’s content model.

## Required product outcomes

### 1. Replace the current page shell with a coherent settings shell

The new settings page must have exactly one primary page header.

Required shell behavior:
- one title area
- one subtitle area
- one action cluster for dirty-state actions
- no second large duplicated heading below the sticky bar
- content constrained to a predictable readable width
- consistent vertical rhythm between sections

Allowed action patterns:
- either a single sticky top action bar
- or a single sticky footer action bar
- but not a sticky save bar plus a second hero-like page header

### 2. Introduce reusable settings primitives

Extract a small shared settings UI vocabulary, equivalent in spirit to t3code’s `SettingsSection` and `SettingsRow` primitives.

At minimum, create reusable components for:
- `SettingsPageLayout`
- `SettingsSection`
- `SettingsSectionHeader`
- `SettingsRow`
- `SettingsRowStatus`
- `SettingResetButton`
- `SettingsCardSection` (only where a row layout is genuinely insufficient)
- `SettingsSidebarNav` or equivalent local settings navigation

Rules:
- most settings should fit into `SettingsRow`
- card-heavy designs should be the exception, not the default
- local one-off styling islands should be removed where possible

### 3. Reorganize the settings information architecture

The current page should be reorganized into a clean operator-oriented structure.

Recommended top-level settings sections:
1. **Model Routing**
2. **Providers**
3. **Conversations**
4. **Terminal**
5. **Tracker Keys**
6. **Appearance**
7. **Desktop App** (Electron only)
8. **Maintenance**

Requirements:
- section order should reflect operator priority, not implementation history
- “Optimal Defaults” / “MiniMax Defaults” must move into the Model Routing section rather than living in the global page header
- desktop-only settings must remain hidden outside Electron, but visually match the rest of the system when shown

### 4. Add explicit local settings navigation

Panopticon’s settings surface is now large enough to warrant local settings navigation.

Required behavior:
- add a local settings nav rail or settings sidebar, inspired by t3code’s settings nav
- show all major sections as first-class destinations
- active section must be obvious
- navigation must work without relying on browser history semantics

Implementation options:
- route-based subpages
- or a single page with anchored section navigation and active-state syncing

Either approach is acceptable, but the user must be able to move between settings categories intentionally rather than scrolling through one long page blindly.

### 5. Redesign Providers into summary-first expandable management panels

The current provider area is informative but visually too card-heavy.

Required redesign:
- each provider should present a clean summary row/card with:
  - provider name
  - enabled/disabled state
  - auth status summary
  - key secondary metadata (e.g. subscription/auth type)
  - a single explicit expand/details affordance
- advanced details should be collapsed by default
- details panel should hold:
  - API key/auth configuration
  - test connection / test model actions
  - model browsing / provider-specific controls

Specific requirements:
- Anthropic and OpenAI auth should fit into the same visual system as the other providers
- status should rely on restrained dots/badges and concise copy, not large high-contrast blocks everywhere
- test results should appear as inline status, not as layout-breaking UI fragments

### 6. Redesign Model Routing around presets + overrides, not a wall of tiles

This is the most important section to improve.

Required redesign:
- top of section shows the active preset cleanly
- preset actions live here, not in the page-global action bar
- per-work-type overrides should become a summary-first experience
- advanced override editing should be available on demand, not always visually expanded

Preferred structure:
1. **Preset summary**
   - current preset
   - short explanation
   - preset switch actions
2. **Override summary**
   - count of active overrides
   - warnings count (deprecated model, disabled provider, poor capability fit)
   - expand/collapse affordance
3. **Overrides table/list**
   - grouped by category
   - each row shows:
     - work type
     - effective model
     - source badge (`preset`, `override`, `fallback` if applicable)
     - fit/warning summary
     - configure action

Rules:
- the default view should not show a dense multi-column wall of brightly colored tiles
- capability fit information must remain accessible, but it should be secondary information rather than the dominant visual treatment
- editing an override can continue to use a modal/drawer if the interaction is clean and consistent

### 7. Normalize Conversations, Terminal, Tracker Keys, Appearance, Maintenance, and Desktop sections into the shared system

These sections should all be restyled to use the same settings vocabulary.

Requirements:
- sections like Conversations and Terminal should use rows or calm grouped cards instead of custom promo-card layouts
- Tracker Keys should visually align with Providers rather than feeling like a second unrelated provider system
- Appearance and Maintenance should not feel like afterthoughts; they should inherit the same layout grammar
- Desktop settings should reuse the same row/toggle patterns rather than a second design language

### 8. Reduce visual noise substantially

This redesign must intentionally remove unnecessary emphasis.

Required rules:
- fewer oversized icons
- fewer simultaneous accent colors on screen
- fewer outline + badge + tinted background combinations competing at once
- prefer neutral cards with selective status color only where it conveys state
- use small uppercase/kicker section labels or compact headers instead of repeated giant headings where appropriate
- preserve Panopticon branding, but do not let visual drama overpower operator clarity
- remove the current “gawd ugly colors” effect where multiple saturated surfaces and badges compete in the same viewport
- no section should require bright tinted backgrounds unless it is conveying a real warning, error, success, or selection state
- capability fit, provider health, and warning states should be legible without making the entire page look color-coded by default
- the resting state of the page should be mostly neutral with sparse, intentional highlights

### 8a. Color and emphasis policy

Use a restrained hierarchy similar to t3code:
- neutral background and card surfaces by default
- one primary accent for actions/selection
- semantic colors reserved for success, warning, and error states
- badges only where they add real decision value
- avoid stacking multiple signals on the same element unless strictly necessary

Specific anti-patterns to remove from the current settings page:
- brightly tinted large cards as the default presentation mode
- multiple accent colors visible at equal priority in the same section
- walls of status tiles where color is doing too much of the information design
- promo/hero treatments that visually dominate the actual settings controls

### 9. Improve accessibility and semantics

Required cleanup:
- exactly one semantic `h1` for the page
- proper heading hierarchy under it
- icon-only buttons must have `aria-label`
- toggles must use a consistent accessible switch/button primitive
- labels and controls must be properly associated
- focus-visible states must be consistent across all controls
- keyboard access must work for all expansion, navigation, and configure actions

### 10. Preserve power-user trust

The redesign must not make Panopticon feel toy-like or overly consumerized.

Required product tone:
- concise, direct operator copy
- technical detail available when needed
- defaults are obvious
- overrides are explicit
- dangerous or high-impact actions are visually distinct but not melodramatic

## Implementation guidance

### Frontend files expected to change significantly

Primary files:
- `src/dashboard/frontend/src/components/Settings/SettingsPage.tsx`
- `src/dashboard/frontend/src/components/Settings/DesktopSettingsSection.tsx`

Likely new files/directories:
- `src/dashboard/frontend/src/components/Settings/SettingsLayout.tsx`
- `src/dashboard/frontend/src/components/Settings/SettingsSidebarNav.tsx`
- `src/dashboard/frontend/src/components/Settings/SettingsSection.tsx`
- `src/dashboard/frontend/src/components/Settings/SettingsRow.tsx`
- `src/dashboard/frontend/src/components/Settings/ProviderSettingsPanel.tsx`
- `src/dashboard/frontend/src/components/Settings/ModelRoutingSection.tsx`
- `src/dashboard/frontend/src/components/Settings/TrackerKeysSection.tsx`
- `src/dashboard/frontend/src/components/Settings/ConversationSettingsSection.tsx`
- `src/dashboard/frontend/src/components/Settings/TerminalSettingsSection.tsx`
- `src/dashboard/frontend/src/components/Settings/MaintenanceSection.tsx`

Existing modal/editor flows should be reused where they already work, but the page structure around them should be rebuilt.

### Styling direction

Use the existing Panopticon design language, but pull it toward t3code’s restraint.

Required styling characteristics:
- constrained content width
- 8–16px radius family only
- consistent card padding
- subtle border-first containers
- light shadow use only where necessary
- mono reserved for technical identifiers and code-like values
- body copy remains legible and low-drama

### State model expectations

The redesign should preserve the current dirty-state/save/reset behavior, but the user experience around it should be cleaner.

Required behavior:
- unsaved changes are obvious
- save success/failure is visible but not noisy
- section-local reset affordances exist where helpful
- global reset/save actions remain easy to find

## Acceptance criteria

### Layout and IA
- [ ] The settings page has one primary header, not two competing headers
- [ ] Settings are organized into clear top-level sections with explicit local navigation
- [ ] The page no longer reads like one long stream of unrelated custom panels

### Providers
- [ ] Provider configuration is summary-first with collapsed advanced details by default
- [ ] Anthropic, OpenAI, and other providers all fit the same visual system
- [ ] Provider status is readable without excessive color noise

### Model Routing
- [ ] Preset selection lives inside Model Routing, not in the global page header
- [ ] Override management is summary-first and not always visually expanded
- [ ] Work-type override editing remains available without the main view becoming overwhelming
- [ ] Deprecated/disabled/poor-fit states are visible but not visually dominant by default

### Shared design system
- [ ] Most settings use shared row/section primitives
- [ ] Tracker keys, conversations, terminal, desktop, appearance, and maintenance all visibly belong to the same system
- [ ] One-off styling islands are substantially reduced

### Accessibility
- [ ] One semantic `h1` exists for the page
- [ ] Heading hierarchy is correct
- [ ] Icon-only actions have labels
- [ ] Focus-visible states are consistent
- [ ] Keyboard access works for navigation, toggles, expansion, and configuration actions

### Visual quality
- [ ] The page feels materially calmer and cleaner than the current implementation
- [ ] Visual hierarchy is stronger with less color noise
- [ ] The default resting state is mostly neutral rather than saturated
- [ ] Color is used intentionally for meaning, not as ambient decoration
- [ ] The current loud multi-accent look is eliminated from the main settings flow
- [ ] The settings UI quality bar is clearly in the same league as t3code’s settings presentation

## Validation plan

1. **Code review against the settings benchmark**
   - compare the new structure to t3code’s settings primitives and interaction discipline

2. **Playwright verification**
   - verify the full page in the browser
   - verify navigation between settings sections
   - verify provider expansion/collapse
   - verify override editing flow
   - verify Electron-only desktop section behavior where applicable

3. **Accessibility verification**
   - keyboard traversal through the page
   - focus ring checks
   - label/aria checks for icon buttons, toggles, and expansion controls

4. **Regression verification**
   - save
   - reset
   - provider enable/disable
   - API key entry
   - model override edit/remove
   - conversation settings
   - terminal settings
   - tracker key editing
   - maintenance actions

## Why this matters

Settings is where Panopticon proves whether it feels like a serious operator product or a collection of internal tools bolted together. The functionality is already strong. The problem is the surface discipline.

This work should make the settings page feel intentionally designed, high-trust, and easy to operate — without reducing any power.
