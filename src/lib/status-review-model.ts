import type { NormalizedConfig } from './config-yaml/schema.js';

/**
 * The model the Command Deck status review runs on: `models.status_review_model`
 * in config.yaml, whose documented default lives in config-yaml/defaults.ts.
 * Throws rather than picking a model when none is configured (PAN-4160).
 */
export function resolveStatusReviewModel(config: Pick<NormalizedConfig, 'statusReviewModel'>): string {
  const model = config.statusReviewModel?.trim();
  if (!model) {
    throw new Error('No status review model configured: set models.status_review_model in ~/.overdeck/config.yaml.');
  }
  return model;
}
