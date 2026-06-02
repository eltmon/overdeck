import { describe, expect, it } from 'vitest';

import {
  BACKGROUND_AI_FEATURES,
  defaultBackgroundAiFeatures,
  isBackgroundFeatureEnabled,
} from '../features.js';
import type { NormalizedConfig } from '../../config-yaml.js';

function configWith(
  cheapMode: boolean,
  overrides: Partial<Record<(typeof BACKGROUND_AI_FEATURES)[number], boolean>> = {},
): Pick<NormalizedConfig, 'backgroundAi'> {
  return {
    backgroundAi: {
      cheapMode,
      features: { ...defaultBackgroundAiFeatures(), ...overrides },
    },
  };
}

describe('defaultBackgroundAiFeatures', () => {
  it('returns an entry for every registered feature', () => {
    const defaults = defaultBackgroundAiFeatures();
    expect(Object.keys(defaults).sort()).toEqual([...BACKGROUND_AI_FEATURES].sort());
  });

  it('defaults sessionEmbeddings and ttsSummarizer off, others on', () => {
    const defaults = defaultBackgroundAiFeatures();
    expect(defaults.sessionEmbeddings).toBe(false);
    expect(defaults.ttsSummarizer).toBe(false);
    expect(defaults.conversationTitles).toBe(true);
    expect(defaults.memoryExtraction).toBe(true);
  });
});

describe('isBackgroundFeatureEnabled', () => {
  it('returns the per-feature flag when cheap mode is off', () => {
    expect(isBackgroundFeatureEnabled('conversationTitles', configWith(false))).toBe(true);
    expect(isBackgroundFeatureEnabled('ttsSummarizer', configWith(false))).toBe(false);
  });

  it('honors an explicit per-feature toggle', () => {
    expect(
      isBackgroundFeatureEnabled('conversationTitles', configWith(false, { conversationTitles: false })),
    ).toBe(false);
    expect(
      isBackgroundFeatureEnabled('ttsSummarizer', configWith(false, { ttsSummarizer: true })),
    ).toBe(true);
  });

  it('disables every feature when cheap mode is on, regardless of toggles', () => {
    const cfg = configWith(true, { conversationTitles: true, memoryExtraction: true, ttsSummarizer: true });
    for (const feature of BACKGROUND_AI_FEATURES) {
      expect(isBackgroundFeatureEnabled(feature, cfg)).toBe(false);
    }
  });
});
