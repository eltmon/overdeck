/**
 * Jev config resolution (PAN-4369). Turns the normalized `jev:` block, the key slot and the
 * background-AI gate into either a usable `ResolvedJevConfig` or a typed reason why Jev is
 * unavailable. Pure: no network, no logging, env injected for tests.
 *
 * There is no default model. An unset `jev.model` resolves to `model-not-configured`, so the
 * SDK's own `TYPESAFE_DEFAULT_MODEL` / built-in default model can never apply.
 */
import type { NormalizedConfig } from '../config-yaml.js';
import type { BackgroundAiFeature } from '../background-ai/registry.js';
import { isBackgroundFeatureEnabled } from '../background-ai/features.js';

export type JevFeature = Extract<
  BackgroundAiFeature,
  'jevTurnEndAssessment' | 'jevAcceptanceCriteriaReview' | 'jevMemoryRelevance'
>;
export type JevConfigInput = Pick<NormalizedConfig, 'backgroundAi' | 'jev' | 'apiKeys'>;
export type JevUnavailableReason = 'disabled' | 'not-configured' | 'model-not-configured' | 'no-api-key';
export interface ResolvedJevConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs: number;
}
export type JevConfigResolution =
  | { ok: true; config: ResolvedJevConfig }
  | { ok: false; reason: JevUnavailableReason };

/** Config, model and key checks without the feature gate: used by the eval and by resolveJevForFeature. */
export function resolveJevConfig(
  config: Pick<NormalizedConfig, 'jev' | 'apiKeys'>,
  env: NodeJS.ProcessEnv = process.env,
): JevConfigResolution {
  const jev = config.jev;
  if (!jev.configured) return { ok: false, reason: 'not-configured' };
  const model = jev.model?.trim();
  if (!model) return { ok: false, reason: 'model-not-configured' };
  const apiKey = config.apiKeys.typesafe?.trim() || env[jev.apiKeyRef]?.trim();
  if (!apiKey) return { ok: false, reason: 'no-api-key' };
  return {
    ok: true,
    config: { apiKey, model, ...(jev.baseUrl ? { baseUrl: jev.baseUrl } : {}), timeoutMs: jev.timeoutMs },
  };
}

/** The full gate for one feature: the background-AI toggle first, then resolveJevConfig. */
export function resolveJevForFeature(
  feature: JevFeature,
  config: JevConfigInput,
  env: NodeJS.ProcessEnv = process.env,
): JevConfigResolution {
  if (!isBackgroundFeatureEnabled(feature, config)) return { ok: false, reason: 'disabled' };
  return resolveJevConfig(config, env);
}
