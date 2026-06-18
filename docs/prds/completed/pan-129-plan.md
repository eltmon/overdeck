# PAN-129: Add Dark/Light Mode Toggle to Dashboard

## Issue Summary

Add a toggle button to switch between dark and light mode on the Overdeck dashboard, with OS preference detection and localStorage persistence.

**Issue URL:** https://github.com/eltmon/panopticon-cli/issues/129
**Priority:** Low - nice to have for user comfort
**Branch:** feature/pan-129

---

## Previous Attempt

A prior implementation existed in git history (commits b235741..1a0d59e) that used Tailwind `dark:` class prefixes. It was reverted due to unrelated remote workspace issues, not code quality problems. This plan takes a fresh architectural approach.

---

## Architecture Decision: CSS Custom Properties + Tailwind Semantic Tokens

### Why Not `dark:` Prefixes (Previous Approach)

The prior implementation added `dark:` variants to every color class (~1,182 occurrences across 42 files), effectively doubling the class count. This is:
- **Hard to maintain**: Every new component must remember to add `dark:` variants
- **Noisy diffs**: Classes like `bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white` are verbose
- **Scattered logic**: Theme colors are defined in 42 places instead of one

### Chosen Approach: CSS Custom Properties

Define semantic color tokens as CSS custom properties. Components use **semantic names** (`bg-surface`, `text-heading`) instead of raw Tailwind grays. Switching themes only changes the variable values in one place.

**Benefits:**
1. **Centralized theme definition**: All colors in `index.css`, easy to modify/extend
2. **Cleaner components**: `bg-surface-raised` instead of `bg-gray-50 dark:bg-gray-800`
3. **Better maintainability**: New components just use semantic tokens
4. **Extensible**: Adding future themes (e.g., high-contrast) is trivial
5. **Smaller class footprint**: Fewer utility classes per element

---

## Semantic Color Token System

### Token Mapping

| Semantic Token | Dark Mode Value | Light Mode Value | Usage |
|----------------|----------------|------------------|-------|
| `--color-base` | gray-900 `17 24 39` | gray-50 `249 250 251` | Main app background |
| `--color-raised` | gray-800 `31 41 55` | white `255 255 255` | Cards, header, panels |
| `--color-overlay` | gray-700 `55 65 81` | gray-100 `243 244 246` | Hover states, subtle surfaces |
| `--color-emphasis` | gray-600 `75 85 99` | gray-200 `229 231 235` | Strong hover, pressed states |
| `--color-heading` | white `255 255 255` | gray-900 `17 24 39` | Primary/heading text |
| `--color-body` | gray-300 `209 213 219` | gray-700 `55 65 81` | Body text |
| `--color-subtle` | gray-400 `156 163 175` | gray-500 `107 114 128` | Secondary text, labels |
| `--color-muted` | gray-500 `107 114 128` | gray-400 `156 163 175` | Muted/disabled text |
| `--color-divider` | gray-700 `55 65 81` | gray-200 `229 231 235` | Default borders |
| `--color-divider-strong` | gray-600 `75 85 99` | gray-300 `209 213 219` | Strong borders |
| `--color-input-bg` | gray-700 `55 65 81` | white `255 255 255` | Input/select backgrounds |

### Preserved Colors (No Change)

These colors remain unchanged between themes:
- **Status colors**: `status-healthy`, `status-warning`, `status-stuck`, `status-dead`
- **Accent colors**: `blue-600`, `blue-400`, `blue-500` (brand/interactive)
- **Semantic colors**: `green-*`, `red-*`, `yellow-*`, `orange-*` (used for status indicators)

### Tailwind Config Extension

```js
// tailwind.config.js
darkMode: 'class',
theme: {
  extend: {
    colors: {
      surface: {
        DEFAULT: 'rgb(var(--color-base) / <alpha-value>)',
        raised: 'rgb(var(--color-raised) / <alpha-value>)',
        overlay: 'rgb(var(--color-overlay) / <alpha-value>)',
        emphasis: 'rgb(var(--color-emphasis) / <alpha-value>)',
      },
      content: {
        DEFAULT: 'rgb(var(--color-heading) / <alpha-value>)',
        body: 'rgb(var(--color-body) / <alpha-value>)',
        subtle: 'rgb(var(--color-subtle) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
      },
      divider: {
        DEFAULT: 'rgb(var(--color-divider) / <alpha-value>)',
        strong: 'rgb(var(--color-divider-strong) / <alpha-value>)',
      },
      'input-bg': 'rgb(var(--color-input-bg) / <alpha-value>)',
    },
  },
}
```

### Component Usage

```tsx
// Before (hard-coded dark)
<div className="bg-gray-800 border-gray-700 text-white">
  <span className="text-gray-400">Label</span>
</div>

// After (semantic tokens)
<div className="bg-surface-raised border-divider text-content">
  <span className="text-content-subtle">Label</span>
</div>
```

---

## Implementation Details

### 1. Theme Store (`src/hooks/useTheme.ts`)

Zustand store (already a dependency at v4.5.0):
- `theme: 'light' | 'dark'`
- `toggleTheme()`: Toggles and persists
- `initTheme()`: Reads localStorage, falls back to OS `prefers-color-scheme`
- **localStorage key**: `panopticon.ui.theme` (follows existing pattern)
- **Mechanism**: Adds/removes `dark` class on `<html>` element

### 2. Flash Prevention (`index.html`)

Inline `<script>` before React mounts:
```html
<script>
  (function() {
    var theme = localStorage.getItem('panopticon.ui.theme');
    if (!theme) theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (theme === 'dark') document.documentElement.classList.add('dark');
  })();
</script>
```

