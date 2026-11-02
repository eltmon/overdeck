import type { ModelId } from './settings.js';

/** Single-hop migration of explicitly retired selections; historical capabilities remain. */
export const MODEL_DEPRECATIONS: Record<string, ModelId> = {
  'claude-opus-4-5': 'claude-opus-4-7',
  'claude-sonnet-4-5': 'claude-sonnet-4-6',
  // Operator-retired from new selections, September 2026. Historical rates remain.
  'gpt-5.2-codex': 'gpt-5.6-terra',
  'gpt-5.5-mini': 'gpt-5.6-luna',
  'gpt-5.5-nano': 'gpt-5.6-luna',
  'gpt-5.4-nano': 'gpt-5.6-luna',
  'gpt-5.5-pro': 'gpt-5.6-sol',
  'gpt-5.4-pro': 'gpt-5.6-terra',
  'o3': 'gpt-5.6-terra',
  'o3-deep-research': 'gpt-5.6-terra',
  'o4-mini': 'gpt-5.6-luna',
  'gpt-4o': 'gpt-5.6-terra',
  'gpt-4o-mini': 'gpt-5.6-luna',
  'gpt-5.5': 'gpt-5.6-sol',
  'gpt-5.4': 'gpt-5.6-terra',
  'gpt-5.4-mini': 'gpt-5.6-luna',
  'gpt-5.3-codex': 'gpt-5.6-terra',
  'gpt-5.3-codex-spark': 'gpt-5.6-luna',
  'gpt-5.2': 'gpt-5.6-terra',
  // Google deprecated models
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-2.5-pro': 'gemini-3.1-pro-preview',
  'gemini-2.5-flash': 'gemini-3-flash-preview',
  // Shut down 2026-05-25 (ai.google.dev/gemini-api/docs/deprecations). The GA id itself
  // is scheduled to shut down 2027-05-07 → gemini-3.5-flash-lite.
  'gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite',
  // Kimi deprecated — K2.5/K2.6 generation retired 2026-07-30; the CLI catalog
  // never carried these ids, so no native harness could launch them. They remap
  // to the closest-priced live coding model, not the $9 K3 flagship.
  'kimi-k2': 'kimi-k2.7-code',
  'kimi-k2.5': 'kimi-k2.7-code',
  'kimi-k2.6': 'kimi-k2.7-code',
  'K2.6-code-preview': 'kimi-k2.7-code',
  // Z.AI deprecated
  'glm-4.7': 'glm-5.1',
  'glm-4.7-flash': 'glm-5.1',
  // Alibaba DashScope, Singapore endpoint (Model Studio deprecation notices 1949/1950, 2026-10-10).
  // qwen3-coder-plus → qwen3.7-plus; the qwen3-max snapshots → qwen3.7-max, and the bare alias
  // is absent from the Singapore price list. qwen3-plus was never a DashScope id (operator mapping).
  'qwen3-coder-plus': 'qwen3.7-plus',
  'qwen3-max': 'qwen3.7-max',
  'qwen3-plus': 'qwen3.8-flash',
  // MiMo — retired by Xiaomi 2026-10-21 (mimo.mi.com/docs/en-US/price/pay-as-you-go)
  'mimo-v2.5-pro': 'mimo-v2.6-pro',
  'mimo-v2.5': 'mimo-v2.6-flash',
  // Groq — shut down (console.groq.com/docs/deprecations). Groq named qwen/qwen3-32b for
  // QwQ and the now-dead llama-3.1-8b-instant for Gemma; both remap to live gpt-oss ids.
  'llama-3.3-70b-versatile': 'openai/gpt-oss-120b',
  'qwen-qwq-32b': 'openai/gpt-oss-120b',
  'llama-3.1-8b-instant': 'openai/gpt-oss-20b',
  'gemma2-9b-it': 'openai/gpt-oss-20b',
  // Cerebras — deprecated (inference-docs.cerebras.ai/support/deprecation). llama-3.3-70b is
  // Cerebras's real id; Overdeck carried llama3.3-70b.
  'llama3.3-70b': 'gpt-oss-120b',
  'llama-3.3-70b': 'gpt-oss-120b',
  'llama3.1-70b': 'gpt-oss-120b',
  'llama3.1-8b': 'gpt-oss-120b',
};
