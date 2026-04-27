# PAN-815: Command Deck: unify Conversations and Projects into one filterable list

## Status: Implementation Complete

## Current Phase
All work complete. Ready for merge.

## Completed Work
- Replaced `SidebarTab` segmented control with independent filter chip toggles (`showConversations` / `showProjects`)
- Unified sidebar list rendering: both ConversationList and ProjectNodes render together when both filters are active
- Added localStorage persistence for filter state (`mc-filter-conversations`, `mc-filter-projects`)
- Fixed content area selection logic: IssueWorkbench renders when `selectedFeature` is set regardless of filter state
- Removed dead `DetailPanelLayout` fallback branch for selected features
- Updated CommandDeck tests for new filter chip behavior
- All 312 test files pass (3889 tests)
- Typecheck passes
- Lint passes
- Frontend build passes

## Remaining Work
None

## Key Decisions
- Filter chips are independent toggles (both visible by default), not a single-select control
- Selection state in content area is independent of sidebar filters — detail panels show regardless
- Tree session filter (all/alive/failed) remains visible whenever projects are shown
- Model picker and new-conversation button always visible in sidebar header
- Filter state persisted to localStorage (not URL, to keep scope focused)
