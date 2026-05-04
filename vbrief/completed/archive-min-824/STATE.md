# MIN-824: Onboarding Tutorial Fix — Planning State

## Decision Log

### Scope: Fix mismatches only
- Update selectors and content to match current UI
- Keep existing 5-step structure
- Fix E2E tests to use workspace URLs

### Bug Analysis

| # | Step | Target | Bug | Fix |
|---|------|--------|-----|-----|
| 1 | Daily Briefing | `main h1` | No `<main>` element exists; heading is `<h2>` not `<h1>` | Change selector to target `<h2>` in Briefing component (or add `data-tour="briefing"` attribute) |
| 2 | Quick Add | `[data-tour="add-task"]` | Content mentions "voice commands" — may be stale | Verify and update copy if voice isn't accessible from add button |
| 3 | Your AI Assistant | `[data-tour="kaia-button"]` | Working correctly | No change needed |
| 4 | Navigation | `[data-tour="sidebar"] a[href*="organizer"]` | Organizer is admin-only and deprecated | Retarget to Home link in sidebar Personal section |
| 5 | Settings | `a[href*="settings"]` | Matches Goals link (`/settings/goals`) first in DOM, not Settings | Use more specific selector targeting the bottom menu Settings link |

### Approach
- Use `data-tour` attributes for all selectors (reliable, explicit, won't break with UI changes)
- Add `data-tour="briefing-heading"` to the Briefing `<h2>`
- Add `data-tour="home-nav"` to the Home sidebar link
- Add `data-tour="settings-nav"` to the Settings bottom menu link
- Update Step 4 content to reflect Personal section navigation (Home, Debrief, Goals, Calendar, Planner)
- Update Step 5 selector to `[data-tour="settings-nav"]`
- Update E2E tests to use `TEST_FRONTEND_URL` env var pattern

### Files to Modify

**Frontend (fe/):**
1. `src/components/onboarding/InteractiveTour.tsx` — Fix all step selectors and content
2. `src/components/home/Briefing.jsx` — Add `data-tour="briefing-heading"` to h2
3. `src/components/navigation/sidebar/PersonalSection.tsx` — Add `data-tour="home-nav"` to Home link
4. `src/components/navigation/sidebar/Sidebar.tsx` — Add `data-tour="settings-nav"` to Settings bottom menu item

**Tests (fe/tests/):**
5. `tests/e2e/onboarding/interactive-tour.spec.ts` — Fix URLs and update assertions for new selectors/content

### Out of Scope
- Adding new tour steps
- Redesigning tour flow
- Onboarding state machine changes
- Backend changes

## Specialist Feedback

- **[2026-04-03T19:20Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-03T19:25Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
