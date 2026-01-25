# PAN-82: Cost Calculation Pricing and Calculation Fixes

## Summary

Fix incorrect pricing constants, add missing models, implement dual cache TTL pricing, and resolve calculation bugs in the cost tracking system.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Historical data compatibility | Fix forward only | PAN-81 will handle migration with corrected pricing |
| Long-context pricing scope | Both Sonnet 4 and Sonnet 4.5 | Official docs confirm both models have 1M context with premium pricing |
| Long-context output multiplier | 1.5x ($22.50 vs $15) | Official pricing, not 2x like input |
| Cache TTL pricing | Full implementation (5m + 1h) | Add cacheWrite5mPer1k, cacheWrite1hPer1k, pass cacheTTL to calculateCost |
| CostSummary.totalTokens type | Extend type + calculation | Add cacheRead/cacheWrite fields to interface and include in totals |
| Haiku 3.5 removal | Remove ALL references | User wants it completely removed despite official support |
| Opus 4.1 pricing | Add explicit entry | Ensure 100% precision in all pricing entries |
| normalizeModelName() fix | Include in this issue | Required for 4.5 models to use correct pricing entries |

## Files to Modify

### 1. `src/lib/cost.ts` - Main pricing and calculation logic
- Update `ModelPricing` interface:
  - Replace `cacheWritePer1k` with `cacheWrite5mPer1k` and `cacheWrite1hPer1k`
- Update `DEFAULT_PRICING` array:
  - Fix Opus 4 cache read price (0.00175 → 0.0015)
  - Remove `claude-haiku-3.5` entry
  - Add 4.5 series models with correct pricing
  - Add `claude-haiku-3` for backwards compatibility
  - Add `claude-opus-4-1` explicit entry
- Update `TokenUsage` interface:
  - Add optional `cacheTTL?: '5m' | '1h'` field
- Update `calculateCost()`:
  - Add `cacheTTL` parameter support for dual-TTL pricing
  - Add long-context pricing for Sonnet 4/4.5 (>200K: 2x input, 1.5x output)
- Update `summarizeCosts()`:
  - Include cache tokens in totalTokens.total
- Extend `CostSummary.totalTokens` type:
  - Add `cacheRead` and `cacheWrite` fields

### 2. `src/lib/cost-parsers/jsonl-parser.ts` - Model normalization
- Update `normalizeModelName()`:
  - Fix 4.5 model mappings (opus-4.5 → claude-opus-4.5, not claude-opus-4)
  - Fix haiku mapping (→ claude-haiku-4.5 as default, not haiku-3.5)
  - Add 4.1 model recognition

### 3. `src/dashboard/server/index.ts` - Dashboard pricing
- Update `MODEL_PRICING` object:
  - Remove `claude-haiku-3.5`
  - Add 4.5 series models
  - Add dual cache TTL fields
- Update pricing lookup fallback (line ~6390)

### 4. Documentation updates
- `docs/PRD-CLOISTER.md` - Update Haiku model reference
- `docs/prds/reporting-prd.md` - Update cost breakdown example

## Pricing Changes

### Current vs Corrected

| Model | Field | Current | Correct | Change |
|-------|-------|---------|---------|--------|
| claude-opus-4 | cacheReadPer1k | 0.00175 | 0.0015 | -16.7% |
| claude-haiku-3.5 | * | exists | N/A | **REMOVE** |

### Models to Add

| Model | Input/1k | Output/1k | Cache Read/1k | 5m Cache Write/1k | 1h Cache Write/1k |
|-------|----------|-----------|---------------|-------------------|-------------------|
| claude-opus-4.5 | 0.005 | 0.025 | 0.0005 | 0.00625 | 0.01 |
| claude-sonnet-4.5 | 0.003 | 0.015 | 0.0003 | 0.00375 | 0.006 |
| claude-haiku-4.5 | 0.001 | 0.005 | 0.0001 | 0.00125 | 0.002 |
| claude-opus-4-1 | 0.015 | 0.075 | 0.0015 | 0.01875 | 0.03 |
| claude-haiku-3 | 0.00025 | 0.00125 | 0.00003 | 0.0003 | 0.0005 |

### Pricing Formula Reference

From official docs:
- **5-minute cache write** = 1.25 × input price
- **1-hour cache write** = 2.0 × input price
- **Cache read** = 0.1 × input price

## Long-Context Pricing Implementation

For Sonnet 4 and Sonnet 4.5 with >200K total input tokens:
- **Input tokens**: 2x standard ($6/MTok instead of $3/MTok)
- **Output tokens**: 1.5x standard ($22.50/MTok instead of $15/MTok)

**200K threshold includes ALL input:**
- `inputTokens` + `cacheReadTokens` + `cacheWriteTokens`

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTTL?: '5m' | '1h';  // NEW: for dual-TTL cache pricing
}

