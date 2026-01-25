# PAN-91: Display Full Model Name in Card Detail Panel

## Current Status

✅ **COMPLETE** - All implementation finished, tested, committed, and pushed.

**Completed:**
- ✅ Added getActiveSessionModel() to jsonl-parser.ts
- ✅ Updated workspace endpoint to return agentModelFull
- ✅ Added agentModelFull to WorkspaceInfo interface
- ✅ Created getFriendlyModelName() helper function
- ✅ Added tooltip to agent badge showing full model ID
- ✅ Updated cost breakdown "By Model" section with friendly names and tooltips
- ✅ All tests passing (511 passed, 46 skipped)
- ✅ Changes committed and pushed to feature/pan-91
- ✅ All beads tasks closed

**PR:** https://github.com/eltmon/panopticon-cli/pull/new/feature/pan-91

## Summary

Display the full Claude model identifier (e.g., "claude-sonnet-4-5-20250929") instead of just the short name ("sonnet") in the issue detail panel.

## Decisions Made

### Data Source: JSONL Session Files
- Parse Claude Code's session files at `~/.claude/projects/<workspace-hash>/<session>.jsonl`
- These contain the exact API model ID used by the agent
- More accurate than regex parsing the status line

### Display Format: Badge + Tooltip
- Show friendly name as badge (e.g., "Sonnet 4.5")
- Full model ID appears on hover tooltip (e.g., "claude-sonnet-4-5-20250929")
- Best UX: clean visually, detailed on demand

### Scope
1. Agent badge in workspace info section (lines 596-600)
2. Cost summary "By Model" section (lines 454-468)

## Technical Approach

### 1. Backend: Add Model Resolution Function

Create a utility to get the full model ID from Claude Code session files:

**Location:** `src/lib/cost-parsers/jsonl-parser.ts` (add new export)

```typescript
export function getActiveSessionModel(workspacePath: string): string | null {
  // Convert workspace path to Claude project dir name
  // e.g., /home/user/projects/myn/workspaces/feature-min-664
  //    -> -home-user-projects-myn-workspaces-feature-min-664
  const projectDirName = workspacePath.replace(/\//g, '-').replace(/^-/, '');
  const projectDir = join(homedir(), '.claude', 'projects', projectDirName);

  // Find most recently modified session file
  const sessions = getSessionFiles(projectDir);
  if (sessions.length === 0) return null;

  // Parse first few lines to find model
  // ... parse logic ...

  return modelId; // e.g., "claude-sonnet-4-5-20250929"
}
```

### 2. Backend: Update Workspace Endpoint

**File:** `src/dashboard/server/index.ts` (around line 3689-3713)

Add call to get full model ID:
```typescript
// After getting agentModel from status line...
let agentModelFull: string | undefined;

if (hasAgent && workspacePath) {
  agentModelFull = getActiveSessionModel(workspacePath);
}

// Include in response
res.json({
  // ... existing fields ...
  agentModel,      // friendly name from status line
  agentModelFull,  // full ID from JSONL
});
```

### 3. Frontend: Update Type Definitions

**File:** `src/dashboard/frontend/src/components/IssueDetailPanel.tsx`

```typescript
interface WorkspaceInfo {
  // ... existing fields ...
  agentModel?: string;      // "Sonnet 4.5"
  agentModelFull?: string;  // "claude-sonnet-4-5-20250929"
}
```

### 4. Frontend: Agent Badge with Tooltip

**File:** `src/dashboard/frontend/src/components/IssueDetailPanel.tsx` (lines 596-600)

```tsx
{workspace.hasAgent && (
  <span
    className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/50 text-blue-400 text-xs rounded"
    title={workspace.agentModelFull || workspace.agentModel || 'Unknown model'}
  >
    <Bot className="w-3 h-3" />
    {workspace.agentModel || 'Agent'}
  </span>
)}
```

### 5. Frontend: Cost Summary By Model with Tooltips

**File:** `src/dashboard/frontend/src/components/IssueDetailPanel.tsx` (lines 454-468)

The cost data already has full model IDs from the cost tracking system. We just need to:
- Extract friendly name for display
- Keep full name for tooltip

```tsx
{Object.entries(costData.byModel)
  .sort(([, a], [, b]) => b - a)
  .map(([model, cost]) => (
    <div key={model} className="flex items-center justify-between text-sm">
      <span
        className="text-gray-400 truncate"
        title={model}  // Full model ID on hover
      >
        {getFriendlyModelName(model)}  // New helper function
      </span>
      <span className="text-gray-300">{formatCost(cost)}</span>
    </div>
  ))}
```

### 6. Add Helper: Friendly Model Name Mapping

```typescript
function getFriendlyModelName(fullModel: string): string {
  if (fullModel.includes('opus-4-5') || fullModel.includes('opus-4.5')) return 'Opus 4.5';
  if (fullModel.includes('opus-4-1')) return 'Opus 4.1';
  if (fullModel.includes('opus-4') || fullModel.includes('opus')) return 'Opus 4';
  if (fullModel.includes('sonnet-4-5') || fullModel.includes('sonnet-4.5')) return 'Sonnet 4.5';
  if (fullModel.includes('sonnet-4') || fullModel.includes('sonnet')) return 'Sonnet 4';
  if (fullModel.includes('haiku-4-5') || fullModel.includes('haiku-4.5')) return 'Haiku 4.5';
  if (fullModel.includes('haiku-3')) return 'Haiku 3';
  if (fullModel.includes('haiku')) return 'Haiku 4.5';
  return fullModel;  // Return as-is if unknown
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/cost-parsers/jsonl-parser.ts` | Add `getActiveSessionModel()` function |
| `src/dashboard/server/index.ts` | Call new function, add `agentModelFull` to response |
| `src/dashboard/frontend/src/components/IssueDetailPanel.tsx` | Update types, add tooltips to agent badge and cost breakdown, add `getFriendlyModelName()` helper |

## Testing

1. Start dashboard and open an issue with running agent
2. Verify agent badge shows friendly name (e.g., "Sonnet 4.5")
3. Hover over badge - should show full ID (e.g., "claude-sonnet-4-5-20250929")
4. Check cost summary "By Model" section has same tooltip behavior
5. Test with no agent running - should gracefully fall back

## Edge Cases

- **No active session files:** Fall back to status line model name
- **Session file parsing fails:** Log warning, use fallback
- **Workspace path conversion edge cases:** Test with paths containing special characters
- **Cost data without full model IDs:** Display as-is (already works)

## Complexity Assessment

**Overall: Simple**
- 3 files to modify
- Clear, self-contained changes
- No architectural changes
- Low risk

**Recommended model for implementation:** Haiku (trivial to simple changes)
