# PAN-619: Cost tracking — comma-format total cost, add day/week ticks to 30-day trend

## Status: Planning Complete

## Decisions

### 1. Comma-format all dollar values
- Apply `toLocaleString('en-US', { minimumFractionDigits: N, maximumFractionDigits: N })` to all dollar displays
- Summary-level values (totalCost, per-issue cost, budget): 2 decimal places with commas
- Sub-cent precision values (modal detail, agent/model stats): 4 decimal places with commas
- Chart Y-axis and tooltip: keep current precision but add comma formatting
- Implement as a small `formatCost(value, decimals)` helper at top of CostsPage.tsx

### 2. Day/week ticks on 30-day trend chart
- Chart.js x-axis already receives all 30 MM-DD labels
- Configure `ticks.callback` and `ticks.autoSkip: false` to show all tick marks
- Use `ticks.callback` to only render label text on week boundaries (every 7th tick from the end), showing empty string for other days
- This gives daily tick marks with weekly date labels — clean and readable
- No changes to data fetching or backend needed

### Scope
- Single file change: `src/dashboard/frontend/src/components/CostsPage.tsx`
- No backend changes
- No new dependencies

### Out of Scope
- Cost calculation logic
- Chart colors/styling beyond tick marks
- Backend API changes
- Other dashboard pages
