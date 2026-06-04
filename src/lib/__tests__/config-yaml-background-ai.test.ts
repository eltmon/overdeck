import { describe, expect, it } from 'vitest';

import { mergeConfigs } from '../config-yaml.js';
import { defaultBackgroundAiFeatures } from '../background-ai/registry.js';

describe('config-yaml background_ai normalization', () => {
  it('defaults to cheapMode ON with registry feature defaults (PAN-1589)', () => {
    const { config } = mergeConfigs(null);
    expect(config.backgroundAi.cheapMode).toBe(true);
    expect(config.backgroundAi.features).toEqual(defaultBackgroundAiFeatures());
  });

  it('merges cheap_mode and per-feature overrides from raw YAML', () => {
    const { config } = mergeConfigs({
      background_ai: {
        cheap_mode: false,
        features: { ttsSummarizer: true, conversationTitles: false },
      },
    });
    expect(config.backgroundAi.cheapMode).toBe(false);
    expect(config.backgroundAi.features.ttsSummarizer).toBe(true);
    expect(config.backgroundAi.features.conversationTitles).toBe(false);
    // Untouched features keep their defaults.
    expect(config.backgroundAi.features.memoryExtraction).toBe(true);
  });

  it('ignores non-boolean feature values', () => {
    const { config } = mergeConfigs({
      background_ai: {
        // @ts-expect-error — exercising defensive runtime handling of bad input
        features: { conversationTitles: 'yes' },
      },
    });
    expect(config.backgroundAi.features.conversationTitles).toBe(true);
  });
});
