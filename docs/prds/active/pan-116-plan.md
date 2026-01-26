# PAN-116: Fix Cost Calculation for Multi-Model Sessions

## Problem Statement

When Claude Max auto-upgrades a session from Sonnet to Opus mid-conversation, `parseClaudeSession()` calculates cost using only the **first** model for ALL messages. This causes significant underestimation (up to 5x) for upgraded sessions.

**Example:**
- Session: 152 Sonnet messages + 27 Opus messages
- Current behavior: All 179 messages billed at Sonnet rates
- Expected: 152 at Sonnet rates, 27 at Opus rates (5x more expensive)

## Root Cause

In `src/lib/cost-parsers/jsonl-parser.ts:168-259`:
1. Line 179: `primaryModel` set only once (first model found)
2. Lines 212-217: All tokens accumulated into single bucket
3. Lines 245-247: Single model's pricing applied to all tokens

## Solution Design

### Per-Message Cost Calculation

Replace session-level costing with per-message costing:

1. **Loop through messages** - For each message with usage:
   - Extract model and usage for THIS message
   - Calculate cost using THIS message's model pricing
   - Accumulate cost in per-model breakdown

2. **Track breakdown by model** - Record cost/tokens/count per normalized model:
   ```typescript
   modelBreakdown: {
     'claude-sonnet-4-5-20250929': { cost, inputTokens, outputTokens, messageCount },
     'claude-opus-4-5-20251101': { cost, inputTokens, outputTokens, messageCount }
   }
   ```

3. **Display model progression** - For `model` field:
   - Single model: "claude-sonnet-4.5" (normalized)
   - Multiple models: "claude-sonnet-4.5 → claude-opus-4.5" (normalized)

### Migration Strategy: Version Flag

**Decision:** Add `cost_v2` field to preserve historical data for comparison.

```typescript
export interface SessionUsage {
  // ... existing fields ...
  cost: number;  // ⚠️ DEPRECATED: Uses first-model pricing (kept for compatibility)
  cost_v2?: number;  // ✅ NEW: Accurate per-message pricing
  modelBreakdown?: Record<string, {  // ✅ NEW: Cost split by exact model ID
    cost: number;
    inputTokens: number;
    outputTokens: number;
    messageCount: number;
  }>;
}
```

