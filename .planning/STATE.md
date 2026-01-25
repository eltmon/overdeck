# PAN-82: Cost Calculation Pricing and Calculation Fixes

## Current Status

**✅ COMPLETE** - All implementation tasks finished and committed.

- All 8 beads tasks completed and closed
- 43 new unit tests added, all passing
- All existing tests passing (363 total)
- Changes committed and pushed to remote
- Ready for review

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

## Files Modified

### 1. `src/lib/cost.ts` - Main pricing and calculation logic
- Updated `ModelPricing` interface with dual cache TTL
- Updated `DEFAULT_PRICING` array with corrected prices
- Added long-context pricing for Sonnet 4/4.5

### 2. `src/lib/cost-parsers/jsonl-parser.ts` - Model normalization
- Fixed `normalizeModelName()` for 4.5 models

### 3. `src/dashboard/server/index.ts` - Dashboard pricing
- Updated `MODEL_PRICING` object

## Success Criteria

- [x] All pricing values match official Anthropic rates
- [x] 4.5 series models have pricing entries
- [x] Opus 4 cache read fixed (0.0015, not 0.00175)
- [x] claude-haiku-3.5 removed from ALL files
- [x] Long-context pricing applies 2x input + 1.5x output for Sonnet 4/4.5 >200K tokens
- [x] Dual cache TTL pricing (5m: 1.25x, 1h: 2x) implemented
- [x] Cache tokens included in totalTokens.total
- [x] CostSummary type includes cacheRead/cacheWrite
- [x] normalizeModelName() correctly maps 4.5 models
- [x] All existing tests pass
- [x] New tests cover pricing accuracy and edge cases

## Out of Scope

- Historical data migration (handled by PAN-81)
- Event-sourced cost tracking (handled by PAN-81)
- Dashboard UI changes (except pricing constants)
- OpenAI/Google pricing updates
- Batch API pricing (separate feature)
