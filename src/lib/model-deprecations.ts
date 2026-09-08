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
};
