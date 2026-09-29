import { calculateCost, getPricing } from '../../src/lib/cost.js';

// Declared inline (not imported from eval-model.ts) so WI-1 and WI-2 can land in parallel.

export interface EvalUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number | null;
}

export interface AnthropicUsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface OpenAIUsageLike {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number | null } | null;
  output_tokens_details?: { reasoning_tokens?: number | null } | null;
}

export function usageFromAnthropic(u: AnthropicUsageLike): EvalUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    reasoningTokens: null,
  };
}

export function usageFromOpenAI(u: OpenAIUsageLike): EvalUsage {
  const cachedTokens = u.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: u.input_tokens - cachedTokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: cachedTokens,
    cacheWriteTokens: 0,
    reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? null,
  };
}

export function evalCostUsd(provider: 'anthropic' | 'openai', model: string, usage: EvalUsage): number | null {
  const pricing = getPricing(provider, model);
  if (!pricing) {
    return null;
  }
  return calculateCost(
    {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    },
    pricing,
  );
}
