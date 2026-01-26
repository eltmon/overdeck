/**
 * Model Pricing Constants
 *
 * Pricing data for calculating costs from token usage.
 * Re-exports from the existing cost.ts module.
 */

import { ModelPricing, DEFAULT_PRICING, getPricing, calculateCost } from '../cost.js';

export { ModelPricing, DEFAULT_PRICING, getPricing, calculateCost };

/**
 * Calculate cost in USD for a cost event
 */
export function calculateEventCost(
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
  model: string
): number {
  // Determine provider from model string
  let provider: 'anthropic' | 'openai' | 'google' | 'custom' = 'custom';
  if (model.startsWith('claude-') || model.startsWith('anthropic/')) {
    provider = 'anthropic';
  } else if (model.startsWith('gpt-') || model.startsWith('openai/')) {
    provider = 'openai';
  } else if (model.startsWith('gemini-') || model.startsWith('google/')) {
    provider = 'google';
  }

  const pricing = getPricing(provider, model);
  if (!pricing) {
    console.warn(`No pricing found for ${provider}/${model}, using $0`);
    return 0;
  }

  return calculateCost(
    {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      cacheTTL: '5m', // Default to 5-minute TTL
    },
    pricing
  );
}
