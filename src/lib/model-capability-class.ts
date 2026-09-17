import { MODEL_DEPRECATIONS } from './model-deprecations.js';

export type ModelCapabilityClass = 'frontier' | 'workhorse' | 'small';

/** PAN-3842: one source of truth for "how strong is this model", used by the
 * tier-fitness checker.
 * Rule of thumb: provider tierModels.opus slot ⇒ frontier, sonnet slot ⇒
 * workhorse, haiku slot ⇒ small; ties broken by price and the frontend tier.
 * A retired id may carry its OWN row when it is still launchable and its real
 * capability differs from its replacement's — capabilityClassOf reads the
 * literal id first and only hops MODEL_DEPRECATIONS for ids with no row. */
export const MODEL_CAPABILITY_CLASSES: Readonly<Record<string, ModelCapabilityClass>> = {
  // frontier
  'claude-fable-5-1': 'frontier',
  'claude-fable-5': 'frontier',
  'claude-opus-5': 'frontier',
  'claude-opus-4-8': 'frontier',
  'claude-opus-4-7': 'frontier',
  'claude-opus-4-6': 'frontier',
  'gpt-6-astra': 'frontier',
  'gpt-5.6-sol': 'frontier',
  'gpt-5.6-sol[372k]': 'frontier',
  'gemini-3.1-pro-preview': 'frontier',
  'gemini-3.8-flash': 'frontier',
  'k3': 'frontier',
  'k3[1m]': 'frontier',
  'kimi-code/k3': 'frontier',
  'kimi-code/k3-256k': 'frontier',
  'glm-5.3': 'frontier',
  'glm-5.2': 'frontier',
  'glm-5.1': 'frontier',
  'MiniMax-M3': 'frontier',
  'mimo-v2.5-pro': 'frontier',
  'qwen3-max': 'frontier',
  'qwen3.7-max': 'frontier',
  'qwen3.8-max': 'frontier',
  'qwen/qwen3.6-plus': 'frontier',
  'ql-reason-70b': 'frontier',
  'mistral-large-latest': 'frontier',
  // workhorse
  'claude-sonnet-5': 'workhorse',
  'claude-sonnet-4-6': 'workhorse',
  'claude-sonnet-4-5': 'workhorse',
  'gpt-5.6-terra': 'workhorse',
  'gpt-5.6-terra[372k]': 'workhorse',
  'gemini-3-flash-preview': 'workhorse',
  'kimi-k2.7-code': 'workhorse',
  'kimi-code/kimi-for-coding': 'workhorse',
  'kimi-code/kimi-for-coding-highspeed': 'workhorse',
  'minimax-m2.7': 'workhorse',
  'minimax-m2.7-highspeed': 'workhorse',
  'glm-4.7': 'workhorse',
  'mimo-v2.5': 'workhorse',
  'qwen3-coder-plus': 'workhorse',
  'qwen3.7-plus': 'workhorse',
  'qwen3.8-flash': 'workhorse',
  'qwen3-plus': 'workhorse',
  'grok-build-0.1': 'workhorse',
  'muse-spark-1.3': 'workhorse',
  'muse-spark-1.3-contributor': 'workhorse',
  'llama-3.3-70b-versatile': 'workhorse',
  'qwen-qwq-32b': 'workhorse',
  'llama3.3-70b': 'workhorse',
  'llama3.1-70b': 'workhorse',
  'codestral-latest': 'workhorse',
  'ql-swift-8b': 'workhorse',
  // small
  'claude-haiku-4-5': 'small',
  'gpt-5.6-luna': 'small',
  'gpt-5.6-luna[372k]': 'small',
  'gemini-3.1-flash-lite-preview': 'small',
  'gemini-3.5-flash-lite': 'small',
  'glm-4.7-flash': 'small',
  'ql-nano-1b': 'small',
  'llama-3.1-8b-instant': 'small',
  'gemma2-9b-it': 'small',
  'llama3.1-8b': 'small',
  'mistral-small-latest': 'small',
};

/**
 * Capability class of the model that will ACTUALLY run.
 *
 * Literal id first, deprecation hop only as a fallback. An explicit per-spawn
 * override is launched verbatim — determineModel/normalizeModelOverrideSync
 * validate the id but never rewrite it — so rating a retired id by its
 * replacement describes a model that is not executing. That suppressed the
 * warning this feature exists for: glm-4.7-flash (small) spawns as itself but
 * hopped to glm-5.1 (frontier) and silently passed an expert plan.
 *
 * Ids with no row of their own still hop, which is what keeps a retired id
 * like gpt-5.2-codex classified as its live replacement rather than unknown.
 */
export function capabilityClassOf(modelId: string): ModelCapabilityClass | undefined {
  const own = MODEL_CAPABILITY_CLASSES[modelId];
  if (own !== undefined) return own;
  const replacement = MODEL_DEPRECATIONS[modelId];
  return replacement === undefined ? undefined : MODEL_CAPABILITY_CLASSES[replacement];
}