export function calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
  let cost = 0;
  let inputMultiplier = 1;
  let outputMultiplier = 1;

  // Long-context pricing for Sonnet 4/4.5
  const totalInputTokens = usage.inputTokens
    + (usage.cacheReadTokens || 0)
    + (usage.cacheWriteTokens || 0);

  if ((pricing.model === 'claude-sonnet-4' || pricing.model === 'claude-sonnet-4.5')
      && totalInputTokens > 200000) {
    inputMultiplier = 2;    // $6/MTok vs $3/MTok
    outputMultiplier = 1.5; // $22.50/MTok vs $15/MTok
  }

  // Input tokens
  cost += (usage.inputTokens / 1000) * pricing.inputPer1k * inputMultiplier;

  // Output tokens
  cost += (usage.outputTokens / 1000) * pricing.outputPer1k * outputMultiplier;

  // Cache read tokens (not affected by long-context multiplier)
  if (usage.cacheReadTokens && pricing.cacheReadPer1k) {
    cost += (usage.cacheReadTokens / 1000) * pricing.cacheReadPer1k;
  }

  // Cache write tokens - use TTL-appropriate pricing
  if (usage.cacheWriteTokens) {
    const ttl = usage.cacheTTL || '5m';
    const cacheWritePrice = ttl === '1h'
      ? pricing.cacheWrite1hPer1k
      : pricing.cacheWrite5mPer1k;
    if (cacheWritePrice) {
      cost += (usage.cacheWriteTokens / 1000) * cacheWritePrice;
    }
  }

  return Math.round(cost * 1000000) / 1000000;
}
```

## Type Changes

```typescript
// ModelPricing - replace single cacheWritePer1k
export interface ModelPricing {
  provider: AIProvider;
  model: string;
  inputPer1k: number;
  outputPer1k: number;
  cacheReadPer1k?: number;
  cacheWrite5mPer1k?: number;  // 5-minute TTL (default)
  cacheWrite1hPer1k?: number;  // 1-hour TTL
  currency: string;
}

// TokenUsage - add cacheTTL
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cacheTTL?: '5m' | '1h';  // NEW
}

// CostSummary.totalTokens - add cache fields
totalTokens: {
  input: number;
  output: number;
  cacheRead: number;   // NEW
  cacheWrite: number;  // NEW
  total: number;
};
```

## normalizeModelName() Fixes

**Current (buggy):**
```typescript
if (model.includes('opus-4-5') || model.includes('opus-4.5')) {
  normalizedModel = 'claude-opus-4';  // WRONG
}
// ...
if (model.includes('haiku')) {
  normalizedModel = 'claude-haiku-3.5';  // WRONG - model being removed
}
```

**Fixed:**
```typescript
// Order matters - check more specific patterns first
// Opus models
if (model.includes('opus-4-5') || model.includes('opus-4.5')) {
  normalizedModel = 'claude-opus-4.5';
} else if (model.includes('opus-4-1') || model.includes('opus-4.1')) {
  normalizedModel = 'claude-opus-4-1';
} else if (model.includes('opus-4') || model.includes('opus')) {
  normalizedModel = 'claude-opus-4';
}

// Sonnet models
if (model.includes('sonnet-4-5') || model.includes('sonnet-4.5')) {
  normalizedModel = 'claude-sonnet-4.5';
} else if (model.includes('sonnet-4') || model.includes('sonnet')) {
  normalizedModel = 'claude-sonnet-4';
}

// Haiku models - default to 4.5 (current), support 3 for legacy
if (model.includes('haiku-4-5') || model.includes('haiku-4.5')) {
  normalizedModel = 'claude-haiku-4.5';
} else if (model.includes('haiku-3')) {
  normalizedModel = 'claude-haiku-3';
} else if (model.includes('haiku')) {
  normalizedModel = 'claude-haiku-4.5';  // Default to current model
}
```

## Testing Strategy

1. **Unit tests for pricing correctness**
   - Verify each model's pricing matches official rates
   - Test `getPricing()` partial matching with date suffixes
   - Test that haiku-3.5 returns null (removed)

2. **Unit tests for calculateCost()**
   - Standard calculation
   - Long-context multiplier for Sonnet 4 and 4.5 (>200K tokens)
   - Verify 2x input + 1.5x output multipliers
   - Threshold calculation includes cache tokens
   - 5-minute vs 1-hour cache TTL pricing

3. **Unit tests for summarizeCosts()**
   - Verify cache tokens included in totals
   - Verify new type fields populated

4. **Unit tests for normalizeModelName()**
   - Test all model variations map correctly
   - Verify haiku maps to haiku-4.5 (not removed haiku-3.5)

## Acceptance Criteria

- [ ] All pricing values match official Anthropic rates (verified against platform.claude.com/docs)
- [ ] 4.5 series models have pricing entries (opus, sonnet, haiku)
- [ ] Opus 4 cache read fixed (0.0015, not 0.00175)
- [ ] claude-haiku-3.5 removed from ALL files
- [ ] Long-context pricing applies 2x input + 1.5x output for Sonnet 4/4.5 >200K tokens
- [ ] Dual cache TTL pricing (5m: 1.25x, 1h: 2x) implemented
- [ ] Cache tokens included in totalTokens.total
- [ ] CostSummary type includes cacheRead/cacheWrite
- [ ] normalizeModelName() correctly maps 4.5 models
- [ ] All existing tests pass
- [ ] New tests cover pricing accuracy and edge cases

## Out of Scope

- Historical data migration (handled by PAN-81)
- Event-sourced cost tracking (handled by PAN-81)
- Dashboard UI changes (except pricing constants)
- OpenAI/Google pricing updates
- Batch API pricing (separate feature)
