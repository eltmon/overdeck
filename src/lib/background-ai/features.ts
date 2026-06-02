/**
 * Background AI enablement gate (PAN-1583).
 *
 * Panopticon makes a number of automatic, background LLM calls on the user's
 * behalf — conversation titles, memory extraction, enrichment, TTS narration,
 * etc. — independent of the work/plan/review/test/ship pipeline agents.
 *
 * Historically each caller decided for itself whether to run, using its own
 * ad-hoc flag (or no flag at all). `isBackgroundFeatureEnabled()` is now the
 * single gate every caller consults. It honors both the per-feature toggle and
 * the high-level low-cost ("cheap") master switch.
 *
 * Low-cost mode is a one-click override: when on, every optional background AI
 * feature is disabled regardless of its individual toggle. This lets the user
 * turn off all ancillary model spend at once.
 *
 * The feature list, metadata, and defaults live in `registry.ts` (dependency
 * free) and are re-exported here for convenience.
 */

import { loadConfigSync, type NormalizedConfig } from '../config-yaml.js';
import type { BackgroundAiFeature } from './registry.js';

export {
  BACKGROUND_AI_FEATURES,
  BACKGROUND_AI_FEATURE_META,
  defaultBackgroundAiFeatures,
} from './registry.js';
export type { BackgroundAiFeature, BackgroundAiFeatureMeta } from './registry.js';

/**
 * The single gate every background AI caller must consult before invoking a
 * model. Returns false when low-cost mode is on, or when the feature's own
 * toggle is off. Pass an already-loaded config to avoid a redundant load on
 * hot paths; otherwise the current config is read synchronously.
 */
export function isBackgroundFeatureEnabled(
  feature: BackgroundAiFeature,
  config?: Pick<NormalizedConfig, 'backgroundAi'>,
): boolean {
  const backgroundAi = (config ?? loadConfigSync().config).backgroundAi;
  if (backgroundAi.cheapMode) return false;
  return backgroundAi.features[feature] ?? false;
}
