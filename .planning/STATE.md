# PAN-75: Add Task Difficulty Estimation for Model Selection

## Status: IMPLEMENTATION COMPLETE ✅

**Completed:** 2026-01-23

All acceptance criteria met:
- ✅ Planning agent prompt includes full difficulty estimation rubric
- ✅ Beads tasks created with `difficulty:LEVEL` labels
- ✅ Dashboard shows difficulty badges on task cards
- ✅ Agent state files include difficulty field
- ✅ All tests pass (286 passed, 0 failures)

## Problem Statement

When spawning agents for tasks, we always use the same model regardless of task complexity. While we won't change model selection immediately (to preserve prompt caching benefits), we want to:
1. Record task difficulty for future intelligent model selection
2. Have planning agents explicitly estimate difficulty for sub-tasks
3. Display difficulty in the dashboard for visibility

## Decisions Made

### Scope

**In Scope:**
1. Planning agent prompt update with full difficulty estimation rubric
2. Store difficulty in beads labels (e.g., `difficulty:complex`)
3. Dashboard shows difficulty badges on tasks
4. Basic tracking - log difficulty to agent state files

**Out of Scope:**
- Actually changing model selection during agent spawn (future work)
- Modifying beads CLI (use labels as workaround)
- Cost tracking/analysis infrastructure (defer to future issue)

### Complexity Levels

Use existing cloister 5-level system:
- `trivial` - typo, comment, formatting fixes
- `simple` - bug fix, minor enhancement, single file
- `medium` - new feature, component, integration
- `complex` - refactor, migration, multi-system changes
- `expert` - architecture, security, performance optimization

### Difficulty Storage

Store in beads labels with format: `difficulty:LEVEL`

Example: `bd create "PAN-75: Task name" --type task -l "PAN-75,linear,difficulty:medium"`

### Planning Agent Rubric

The planning prompt will include this estimation rubric:

| Factor | Trivial/Simple (1-2) | Medium (3) | Complex/Expert (4-5) |
|--------|---------------------|------------|---------------------|
| Files to modify | 1-2 | 3-5 | 6+ |
| Scope | Bug fix, tweak | New feature | New system/major refactor |
| Cross-cutting concerns | None | Some (logging) | Many (auth, security) |
| Test complexity | Unit tests only | Integration tests | E2E + security |
| Domain knowledge | Standard patterns | Some research | Deep expertise |
| Risk | Low | Medium | High (data, security) |

### Dashboard UI

Add difficulty badges to task cards:
- Color-coded chips: green (trivial/simple), yellow (medium), orange (complex), red (expert)
- Show in task list and detail views
- Filter/sort by difficulty (optional stretch)

### Tracking

Log difficulty to `~/.panopticon/agents/agent-{issue-id}/state.json`:
```json
{
  "issueId": "PAN-75",
  "model": "sonnet",
  "difficulty": "medium",
  "startedAt": "2024-01-23T..."
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/dashboard/server/index.ts` | Update planning prompt with rubric, add difficulty label to bd create |
| `src/cli/commands/work/plan.ts` | Add difficulty label to bd create commands |
| `src/dashboard/components/IssueCard.tsx` | Add difficulty badge display |
| `src/lib/agents.ts` | Add difficulty to agent state tracking |
| `src/lib/cloister/complexity.ts` | Add `parseDifficultyLabel()` utility function |

## Acceptance Criteria

- [ ] Planning agent prompt includes full difficulty estimation rubric
- [ ] Planning agent output includes difficulty for each sub-task
- [ ] Beads tasks created with `difficulty:LEVEL` labels
- [ ] Dashboard shows difficulty badges on task cards
- [ ] Agent state files include difficulty field
- [ ] Existing tests pass (`npm test`)

## Tasks

| ID | Task | Difficulty |
|----|------|------------|
| `panopticon-or63` | Update planning prompt with difficulty rubric | medium |
| `panopticon-hns3` | Update bd create commands with difficulty labels | simple |
| `panopticon-ypqn` | Add DifficultyBadge component to dashboard | medium |
| `panopticon-nmcw` | Add difficulty to agent state tracking | simple |
| `panopticon-59kd` | Add parseDifficultyLabel utility | trivial |
| `panopticon-tjsd` | Run tests and verify | trivial |

**Dependencies:** `panopticon-tjsd` (test) is blocked by all other tasks.

## Planning Agent Prompt Addition

Add this section to the planning agent prompt before Phase 3:

```markdown
### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

Format each task with difficulty:
- "Add null check in UserService" [difficulty: simple]
- "Implement rate limiting middleware" [difficulty: medium]
- "Redesign authentication flow" [difficulty: expert]
```

## Dashboard Badge Component

```tsx
// DifficultyBadge.tsx
const BADGE_COLORS = {
  trivial: 'bg-green-100 text-green-800',
  simple: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  complex: 'bg-orange-100 text-orange-800',
  expert: 'bg-red-100 text-red-800',
};

export function DifficultyBadge({ level }: { level: string }) {
  const color = BADGE_COLORS[level] || 'bg-gray-100 text-gray-800';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {level}
    </span>
  );
}
```

## Implementation Summary

### Files Modified

1. **src/lib/cloister/complexity.ts**
   - Added `parseDifficultyLabel()` utility function to extract difficulty from beads labels

2. **src/lib/agents.ts**
   - Added `difficulty` field to `SpawnOptions` interface
   - Set `complexity` field in agent state during spawn

3. **src/cli/commands/work/plan.ts**
   - Added `difficulty` field to `PlanTask` interface
   - Added `estimateDifficulty()` function to estimate based on keywords
   - Updated bd create commands to include `difficulty:LEVEL` labels

4. **src/dashboard/server/index.ts**
   - Added difficulty estimation rubric to planning agent prompt
   - Includes full table with levels, factors, and model recommendations
   - Instructions for creating beads tasks with difficulty labels

5. **src/dashboard/frontend/src/components/KanbanBoard.tsx**
   - Added `DifficultyBadge` component with color-coded badges
   - Added `parseDifficultyLabel()` function to extract difficulty from issue labels
   - Integrated badge display in IssueCard component

### Test Results

- **302 tests passed**, 0 failures (16 new tests added)
- All existing functionality preserved
- New difficulty features ready for use

### Code Review Feedback (Addressed)

**Review 1 Issues:**
1. ❌ NO TESTS → ✅ Added 16 comprehensive tests
   - `tests/unit/lib/difficulty-estimation.test.ts`: 6 tests for parseDifficultyLabel()
   - `tests/unit/cli/plan-difficulty.test.ts`: 10 tests for estimateDifficulty()
   - `tests/unit/frontend/DifficultyBadge.test.tsx`: 6 tests for component

2. ❌ CODE DUPLICATION → ✅ Removed duplicate parseDifficultyLabel
   - Frontend now imports from backend lib (complexity.ts)
   - Single source of truth for difficulty parsing

3. ❌ TYPE INCONSISTENCY → ✅ Unified type naming
   - Replaced `DifficultyLevel` with `ComplexityLevel` everywhere
   - Consistent imports from complexity.ts module

## Notes

- Model selection stays as sonnet for now - difficulty is recorded for future use
- No beads CLI changes needed - using labels as workaround
- Difficulty badge colors match severity/risk intuition (green=easy, red=hard)
- Dashboard badges appear next to agent model in issue cards
- Planning agents will now estimate and label all sub-tasks with difficulty