### 3. Toggle Button (in App.tsx header)

- Position: Right side of header, after nav tabs
- Icons: `Sun` / `Moon` from lucide-react (already a dependency)
- Simple button with same styling as nav tabs
- Tooltip: "Switch to {opposite} mode"

### 4. CSS Transitions

Add `transition-colors duration-150` to main layout containers for smooth switching.

### 5. Color Migration Map (Component → Token Replacement)

**Primary replacements** (most common patterns):

| Original Class | Semantic Replacement |
|----------------|---------------------|
| `bg-gray-900` | `bg-surface` |
| `bg-gray-800` | `bg-surface-raised` |
| `bg-gray-800/50` | `bg-surface-raised/50` |
| `bg-gray-700` | `bg-surface-overlay` |
| `bg-gray-600` | `bg-surface-emphasis` |
| `text-white` | `text-content` |
| `text-gray-200` | `text-content` |
| `text-gray-300` | `text-content-body` |
| `text-gray-400` | `text-content-subtle` |
| `text-gray-500` | `text-content-muted` |
| `border-gray-700` | `border-divider` |
| `border-gray-600` | `border-divider-strong` |
| `border-gray-800` | `border-divider` |
| `hover:bg-gray-700` | `hover:bg-surface-overlay` |
| `hover:bg-gray-600` | `hover:bg-surface-emphasis` |
| `hover:text-white` | `hover:text-content` |

**Context-sensitive replacements** (requires human judgment):
- `bg-gray-700` used as input background → `bg-input-bg`
- `text-gray-400` that's a placeholder → `text-content-muted`
- Hover states that go from `gray-700` to `gray-600` → `hover:bg-surface-emphasis`

---

## Files to Modify

### New Files (2)
1. `src/hooks/useTheme.ts` - Zustand theme store

### Modified Files (~38)
1. `tailwind.config.js` - Add darkMode + semantic color tokens
2. `index.html` - Flash prevention script, update body classes
3. `index.css` - CSS custom property definitions (light + dark)
4. `App.tsx` - Toggle button, semantic tokens
5. ~34 component files - Replace hard-coded colors with semantic tokens

### Component Files (grouped by migration batch)

**Batch 1 - Core Layout** (most visible):
- App.tsx, KanbanBoard.tsx, MetricsSummary.tsx, CloisterStatusBar.tsx

**Batch 2 - Detail Panels**:
- IssueDetailPanel.tsx, WorkspacePanel.tsx, AgentDetailView.tsx, AgentList.tsx

**Batch 3 - Pages**:
- MetricsPage.tsx, CostsPage.tsx, HandoffsPage.tsx, ActivityPanel.tsx, ConvoyPanel.tsx, HealthDashboard.tsx, SkillsList.tsx

**Batch 4 - Dialogs & Overlays**:
- PlanDialog.tsx, ConfirmationDialog.tsx, BeadsDialog.tsx, SearchModal.tsx, SearchResults.tsx, HandoffPanel.tsx

**Batch 5 - Cards & Widgets**:
- IssueAgentCard.tsx, SpecialistAgentCard.tsx, BudgetWidget.tsx, RuntimeComparison.tsx, BeadsTasksPanel.tsx, ProjectSpecialistPanel.tsx, SpecialistLogViewer.tsx

**Batch 6 - Settings**:
- Settings/SettingsPage.tsx, Settings/AgentCards/*, Settings/Provider/*, Settings/Shared/*, Settings/Override/*

**Batch 7 - Remaining**:
- TerminalView.tsx, HealthHistoryTimeline.tsx, HealthHistoryChart.tsx, GraceCountdown.tsx

---

## Testing Strategy

- **No automated unit/E2E tests** for this feature
- **Visual verification via Playwright screenshots**: After migration, take screenshots of every page/tab in both dark and light modes to verify visual correctness
- Pages to screenshot (10 tabs): Board, Agents, Convoys, Handoffs, Activity, Metrics, Costs, Skills, Health, Settings

---

## Scope

### In Scope
- Toggle button in header (Sun/Moon icon)
- Dark/Light binary toggle
- localStorage persistence (`panopticon.ui.theme`)
- OS `prefers-color-scheme` detection on first visit
- CSS custom properties with semantic Tailwind tokens
- Migration of all ~42 component files
- Smooth transitions (no flash)

### Out of Scope
- System/auto mode (3-way toggle)
- Settings page theme configuration
- Custom color schemes
- Per-user theme sync across devices
- Theme for terminal/xterm components (remains dark always)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Missed color reference in a component | Medium | Low | Playwright screenshot review catches visual issues |
| Light mode looks poor without design polish | Medium | Medium | Use well-established gray scale mappings; keep accent colors unchanged |
| XTerminal component breaks with light bg | Low | Medium | Explicitly exclude terminal from theming |
| Flash of wrong theme on load | Low | Low | Inline script in HTML head |
| Merge conflicts with concurrent dashboard work | Low | Medium | Feature branch, focused changes |

---

## Decisions Log

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | CSS custom properties over Tailwind `dark:` | Centralizes theme; cleaner components; better maintainability |
| 2 | Zustand store for theme state | Already a dependency (v4.5.0); clean hook API |
| 3 | Dark/Light only (no system mode) | Simpler UX; OS preference used as initial default |
| 4 | No automated tests | Low-priority feature; Playwright screenshots for visual review |
| 5 | Keep terminal always dark | Terminal UX is inherently dark-themed |
| 6 | Semantic token naming | `surface-*` for backgrounds, `content-*` for text, `divider-*` for borders |