**Rationale:**
- Preserves old costs for comparison/analysis
- Clear semantic: `cost_v2` is the accurate version
- Consumers can migrate gradually (issue #105)
- Non-breaking: optional fields

### Model Display: Hybrid Approach

**Decision:** Normalized names for readability, full IDs for precision.

- **`model` field** (display): Normalized names joined with →
  - Example: "claude-sonnet-4.5 → claude-opus-4.5"
  - Easy to read, matches pricing keys

- **`modelBreakdown` keys** (data): Exact model IDs
  - Example: "claude-sonnet-4-5-20250929"
  - Precise, preserves full version info

## Scope Boundaries

### In Scope ✅
- Fix `parseClaudeSession()` to calculate per-message costs
- Add `modelBreakdown` and `cost_v2` fields to `SessionUsage`
- Update tests to validate multi-model scenarios
- Update function docstrings

### Out of Scope ❌
- Updating consumers (claude-code.ts, specialists.ts) to display breakdown
  - Deferred to #105
- Dashboard UI changes
- CLI output formatting
- Migrating existing event-sourced data

## Implementation Plan

### 1. Update Type Definitions

File: `src/lib/cost-parsers/jsonl-parser.ts`

Add optional fields to `SessionUsage` interface:
```typescript
export interface SessionUsage {
  sessionId: string;
  sessionFile: string;
  startTime: string;
  endTime: string;
  model: string;  // Now shows "sonnet → opus" for upgrades (normalized)
  usage: TokenUsage;  // Total tokens across all models
  cost: number;  // DEPRECATED: First-model pricing
  cost_v2?: number;  // NEW: Accurate per-message pricing
  messageCount: number;
  modelBreakdown?: Record<string, {  // NEW: Keyed by exact model ID
    cost: number;
    inputTokens: number;
    outputTokens: number;
    messageCount: number;
  }>;
}
```

### 2. Update parseClaudeSession()

Replace lines 179-247 with per-message cost logic:

**Key changes:**
- Initialize `modelBreakdown` map
- For each message:
  - Get model and usage
  - Normalize model name for pricing lookup
  - Calculate cost for this message
  - Update modelBreakdown with exact model ID as key
  - Accumulate cost_v2
- Generate model display string:
  - Extract normalized names from breakdown keys
  - Join with " → " if multiple models
- Keep old `cost` calculation for compatibility (with deprecation comment)

**Pseudocode:**
```typescript
const modelBreakdown: Record<string, {...}> = {};
let totalCostV2 = 0;

for (const line of lines) {
  const msg = JSON.parse(line);
  const usage = msg.message?.usage || msg.usage;
  const modelId = msg.message?.model || msg.model;  // Exact ID

  if (usage && modelId) {
    // Normalize for pricing lookup
    const { provider, model: normalizedModel } = normalizeModelName(modelId);
    const pricing = getPricing(provider, normalizedModel);

    if (pricing) {
      const msgCost = calculateCost(msgUsage, pricing);
      totalCostV2 += msgCost;

      // Track by exact model ID
      if (!modelBreakdown[modelId]) {
        modelBreakdown[modelId] = { cost: 0, inputTokens: 0, outputTokens: 0, messageCount: 0 };
      }
      modelBreakdown[modelId].cost += msgCost;
      // ... accumulate tokens and count
    }
  }
}

// Generate display string (normalized names)
const normalizedModels = Object.keys(modelBreakdown)
  .map(id => normalizeModelName(id).model);
const modelDisplay = normalizedModels.length > 1
  ? normalizedModels.join(' → ')
  : normalizedModels[0] || 'claude-sonnet-4';
```

### 3. Update Tests

File: `tests/lib/cost-parsers/jsonl-parser.test.ts`

Add new test suite for `parseClaudeSession()` multi-model handling:

**Test cases:**
1. Single-model session - Verify cost matches original
2. Sonnet → Opus upgrade - Verify:
   - `cost_v2` > `cost` (per-message vs first-model)
   - `modelBreakdown` has both models
   - Opus messages cost ~5x more per message than Sonnet
   - Model display shows "claude-sonnet-4.5 → claude-opus-4.5"
3. Multiple model switches - Verify breakdown tracks all models
4. Session with no usage - Returns null
5. All messages same model - Verify `cost` ≈ `cost_v2`

**Test data strategy:**
- Use synthetic JSONL content (not real session files)
- Create helper function to generate test messages
- Use known token counts for easy verification

### 4. Documentation

Update docstrings in `parseClaudeSession()`:
- Explain per-message pricing approach
- Note model display format for upgrades
- Mark `cost` field as deprecated, recommend `cost_v2`
- Document `modelBreakdown` structure

## Acceptance Criteria

- [ ] `parseClaudeSession()` calculates cost per-message using each message's model
- [ ] Returns `cost_v2` with accurate pricing
- [ ] Returns `modelBreakdown` showing cost/tokens/count per exact model ID
- [ ] `model` field shows normalized progression (e.g., "claude-sonnet-4.5 → claude-opus-4.5")
- [ ] Old `cost` field preserved for backward compatibility
- [ ] Test case validates correct multi-model costing (Sonnet → Opus)
- [ ] Test case verifies `cost_v2` > `cost` for upgraded sessions
- [ ] Function docstring explains new pricing approach

## Files Modified

1. `src/lib/cost-parsers/jsonl-parser.ts` - Type definition + parseClaudeSession()
2. `tests/lib/cost-parsers/jsonl-parser.test.ts` - New test suite

## Dependencies

None - isolated to jsonl-parser module. Consumers will be updated in #105.

## Risks & Mitigations

**Risk:** Historical cost data changes significantly
- **Mitigation:** Version flag preserves old costs for comparison

**Risk:** Consumers break if they expect single cost value
- **Mitigation:** `cost` field remains, `cost_v2` is optional

**Risk:** Model normalization doesn't cover all model IDs
- **Mitigation:** Existing `normalizeModelName()` handles common patterns, test edge cases

## Related Issues

- #105 - Update consumers to display model breakdown
- PAN-81 - Event-sourced cost tracking (new sessions already fixed)
- #114 - Fixed model display to show current model

## Open Questions

None - all clarified with user.
